from typing import Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from src.llm import LLMClient, StubLLM, ScoreResult


class ScoreRequest(BaseModel):
    job: dict[str, Any] = Field(..., description="Job posting details (title, company, description, etc.)")
    masterResume: dict[str, Any] = Field(..., description="Master resume JSON structure")


def create_app(llm_client: LLMClient | None = None, config: Any = None) -> FastAPI:
    app = FastAPI(
        title="JobFoundry Scorer",
        version="0.1.0",
        description="Fit screener evaluating jobs against master resume",
    )

    client: LLMClient = llm_client or StubLLM()

    @app.api_route("/health", methods=["GET", "HEAD"])
    async def health():
        return {"status": "ok"}

    @app.get("/diagnostics")
    async def diagnostics():
        return {
            "status": "healthy",
            "service": "jobfoundry-scorer",
            "model": getattr(config, "scorer_model", "unknown") if config else "unknown",
            "threshold": getattr(config, "scorer_threshold", 75) if config else 75,
            "opik_enabled": bool(getattr(config, "opik_api_key", None) or getattr(config, "opik_url_override", None)) if config else False,
            "opik_project": getattr(config, "opik_project_name", "jobfoundry") if config else "jobfoundry",
        }

    @app.post("/score", response_model=ScoreResult)
    async def score_job(req: ScoreRequest):
        try:
            result = await client.score(job=req.job, resume=req.masterResume)
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return app
