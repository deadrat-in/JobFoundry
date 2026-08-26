import asyncio
import time
import pytest
from fastapi.testclient import TestClient
from src.app import create_app
from src.config import ScorerConfig
from src.llm import StubLLM, ScoreResult
from src.screener import Screener
from src.store import JobStore
from src.worker import WorkerDaemon


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
  attempt_count INTEGER NOT NULL DEFAULT 0,
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
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, job_id)
);
"""


@pytest.fixture
def store():
    st = JobStore(":memory:", threshold=75)
    st.init_schema(SCHEMA_SQL)
    return st


@pytest.fixture
def screener():
    stub = StubLLM(
        default_result=ScoreResult(
            score=88,
            reasoning="Excellent alignment with required skills",
            missing_skills=[],
            matching_skills=["Python", "FastAPI"],
        )
    )
    return Screener(llm_client=stub)


@pytest.mark.asyncio
async def test_worker_daemon_lifecycle_and_tick(store: JobStore, screener: Screener):
    daemon = WorkerDaemon(
        store=store,
        screener=screener,
        poll_interval_seconds=0.1,
        enabled=True,
    )
    assert not daemon.is_running
    status = daemon.get_status()
    assert status["running"] is False
    assert status["enabled"] is True

    # Run manual tick
    res = await daemon.tick()
    assert res["ok"] is True
    assert res["status"] == "completed"

    # Start loop
    daemon.start()
    assert daemon.is_running
    await asyncio.sleep(0.25)

    # Stop loop
    await daemon.stop()
    assert not daemon.is_running


@pytest.mark.asyncio
async def test_worker_daemon_overlap_lock(store: JobStore):
    # Screener with simulated latency
    class SlowStubLLM(StubLLM):
        async def score(self, job, resume):
            await asyncio.sleep(0.2)
            return ScoreResult(score=80, reasoning="slow score", missing_skills=[], matching_skills=[])

    slow_screener = Screener(llm_client=SlowStubLLM())

    # Seed user, resume, and job
    now = int(time.time() * 1000)
    store.conn.execute(
        "INSERT INTO users VALUES ('u1', 'u@test.com', 'hash', 'User', 'k1', ?, ?)",
        (now, now),
    )
    store.conn.execute(
        "INSERT INTO user_resumes VALUES ('r1', 'u1', 'Master', '{\"name\":\"User\"}', 1, ?, ?)",
        (now, now),
    )
    store.conn.execute(
        "INSERT INTO jobs VALUES ('j1', 'Dev', 'Co', 'Remote', 'http://1', 'gh', ?, 'desc', 'fp1', 'unknown', NULL, NULL, 'new', NULL, 0, ?, ?)",
        (now, now, now),
    )
    store.conn.execute(
        "INSERT INTO user_jobs VALUES ('uj1', 'u1', 'j1', NULL, NULL, 'new', NULL, 0, ?, ?)",
        (now, now),
    )
    store.conn.commit()

    daemon = WorkerDaemon(
        store=store,
        screener=slow_screener,
        poll_interval_seconds=10.0,
        enabled=True,
    )

    # Launch two ticks concurrently
    t1 = asyncio.create_task(daemon.tick())
    await asyncio.sleep(0.01)  # allow t1 to acquire lock
    t2 = asyncio.create_task(daemon.tick())

    r1, r2 = await asyncio.gather(t1, t2)
    assert r1["status"] == "completed"
    assert r2["status"] == "already_running"


@pytest.mark.asyncio
async def test_worker_daemon_self_heals_on_startup(store: JobStore, screener: Screener):
    now = int(time.time() * 1000)
    store.conn.execute(
        "INSERT INTO users VALUES ('u1', 'u@test.com', 'hash', 'User', 'k1', ?, ?)",
        (now, now),
    )
    store.conn.execute(
        "INSERT INTO jobs VALUES ('j1', 'Dev', 'Co', 'Remote', 'http://1', 'gh', ?, 'desc', 'fp1', 'unknown', NULL, NULL, 'scoring', NULL, 0, ?, ?)",
        (now, now, now),
    )
    store.conn.execute(
        "INSERT INTO user_jobs VALUES ('uj1', 'u1', 'j1', NULL, NULL, 'scoring', NULL, 0, ?, ?)",
        (now, now),
    )
    store.conn.commit()

    daemon = WorkerDaemon(store=store, screener=screener, enabled=True)
    daemon.start()
    await daemon.stop()

    row = store.conn.execute("SELECT status FROM user_jobs WHERE id='uj1'").fetchone()
    assert row["status"] == "new"


@pytest.mark.asyncio
async def test_worker_daemon_background_loop_overlap_with_tick(store: JobStore):
    """
    Assert that calling tick while the background polling loop is mid-flight
    returns 'already_running' and does NOT start a second concurrent pass.
    """
    class SlowStubLLM(StubLLM):
        async def score(self, job, resume):
            await asyncio.sleep(0.3)
            return ScoreResult(score=80, reasoning="slow score", missing_skills=[], matching_skills=[])

    slow_screener = Screener(llm_client=SlowStubLLM())

    now = int(time.time() * 1000)
    store.conn.execute(
        "INSERT INTO users VALUES ('u1', 'u@test.com', 'hash', 'User', 'k1', ?, ?)",
        (now, now),
    )
    store.conn.execute(
        "INSERT INTO user_resumes VALUES ('r1', 'u1', 'Master', '{\"name\":\"User\"}', 1, ?, ?)",
        (now, now),
    )
    store.conn.execute(
        "INSERT INTO jobs VALUES ('j1', 'Dev', 'Co', 'Remote', 'http://1', 'gh', ?, 'desc', 'fp1', 'unknown', NULL, NULL, 'new', NULL, 0, ?, ?)",
        (now, now, now),
    )
    store.conn.execute(
        "INSERT INTO user_jobs VALUES ('uj1', 'u1', 'j1', NULL, NULL, 'new', NULL, 0, ?, ?)",
        (now, now),
    )
    store.conn.commit()

    daemon = WorkerDaemon(
        store=store,
        screener=slow_screener,
        poll_interval_seconds=0.05,
        enabled=True,
    )

    daemon.start()
    # Wait for the background loop to pick up the job and enter slow scoring
    await asyncio.sleep(0.1)
    assert daemon._in_flight is True

    # Attempt a manual tick while background loop is mid-cycle
    tick_result = await daemon.tick()
    assert tick_result["ok"] is True
    assert tick_result["status"] == "already_running"

    await daemon.stop()


@pytest.mark.asyncio
async def test_worker_retry_cap_terminal_state(store: JobStore):
    """
    Assert that when scoring or tailoring repeatedly fails, attempt_count is incremented
    and after 5 attempts (max_attempts), the job enters a terminal state and is ignored
    by the worker loop.
    """
    class FailingLLM(StubLLM):
        async def score(self, job, resume):
            raise RuntimeError("LLM provider unavailable or timeout")

    failing_screener = Screener(llm_client=FailingLLM())

    now = int(time.time() * 1000)
    store.conn.execute(
        "INSERT INTO users VALUES ('u1', 'u@test.com', 'hash', 'User', 'k1', ?, ?)",
        (now, now),
    )
    store.conn.execute(
        "INSERT INTO user_resumes VALUES ('r1', 'u1', 'Master', '{\"name\":\"User\"}', 1, ?, ?)",
        (now, now),
    )
    store.conn.execute(
        "INSERT INTO jobs VALUES ('j1', 'Dev', 'Co', 'Remote', 'http://1', 'gh', ?, 'desc', 'fp1', 'unknown', NULL, NULL, 'new', NULL, 0, ?, ?)",
        (now, now, now),
    )
    store.conn.execute(
        "INSERT INTO user_jobs VALUES ('uj1', 'u1', 'j1', NULL, NULL, 'new', NULL, 0, ?, ?)",
        (now, now),
    )
    store.conn.commit()

    daemon = WorkerDaemon(
        store=store,
        screener=failing_screener,
        poll_interval_seconds=10.0,
        enabled=True,
    )

    # Run 5 failed ticks
    for i in range(5):
        res = await daemon.tick()
        assert res["ok"] is True
        row = store.conn.execute("SELECT status, attempt_count FROM user_jobs WHERE id='uj1'").fetchone()
        assert row["status"] == "score_failed"
        assert row["attempt_count"] == i + 1

    # On the 6th tick, get_unscored_user_jobs ignores the job (attempt_count == 5 >= max_attempts 5)
    unscored = store.get_unscored_user_jobs(limit=10, max_attempts=5)
    assert len(unscored) == 0

    res_after_cap = await daemon.tick()
    assert res_after_cap["ok"] is True
    assert res_after_cap["result"]["processed"] == 0


def test_api_worker_endpoints():
    config = ScorerConfig(db_path=":memory:", worker_enabled=False)
    app = create_app(llm_client=StubLLM(), config=config)
    with TestClient(app) as client:
        res = client.get("/api/v1/worker/status")
        assert res.status_code == 200
        data = res.json()
        assert "running" in data
        assert "in_flight" in data

        tick_res = client.post("/api/v1/worker/tick")
        assert tick_res.status_code == 200
        assert tick_res.json()["ok"] is True
