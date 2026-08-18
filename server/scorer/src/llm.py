from typing import Protocol, runtime_checkable, Any
from pydantic import BaseModel, Field
import instructor
from litellm import acompletion


class ScoreResult(BaseModel):
    score: int = Field(..., ge=0, le=100, description="Fit score from 0 to 100")
    reasoning: str = Field(..., description="Explanation of the match and scoring rationale")
    missing_skills: list[str] = Field(default_factory=list, description="Skills required/preferred by the job but missing in the resume")
    matching_skills: list[str] = Field(default_factory=list, description="Skills present in both the resume and the job requirements")


@runtime_checkable
class LLMClient(Protocol):
    async def score(self, job: dict[str, Any], resume: dict[str, Any]) -> ScoreResult:
        ...


class StubLLM:
    def __init__(self, default_result: ScoreResult | None = None):
        self.default_result = default_result or ScoreResult(
            score=80,
            reasoning="Default stub reasoning",
            missing_skills=[],
            matching_skills=[],
        )
        self.call_history: list[tuple[dict[str, Any], dict[str, Any]]] = []

    async def score(self, job: dict[str, Any], resume: dict[str, Any]) -> ScoreResult:
        self.call_history.append((job, resume))
        return self.default_result


class LiteLLMClient:
    def __init__(self, model: str = "gpt-4o-mini", api_key: str | None = None, api_base: str | None = None):
        self.model = model
        self.api_key = api_key
        self.api_base = api_base
        self.client = instructor.from_litellm(acompletion, mode=instructor.Mode.MD_JSON)


    async def score(self, job: dict[str, Any], resume: dict[str, Any]) -> ScoreResult:
        prompt = (
            f"You are an expert technical recruiter and resume screener.\n"
            f"Evaluate the candidate's master resume against the following job posting.\n"
            f"Provide a realistic fit score (0-100), concise reasoning, matching skills, and missing skills.\n\n"
            f"--- JOB POSTING ---\n"
            f"Title: {job.get('title', '')}\n"
            f"Company: {job.get('company', '')}\n"
            f"Location: {job.get('location', '')}\n"
            f"Description:\n{job.get('description', '')}\n\n"
            f"--- MASTER RESUME ---\n"
            f"{resume}\n"
        )

        kwargs: dict[str, Any] = {
            "model": self.model,
            "response_model": ScoreResult,
            "messages": [
                {"role": "system", "content": "You evaluate resume-to-job fit and return structured scoring results."},
                {"role": "user", "content": prompt},
            ],
            "max_retries": 2,
        }
        if self.api_key:
            kwargs["api_key"] = self.api_key
        if self.api_base:
            kwargs["api_base"] = self.api_base

        result: ScoreResult = await self.client.chat.completions.create(**kwargs)
        return result
