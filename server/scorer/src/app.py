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

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/score", response_model=ScoreResult)
    async def score_job(req: ScoreRequest):
        try:
            result = await client.score(job=req.job, resume=req.masterResume)
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return app
