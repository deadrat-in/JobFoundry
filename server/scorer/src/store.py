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

    def close(self) -> None:
        self.conn.close()
