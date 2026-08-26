from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from src.llm import LLMClient, StubLLM, ScoreResult
from src.store import JobStore
from src.screener import Screener
from src.tailor_bridge import TailorBridge
from src.artifacts import ArtifactManager
from src.worker import WorkerDaemon


class ScoreRequest(BaseModel):
    job: dict[str, Any] = Field(..., description="Job posting details (title, company, description, etc.)")
    masterResume: dict[str, Any] = Field(..., description="Master resume JSON structure")


@asynccontextmanager
async def lifespan(app: FastAPI):
    daemon: WorkerDaemon | None = getattr(app.state, "daemon", None)
    if daemon:
        daemon.start()
    yield
    if daemon:
        await daemon.stop()


def create_app(
    llm_client: LLMClient | None = None,
    config: Any = None,
    worker_daemon: WorkerDaemon | None = None,
) -> FastAPI:
    app = FastAPI(
        title="JobFoundry Scorer",
        version="0.1.0",
        description="Fit screener evaluating jobs against master resume",
        lifespan=lifespan,
    )

    client: LLMClient = llm_client or StubLLM()

    if worker_daemon:
        app.state.daemon = worker_daemon
    elif config:
        store = JobStore(
            db_path=getattr(config, "db_path", "./jobs.db"),
            threshold=getattr(config, "scorer_threshold", 75),
        )
        screener = Screener(llm_client=client)
        resume_ops_url = getattr(config, "resume_ops_url", None)
        tailor_bridge = TailorBridge(base_url=resume_ops_url) if resume_ops_url else None
        artifact_manager = ArtifactManager(
            base_dir=getattr(config, "artifacts_dir", "./data/artifacts")
        )
        app.state.daemon = WorkerDaemon(
            store=store,
            screener=screener,
            tailor_bridge=tailor_bridge,
            artifact_manager=artifact_manager,
            poll_interval_seconds=getattr(config, "worker_poll_interval_seconds", 10.0),
            enabled=getattr(config, "worker_enabled", True),
        )
    else:
        app.state.daemon = None

    @app.api_route("/health", methods=["GET", "HEAD"])
    async def health():
        return {"status": "ok"}

    @app.get("/diagnostics")
    async def diagnostics():
        daemon: WorkerDaemon | None = getattr(app.state, "daemon", None)
        return {
            "status": "healthy",
            "service": "jobfoundry-scorer",
            "model": getattr(config, "scorer_model", "unknown") if config else "unknown",
            "threshold": getattr(config, "scorer_threshold", 75) if config else 75,
            "opik_enabled": bool(getattr(config, "opik_api_key", None) or getattr(config, "opik_url_override", None)) if config else False,
            "opik_project": getattr(config, "opik_project_name", "jobfoundry") if config else "jobfoundry",
            "worker": daemon.get_status() if daemon else {"running": False, "enabled": False},
        }

    @app.get("/api/v1/worker/status")
    async def worker_status():
        daemon: WorkerDaemon | None = getattr(app.state, "daemon", None)
        if not daemon:
            return {"running": False, "enabled": False}
        return daemon.get_status()

    @app.post("/api/v1/worker/tick")
    async def worker_tick():
        daemon: WorkerDaemon | None = getattr(app.state, "daemon", None)
        if not daemon:
            raise HTTPException(status_code=400, detail="Worker daemon not configured")
        return await daemon.tick()

    @app.post("/score", response_model=ScoreResult)
    async def score_job(req: ScoreRequest):
        try:
            result = await client.score(job=req.job, resume=req.masterResume)
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return app
