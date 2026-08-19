import asyncio
import json
import os
import pytest
from src.artifacts import ArtifactManager
from src.llm import LLMClient, ScoreResult
from src.screener import Screener
from src.store import JobStore
from src.tailor_bridge import TailorBridge, TailorResult
from src.worker import process_unscored_jobs


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  api_key TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_resumes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Master Resume',
  resume_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS user_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  fit_score INTEGER,
  fit_notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  tailored_resume_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, job_id)
);
"""


class DynamicScoreLLM(LLMClient):
    async def score(self, job: dict, resume: dict) -> ScoreResult:
        resume_name = resume.get("basics", {}).get("name", "")
        # Alice is Backend; Bob is Frontend
        if "Alice" in resume_name and "Go" in job.get("description", ""):
            return ScoreResult(
                score=95,
                reasoning="Alice is a great match for Go backend",
                matching_skills=["Go", "Microservices"],
                missing_skills=[],
            )
        elif "Bob" in resume_name and "React" in job.get("description", ""):
            return ScoreResult(
                score=90,
                reasoning="Bob is a great match for React frontend",
                matching_skills=["React", "TypeScript"],
                missing_skills=[],
            )
        else:
            return ScoreResult(
                score=40,
                reasoning="Skills do not match candidate profile",
                matching_skills=[],
                missing_skills=["Required primary tech stack"],
            )


class MockTailorBridge(TailorBridge):
    async def tailor(self, job: dict, master_resume: dict, theme: str = "jsonresume-theme-folio"):
        return TailorResult(
            resume=master_resume,
            pdf_base64="JVBERi0xLjQKJcTl8uXr",
            theme=theme,
            plain_text="Sample ATS Resume Text",
            status="completed",
            task_id=f"tailor-{theme}",
        )


@pytest.mark.asyncio
async def test_multi_user_worker_scoring_and_isolation(tmp_path):
    db_path = str(tmp_path / "test.db")
    store = JobStore(db_path=db_path, threshold=75)
    store.init_schema(SCHEMA_SQL)

    # 1. Create Users
    now = 1700000000000
    store.conn.execute(
        "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("u_alice", "alice@example.com", "hash", "Alice", "key_a", now, now),
    )
    store.conn.execute(
        "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("u_bob", "bob@example.com", "hash", "Bob", "key_b", now, now),
    )

    # 2. Upload active resumes
    alice_resume = json.dumps({"basics": {"name": "Alice Backend", "label": "Go Architect"}})
    bob_resume = json.dumps({"basics": {"name": "Bob Frontend", "label": "React Engineer"}})

    store.conn.execute(
        "INSERT INTO user_resumes VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("r_alice", "u_alice", "Alice Resume", alice_resume, 1, now, now),
    )
    store.conn.execute(
        "INSERT INTO user_resumes VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("r_bob", "u_bob", "Bob Resume", bob_resume, 1, now, now),
    )

    # 3. Create global jobs: Go Job and React Job
    store.conn.execute(
        "INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("j_go", "Go Lead", "Alpha", "Remote", "http://alpha.test/go", "gh", now, "Go backend microservices", "fp1", "ok", None, None, "new", None, now, now),
    )
    store.conn.execute(
        "INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("j_react", "React Lead", "Beta", "Remote", "http://beta.test/react", "gh", now, "React web UI", "fp2", "ok", None, None, "new", None, now, now),
    )

    # 4. User Jobs: Alice has Go and React; Bob has Go and React
    store.conn.execute(
        "INSERT INTO user_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("uj_a_go", "u_alice", "j_go", None, None, "new", None, now, now),
    )
    store.conn.execute(
        "INSERT INTO user_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("uj_a_react", "u_alice", "j_react", None, None, "new", None, now, now),
    )
    store.conn.execute(
        "INSERT INTO user_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("uj_b_go", "u_bob", "j_go", None, None, "new", None, now, now),
    )
    store.conn.execute(
        "INSERT INTO user_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("uj_b_react", "u_bob", "j_react", None, None, "new", None, now, now),
    )
    store.conn.commit()

    screener = Screener(llm_client=DynamicScoreLLM())
    artifact_mgr = ArtifactManager(base_dir=tmp_path / "artifacts")
    tailor = MockTailorBridge(base_url="http://mock-tailor")

    # Run multi-tenant worker
    result = await process_unscored_jobs(
        store=store,
        screener=screener,
        tailor_bridge=tailor,
        artifact_manager=artifact_mgr,
    )

    assert result["processed"] == 4
    assert result["passed"] == 2 # Alice on Go, Bob on React
    assert result["rejected"] == 2 # Alice on React, Bob on Go
    assert result["tailored"] == 2

    # Check Alice's rows
    alice_go = store.conn.execute("SELECT * FROM user_jobs WHERE id = 'uj_a_go'").fetchone()
    assert alice_go["fit_score"] == 95
    assert alice_go["status"] == "tailored"

    alice_react = store.conn.execute("SELECT * FROM user_jobs WHERE id = 'uj_a_react'").fetchone()
    assert alice_react["fit_score"] == 40
    assert alice_react["status"] == "rejected_by_score"

    # Check Bob's rows
    bob_go = store.conn.execute("SELECT * FROM user_jobs WHERE id = 'uj_b_go'").fetchone()
    assert bob_go["fit_score"] == 40
    assert bob_go["status"] == "rejected_by_score"

    bob_react = store.conn.execute("SELECT * FROM user_jobs WHERE id = 'uj_b_react'").fetchone()
    assert bob_react["fit_score"] == 90
    assert bob_react["status"] == "tailored"

    # Check artifact directory isolation
    assert (tmp_path / "artifacts" / "u_alice" / "j_go" / "resume.json").exists()
    assert (tmp_path / "artifacts" / "u_bob" / "j_react" / "resume.json").exists()
