import json
import sqlite3
import time
from typing import Any
from src.llm import ScoreResult


class JobStore:
    def __init__(self, db_path: str = ":memory:", threshold: int = 75):
        self.db_path = db_path
        self.threshold = threshold
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

    def init_schema(self, schema_sql: str) -> None:
        self.conn.executescript(schema_sql)
        self.conn.commit()

    def has_user_jobs_table(self) -> bool:
        cursor = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='user_jobs'"
        )
        return cursor.fetchone() is not None

    def get_unscored_user_jobs(self, limit: int = 50) -> list[dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT 
                uj.id as user_job_id,
                uj.user_id,
                uj.job_id,
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
            LEFT JOIN user_resumes ur ON ur.user_id = uj.user_id AND ur.is_active = 1
            WHERE uj.fit_score IS NULL AND uj.status = 'new'
            ORDER BY uj.created_at ASC
            LIMIT ?
            """,
            (limit,),
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

    def score_user_job(self, user_job_id: str, result: ScoreResult) -> dict[str, Any]:
        now = int(time.time() * 1000)
        status = "new" if result.score >= self.threshold else "rejected_by_score"
        fit_notes = json.dumps({
            "reasoning": result.reasoning,
            "matching_skills": result.matching_skills,
            "missing_skills": result.missing_skills,
        })

        self.conn.execute(
            """
            UPDATE user_jobs
            SET fit_score = ?,
                fit_notes = ?,
                status = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (result.score, fit_notes, status, now, user_job_id),
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
                updated_at = ?
            WHERE id = ?
            """,
            (tailored_resume_id, status, now, user_job_id),
        )
        self.conn.commit()

        cursor = self.conn.execute("SELECT * FROM user_jobs WHERE id = ?", (user_job_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}

    def get_unscored_jobs(self, limit: int = 50) -> list[dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT id, title, company, location, url, source, posted_at, description, fingerprint, liveness, fit_score, fit_notes, status, tailored_resume_id, created_at, updated_at
            FROM jobs
            WHERE fit_score IS NULL AND status = 'new'
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def score_job(self, job_id: str, result: ScoreResult) -> dict[str, Any]:
        now = int(time.time() * 1000)
        status = "new" if result.score >= self.threshold else "rejected_by_score"
        fit_notes = json.dumps({
            "reasoning": result.reasoning,
            "matching_skills": result.matching_skills,
            "missing_skills": result.missing_skills,
        })

        self.conn.execute(
            """
            UPDATE jobs
            SET fit_score = ?,
                fit_notes = ?,
                status = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (result.score, fit_notes, status, now, job_id),
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
                updated_at = ?
            WHERE id = ?
            """,
            (tailored_resume_id, status, now, job_id),
        )
        self.conn.commit()

        cursor = self.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}

    def close(self) -> None:
        self.conn.close()
