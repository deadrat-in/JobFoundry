import logging
import os
import time
from typing import Protocol, runtime_checkable, Any
from pydantic import BaseModel, Field
import toons
import instructor
import litellm
from litellm import acompletion

logger = logging.getLogger(__name__)


def format_resume_for_prompt(resume: dict[str, Any]) -> str:
    """
    Format the master resume into TOON (Token-Oriented Object Notation)
    to minimize prompt tokens while preserving structured hierarchy and tabular arrays.
    Falls back to string representation on serialization error.
    """
    if not resume:
        return ""
    try:
        return toons.dumps(resume)
    except Exception as e:
        logger.warning("Failed to serialize resume to TOON format (%s); falling back to string", e)
        return str(resume)


def setup_observability():
    opik_api_key = os.getenv("OPIK_API_KEY")
    opik_url_override = os.getenv("OPIK_URL_OVERRIDE")
    if opik_api_key or opik_url_override:
        current_success = getattr(litellm, "success_callback", []) or []
        current_failure = getattr(litellm, "failure_callback", []) or []
        if "opik" not in current_success:
            litellm.success_callback = list(current_success) + ["opik"]
        if "opik" not in current_failure:
            litellm.failure_callback = list(current_failure) + ["opik"]
        logger.info("Opik LLM tracing activated via LiteLLM callbacks")


setup_observability()


class ScoreResult(BaseModel):
    score: int = Field(..., ge=0, le=100, description="Fit score from 0 to 100")
    reasoning: str = Field(..., description="Explanation of the match and scoring rationale")
    missing_skills: list[str] = Field(default_factory=list, description="Skills required/preferred by the job but missing in the resume")
    matching_skills: list[str] = Field(default_factory=list, description="Skills present in both the resume and the job requirements")
    clean_description: str | None = Field(
        default=None,
        description="Sanitized and structured job description in Markdown (Role Overview, Responsibilities, Requirements). Prunes corporate boilerplate, EEOC disclaimers, cookie notices, and application URL noise while preserving all technical and qualification requirements.",
    )
    is_truncated: bool = Field(
        default=False,
        description="True if the provided job description appears incomplete, cut off mid-sentence, or truncated.",
    )


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
            clean_description=None,
            is_truncated=False,
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
        resume_str = format_resume_for_prompt(resume)
        prompt = (
            f"You are an expert technical recruiter, resume screener, and job analyst.\n"
            f"Evaluate the candidate's master resume against the following job posting.\n"
            f"Provide a realistic fit score (0-100), concise reasoning, matching skills, and missing skills.\n"
            f"Also, sanitize the job description into clean, well-structured Markdown (Role Overview, Responsibilities, Requirements) "
            f"by stripping all corporate boilerplate, EEOC/diversity statements, and application links in `clean_description`.\n"
            f"If the job description is visibly cut off, ends mid-sentence, or lacks actual requirements, set `is_truncated: true`.\n\n"
            f"--- JOB POSTING ---\n"
            f"Title: {job.get('title', '')}\n"
            f"Company: {job.get('company', '')}\n"
            f"Location: {job.get('location', '')}\n"
            f"Description:\n{job.get('description', '')}\n\n"
            f"--- MASTER RESUME (TOON format) ---\n"
            f"{resume_str}\n"
        )

        kwargs: dict[str, Any] = {
            "model": self.model,
            "response_model": ScoreResult,
            "messages": [
                {"role": "system", "content": "You evaluate resume-to-job fit and return structured scoring results including cleaned description."},
                {"role": "user", "content": prompt},
            ],
            "max_retries": 2,
        }
        if self.api_key:
            kwargs["api_key"] = self.api_key
        if self.api_base:
            kwargs["api_base"] = self.api_base

        start_time = time.perf_counter()
        job_id = job.get("id", "unknown")
        logger.info("Evaluating job %s with model %s", job_id, self.model)
        try:
            result: ScoreResult = await self.client.chat.completions.create(**kwargs)
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.info(
                "Job %s evaluated in %.2fms: score=%d, matching=%d, missing=%d",
                job_id,
                duration_ms,
                result.score,
                len(result.matching_skills),
                len(result.missing_skills),
            )
            return result
        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.error(
                "LLM evaluation failed for job %s after %.2fms: %s",
                job_id,
                duration_ms,
                e,
            )
            raise
