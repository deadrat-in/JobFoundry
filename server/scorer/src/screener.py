from typing import Any
from src.llm import LLMClient, ScoreResult, StubLLM


class Screener:
    def __init__(self, llm_client: LLMClient | None = None):
        self.llm_client = llm_client or StubLLM()

    async def score(
        self,
        job: dict[str, Any],
        master_resume: dict[str, Any],
        llm_settings: dict[str, Any] | None = None,
    ) -> ScoreResult:
        """
        Evaluate a single job against the master resume.
        Returns a validated ScoreResult with score (0-100), reasoning, matching_skills, and missing_skills.
        """
        # Normalize / ensure minimum dictionary structures
        normalized_job = {
            "title": job.get("title", ""),
            "company": job.get("company", ""),
            "location": job.get("location", ""),
            "description": job.get("description", ""),
            "url": job.get("url", ""),
            "source": job.get("source", ""),
        }
        
        llm_kwargs = {} if llm_settings is None else {"llm_settings": llm_settings}
        result = await self.llm_client.score(
            job=normalized_job, resume=master_resume, **llm_kwargs
        )

        # Validate score boundaries (0-100)
        if not isinstance(result.score, int) or result.score < 0 or result.score > 100:
            raise ValueError(f"Score must be an integer between 0 and 100, got: {result.score}")

        return result
