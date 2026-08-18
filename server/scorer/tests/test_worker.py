import time
import pytest
from src.llm import StubLLM, ScoreResult
from src.screener import Screener
from src.store import JobStore
from src.worker import process_unscored_jobs


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  posted_at INTEGER,
  description TEXT,
  fingerprint TEXT,
  liveness TEXT NOT NULL DEFAULT 'unknown',
  fit_score INTEGER,
  fit_notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  tailored_resume_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
"""


@pytest.mark.asyncio
async def test_process_unscored_jobs_batch():
    store = JobStore(db_path=":memory:", threshold=75)
    store.init_schema(SCHEMA_SQL)

    now = int(time.time() * 1000)
    # Insert 2 unscored jobs
    store.conn.execute(
        """
        INSERT INTO jobs (id, title, company, url, source, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("job-high", "Fullstack Engineer", "Acme", "https://example.com/high", "test", "Python React", now, now),
    )
    store.conn.execute(
        """
        INSERT INTO jobs (id, title, company, url, source, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("job-low", "Hardware Engineer", "Acme", "https://example.com/low", "test", "FPGA Verilog", now, now),
    )
    store.conn.commit()

    # Custom LLM stub that returns high score for high job, low score for low job
    class DynamicStub:
        async def score(self, job, resume):
            if "Hardware" in job.get("title", ""):
                return ScoreResult(score=40, reasoning="Mismatch", missing_skills=["FPGA"], matching_skills=[])
            return ScoreResult(score=90, reasoning="Strong fit", missing_skills=[], matching_skills=["Python", "React"])

    screener = Screener(llm_client=DynamicStub())
    resume = {"name": "Dev", "skills": ["Python", "React"]}

    summary = await process_unscored_jobs(store=store, screener=screener, master_resume=resume, limit=10)

    assert summary["processed"] == 2
    assert summary["passed"] == 1
    assert summary["rejected"] == 1

    # Check store states
    unscored_remaining = store.get_unscored_jobs()
    assert len(unscored_remaining) == 0

    high_row = store.conn.execute("SELECT fit_score, status FROM jobs WHERE id = ?", ("job-high",)).fetchone()
    assert high_row[0] == 90
    assert high_row[1] == "new"

    low_row = store.conn.execute("SELECT fit_score, status FROM jobs WHERE id = ?", ("job-low",)).fetchone()
    assert low_row[0] == 40
    assert low_row[1] == "rejected_by_score"
