import json
from pathlib import Path
import sqlite3
import time
from typing import Any
from src.llm import ScoreResult


class JobStore:
    def __init__(self, db_path: str = ":memory:", threshold: int = 75):
        self.db_path = db_path
        self.threshold = threshold
        if db_path != ":memory:":
            try:
                p = Path(db_path)
                if p.parent and str(p.parent) != ".":
                    p.parent.mkdir(parents=True, exist_ok=True)
                self.conn = sqlite3.connect(db_path, check_same_thread=False)
            except (sqlite3.OperationalError, PermissionError, OSError):
                fallback_path = "./data/jobfoundry.db"
                try:
                    Path("./data").mkdir(parents=True, exist_ok=True)
                    self.conn = sqlite3.connect(fallback_path, check_same_thread=False)
                    self.db_path = fallback_path
                except Exception:
                    self.conn = sqlite3.connect(":memory:", check_same_thread=False)
                    self.db_path = ":memory:"
        else:
            self.conn = sqlite3.connect(":memory:", check_same_thread=False)

        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA busy_timeout = 10000")
        if self.db_path != ":memory:":
            try:
                self.conn.execute("PRAGMA journal_mode = WAL")
                self.conn.execute("PRAGMA synchronous = NORMAL")
            except Exception:
                pass
        self._ensure_migrations()

    def _ensure_migrations(self) -> None:
        # Keep in sync with the shared schema in server/ingest/src/db/schema.sql:
        # user_settings must cascade with the users row so a deleted/re-created
        # user id can never resurrect stale (potentially secret) settings.
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_settings (
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              key TEXT NOT NULL,
              value TEXT NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (user_id, key)
            )
            """
        )
        self.conn.commit()
        try:
            self.conn.execute("ALTER TABLE jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0")
            self.conn.commit()
        except sqlite3.OperationalError:
            pass
        try:
            self.conn.execute("ALTER TABLE user_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0")
            self.conn.commit()
        except sqlite3.OperationalError:
            pass

    def init_schema(self, schema_sql: str) -> None:
        self.conn.executescript(schema_sql)
        self.conn.commit()

    def has_user_jobs_table(self) -> bool:
        cursor = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='user_jobs'"
        )
        return cursor.fetchone() is not None

    def get_system_settings(self) -> dict[str, str]:
        """
        Loads all key-value pairs from system_settings table if present.
        """
        try:
            cursor = self.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'"
            )
            if not cursor.fetchone():
                return {}
            rows = self.conn.execute("SELECT key, value FROM system_settings").fetchall()
            return {row["key"]: row["value"] for row in rows}
        except Exception:
            return {}

    def get_effective_setting(self, key: str, default: Any = None) -> Any:
        settings = self.get_system_settings()
        if key in settings and settings[key] is not None and settings[key] != "":
            return settings[key]
        return default

    def get_user_settings(self, user_id: str) -> dict[str, str]:
        """
        Loads all key-value pairs from user_settings table for a single user.
        Returns {} if the table is absent (pre-migration DBs).
        """
        try:
            cursor = self.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='user_settings'"
            )
            if not cursor.fetchone():
                return {}
            rows = self.conn.execute(
                "SELECT key, value FROM user_settings WHERE user_id = ? AND value != ''",
                (user_id,),
            ).fetchall()
            return {row["key"]: row["value"] for row in rows}
        except Exception:
            return {}

    def get_user_effective_llm(
        self,
        user_id: str,
        defaults: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Resolves the LLM settings for a single user's scoring job.

        BYOK policy: model and api_base may fall back to operator system
        settings / instance defaults, but the api_key comes ONLY from the
        user's own user_settings row — a shared platform key is never used.
        """
        defaults = defaults or {}
        user_settings = self.get_user_settings(user_id)
        system = self.get_system_settings()

        def pick(key: str, fallback: Any = None) -> Any:
            value = user_settings.get(key) or system.get(key) or fallback
            return value

        return {
            "model": pick("scorer_model", defaults.get("model")),
            "api_base": pick("scorer_api_base", defaults.get("api_base")),
            "api_key": user_settings.get("scorer_api_key", ""),
            "has_user_key": bool(user_settings.get("scorer_api_key")),
        }

    def get_user_effective_tailor(
        self,
        user_id: str,
        fallback: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Resolves the LLM settings used for a single user's automated tailoring.

        The user's tailor_* settings win; model/api_base may fall back to the
        operator's system settings (as scoring does). The api_key NEVER falls
        back to the operator's shared key — only the user's own tailor key, or
        (for backward compatibility with scorer-only setup) the user's own
        scorer key when the user has NOT overridden the tailor provider.

        When a user configures their own tailor model/api_base (a custom
        provider), the scorer key is NOT forwarded to it — mixing a provider
        key with an unrelated endpoint is exactly what we must avoid. In that
        case the tailor key must be explicit, so a missing one resolves to ""
        and the worker surfaces the setup message instead.
        """
        fallback = fallback or {}
        user_settings = self.get_user_settings(user_id)
        system = self.get_system_settings()

        def pick(key: str) -> Any:
            return user_settings.get(key) or system.get(key) or ""

        tailor_provider_override = any(
            user_settings.get(k) for k in ("tailor_model", "tailor_api_base")
        )
        tailor_key = user_settings.get("tailor_api_key")
        scorer_key = user_settings.get("scorer_api_key")

        return {
            "model": pick("tailor_model") or fallback.get("model"),
            "api_base": pick("tailor_api_base") or fallback.get("api_base"),
            "api_key": tailor_key
            or ("" if tailor_provider_override else (scorer_key or fallback.get("api_key"))),
            "has_user_tailor_key": bool(tailor_key),
        }


    def reset_in_flight_jobs(self) -> int:
        """
        Self-healing on daemon startup: reset any stuck in-flight states
        (scoring/tailoring) back to new or ready_for_tailoring.
        """
        now = int(time.time() * 1000)
        reset_count = 0
        if self.has_user_jobs_table():
            cur = self.conn.execute(
                """
                UPDATE user_jobs
                SET status = CASE 
                    WHEN fit_score IS NULL THEN 'new'
                    ELSE 'new'
                END,
                updated_at = ?
                WHERE status IN ('scoring', 'tailoring')
                """,
                (now,),
            )
            reset_count += cur.rowcount

        cur2 = self.conn.execute(
            """
            UPDATE jobs
            SET status = 'new', updated_at = ?
            WHERE status IN ('scoring', 'tailoring')
            """,
            (now,),
        )
        reset_count += cur2.rowcount
        self.conn.commit()
        return reset_count

    def get_unscored_user_jobs(
        self, limit: int = 50, max_attempts: int = 5
    ) -> list[dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT 
                uj.id as user_job_id,
                uj.user_id,
                uj.job_id,
                COALESCE(uj.attempt_count, 0) as attempt_count,
                j.id,
                j.title,
                j.company,
                j.location,
                j.url,
                j.source,
                j.posted_at,
                j.description,
                j.fingerprint,
                ur.id as resume_id,
                ur.resume_json
            FROM user_jobs uj
            JOIN jobs j ON uj.job_id = j.id
            JOIN user_resumes ur ON ur.user_id = uj.user_id AND ur.is_active = 1
            WHERE (
                (uj.fit_score IS NULL AND uj.status = 'new')
                OR (uj.status IN ('score_failed', 'tailor_failed'))
            )
            AND COALESCE(uj.attempt_count, 0) < ?
            AND ur.resume_json IS NOT NULL
            ORDER BY uj.created_at ASC
            LIMIT ?
            """,
            (max_attempts, limit),
        )
        rows = cursor.fetchall()
        result = []
        for row in rows:
            d = dict(row)
            if d.get("resume_json"):
                try:
                    d["master_resume"] = json.loads(d["resume_json"])
                except Exception:
                    d["master_resume"] = None
            else:
                d["master_resume"] = None
            result.append(d)
        return result

    def mark_user_job_failed(self, user_job_id: str, error_message: str) -> dict[str, Any]:
        now = int(time.time() * 1000)
        fit_notes = json.dumps({"error": str(error_message)})
        self.conn.execute(
            """
            UPDATE user_jobs
            SET fit_notes = ?,
                status = 'score_failed',
                attempt_count = COALESCE(attempt_count, 0) + 1,
                updated_at = ?
            WHERE id = ?
            """,
            (fit_notes, now, user_job_id),
        )
        self.conn.commit()
        cursor = self.conn.execute("SELECT * FROM user_jobs WHERE id = ?", (user_job_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}

    def mark_job_failed(self, job_id: str, error_message: str) -> dict[str, Any]:
        now = int(time.time() * 1000)
        fit_notes = json.dumps({"error": str(error_message)})
        self.conn.execute(
            """
            UPDATE jobs
            SET fit_notes = ?,
                status = 'score_failed',
                attempt_count = COALESCE(attempt_count, 0) + 1,
                updated_at = ?
            WHERE id = ?
            """,
            (fit_notes, now, job_id),
        )
        self.conn.commit()
        cursor = self.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}

    def score_user_job(self, user_job_id: str, result: ScoreResult) -> dict[str, Any]:
        now = int(time.time() * 1000)
        is_valid = getattr(result, "is_valid_job", True)
        if not is_valid:
            status = "invalid_job"
        elif result.score >= self.threshold:
            status = "new"
        else:
            status = "rejected_by_score"

        fit_notes = json.dumps({
            "reasoning": result.reasoning,
            "matching_skills": result.matching_skills,
            "missing_skills": result.missing_skills,
            "is_valid_job": is_valid,
            "is_truncated": getattr(result, "is_truncated", False),
        })

        self.conn.execute(
            """
            UPDATE user_jobs
            SET fit_score = ?,
                fit_notes = ?,
                status = ?,
                attempt_count = 0,
                updated_at = ?
            WHERE id = ?
            """,
            (result.score if is_valid else None, fit_notes, status, now, user_job_id),
        )

        updates = []
        params = []
        if getattr(result, "clean_description", None) and result.clean_description.strip():
            updates.append("description = ?")
            params.append(result.clean_description.strip())
        if getattr(result, "clean_title", None) and result.clean_title.strip():
            updates.append("title = ?")
            params.append(result.clean_title.strip())
        if getattr(result, "clean_company", None) and result.clean_company.strip():
            updates.append("company = ?")
            params.append(result.clean_company.strip())

        if updates:
            updates.append("updated_at = ?")
            params.append(now)
            params.append(user_job_id)
            set_clause = ", ".join(updates)
            self.conn.execute(
                f"""
                UPDATE jobs
                SET {set_clause}
                WHERE id = (SELECT job_id FROM user_jobs WHERE id = ?)
                """,
                tuple(params),
            )
        self.conn.commit()

        cursor = self.conn.execute("SELECT * FROM user_jobs WHERE id = ?", (user_job_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}

    def update_user_job_tailoring(
        self,
        user_job_id: str,
        tailored_resume_id: str,
        status: str = "tailored",
    ) -> dict[str, Any]:
        now = int(time.time() * 1000)
        self.conn.execute(
            """
            UPDATE user_jobs
            SET tailored_resume_id = ?,
                status = ?,
                attempt_count = CASE WHEN ? = 'tailored' THEN 0 ELSE COALESCE(attempt_count, 0) + 1 END,
                updated_at = ?
            WHERE id = ?
            """,
            (tailored_resume_id, status, status, now, user_job_id),
        )
        self.conn.commit()

        cursor = self.conn.execute("SELECT * FROM user_jobs WHERE id = ?", (user_job_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}

    def get_unscored_jobs(
        self, limit: int = 50, max_attempts: int = 5
    ) -> list[dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT id, title, company, location, url, source, posted_at, description, fingerprint, liveness, fit_score, fit_notes, status, tailored_resume_id, COALESCE(attempt_count, 0) as attempt_count, created_at, updated_at
            FROM jobs
            WHERE (
                (fit_score IS NULL AND status = 'new')
                OR (status IN ('score_failed', 'tailor_failed'))
            )
            AND COALESCE(attempt_count, 0) < ?
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (max_attempts, limit),
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def score_job(self, job_id: str, result: ScoreResult) -> dict[str, Any]:
        now = int(time.time() * 1000)
        is_valid = getattr(result, "is_valid_job", True)
        if not is_valid:
            status = "invalid_job"
        elif result.score >= self.threshold:
            status = "new"
        else:
            status = "rejected_by_score"

        fit_notes = json.dumps({
            "reasoning": result.reasoning,
            "matching_skills": result.matching_skills,
            "missing_skills": result.missing_skills,
            "is_valid_job": is_valid,
            "is_truncated": getattr(result, "is_truncated", False),
        })

        updates = ["fit_score = ?", "fit_notes = ?", "status = ?", "attempt_count = 0", "updated_at = ?"]
        params = [result.score if is_valid else None, fit_notes, status, now]

        if getattr(result, "clean_description", None) and result.clean_description.strip():
            updates.append("description = ?")
            params.append(result.clean_description.strip())
        if getattr(result, "clean_title", None) and result.clean_title.strip():
            updates.append("title = ?")
            params.append(result.clean_title.strip())
        if getattr(result, "clean_company", None) and result.clean_company.strip():
            updates.append("company = ?")
            params.append(result.clean_company.strip())

        params.append(job_id)
        set_clause = ", ".join(updates)

        self.conn.execute(
            f"""
            UPDATE jobs
            SET {set_clause}
            WHERE id = ?
            """,
            tuple(params),
        )
        self.conn.commit()

        cursor = self.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}

    def update_job_tailoring(
        self,
        job_id: str,
        tailored_resume_id: str,
        status: str = "tailored",
    ) -> dict[str, Any]:
        now = int(time.time() * 1000)
        self.conn.execute(
            """
            UPDATE jobs
            SET tailored_resume_id = ?,
                status = ?,
                attempt_count = CASE WHEN ? = 'tailored' THEN 0 ELSE COALESCE(attempt_count, 0) + 1 END,
                updated_at = ?
            WHERE id = ?
            """,
            (tailored_resume_id, status, status, now, job_id),
        )
        self.conn.commit()

        cursor = self.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}

    def close(self) -> None:
        self.conn.close()
