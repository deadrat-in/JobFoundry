import time
from pathlib import Path
import pytest
import httpx
from src.artifacts import ArtifactManager
from src.llm import ScoreResult
from src.screener import Screener
from src.store import JobStore
from src.tailor_bridge import TailorBridge
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


class DynamicStub:
    async def score(self, job, resume):
        if "Hardware" in job.get("title", ""):
            return ScoreResult(score=40, reasoning="Mismatch", missing_skills=["FPGA"], matching_skills=[])
        return ScoreResult(score=90, reasoning="Strong fit", missing_skills=[], matching_skills=["Python", "React"])


@pytest.mark.asyncio
async def test_process_unscored_jobs_batch_without_tailor():
    store = JobStore(db_path=":memory:", threshold=75)
    store.init_schema(SCHEMA_SQL)

    now = int(time.time() * 1000)
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

    screener = Screener(llm_client=DynamicStub())
    resume = {"name": "Dev", "skills": ["Python", "React"]}

    summary = await process_unscored_jobs(store=store, screener=screener, master_resume=resume, limit=10)

    assert summary["processed"] == 2
    assert summary["passed"] == 1
    assert summary["rejected"] == 1
    assert summary["tailored"] == 0

    high_row = store.conn.execute("SELECT fit_score, status FROM jobs WHERE id = ?", ("job-high",)).fetchone()
    assert high_row[0] == 90
    assert high_row[1] == "new"


@pytest.mark.asyncio
async def test_process_unscored_jobs_batch_with_tailoring_and_artifacts(tmp_path: Path):
    store = JobStore(db_path=":memory:", threshold=75)
    store.init_schema(SCHEMA_SQL)

    now = int(time.time() * 1000)
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

    # Mock resume-ops server
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "resume": {"name": "Dev", "label": "Fullstack Engineer"},
                "pdf_base64": "JVBERi0xLjQK...",
                "theme": "jsonresume-theme-folio",
                "plain_text": "Name: Dev\nTitle: Fullstack Engineer",
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://resume-ops:8081") as http_client:
        bridge = TailorBridge(base_url="http://resume-ops:8081", client=http_client)
        artifact_mgr = ArtifactManager(base_dir=tmp_path)
        screener = Screener(llm_client=DynamicStub())
        resume = {"name": "Dev", "skills": ["Python", "React"]}

        summary = await process_unscored_jobs(
            store=store,
            screener=screener,
            master_resume=resume,
            tailor_bridge=bridge,
            artifact_manager=artifact_mgr,
            limit=10,
        )

        assert summary["processed"] == 2
        assert summary["passed"] == 1
        assert summary["rejected"] == 1
        assert summary["tailored"] == 1

        # Check job-high is now tailored
        high_row = store.conn.execute(
            "SELECT fit_score, status, tailored_resume_id FROM jobs WHERE id = ?", ("job-high",)
        ).fetchone()
        assert high_row[0] == 90
        assert high_row[1] == "tailored"
        assert high_row[2] is not None

        # Check job-low is still rejected_by_score and never tailored
        low_row = store.conn.execute(
            "SELECT fit_score, status, tailored_resume_id FROM jobs WHERE id = ?", ("job-low",)
        ).fetchone()
        assert low_row[0] == 40
        assert low_row[1] == "rejected_by_score"
        assert low_row[2] is None

        # Check artifact files exist for job-high
        job_dir = tmp_path / "job-high"
        assert job_dir.exists()
        assert (job_dir / "resume.json").exists()
        assert (job_dir / "resume.txt").exists()
