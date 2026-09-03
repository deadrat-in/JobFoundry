import logging
from typing import Any
import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class TailorResult(BaseModel):
    resume: dict[str, Any] = Field(..., description="Tailored JSON Resume dictionary")
    pdf_base64: str | None = Field(default=None, description="Base64 encoded PDF bytes")
    theme: str = Field(default="jsonresume-theme-folio", description="Theme used for rendering")
    plain_text: str | None = Field(default=None, description="ATS plain text")
    task_id: str | None = Field(default=None, description="Task ID if queued asynchronously")
    status: str = Field(default="completed", description="Status of tailoring job")


class TailorBridge:
    def __init__(
        self,
        base_url: str | None = None,
        timeout: float = 900.0,
        client: httpx.AsyncClient | None = None,
    ):
        self.base_url = base_url.rstrip("/") if base_url else None
        self.timeout = timeout
        self._client = client

    async def tailor(
        self,
        job: dict[str, Any],
        master_resume: dict[str, Any],
        theme: str = "jsonresume-theme-folio",
    ) -> TailorResult | None:
        """
        Send a job description and master resume to resume-ops for tailoring.
        Returns TailorResult on success, or None if skipped/failed.
        """
        if not self.base_url:
            logger.info("RESUME_OPS_URL is not set; skipping tailoring bridge call.")
            return None

        url = f"{self.base_url}/api/v1/tailor"
        payload = {
            "job_description": job.get("description", ""),
            "resume": master_resume,
            "theme": theme,
        }

        try:
            if self._client:
                response = await self._client.post(url, json=payload, timeout=self.timeout)
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.post(url, json=payload, timeout=self.timeout)

            if response.status_code == 200:
                data = response.json()
                return TailorResult(
                    resume=data.get("resume", {}),
                    pdf_base64=data.get("pdf_base64"),
                    theme=data.get("theme", theme),
                    plain_text=data.get("plain_text"),
                    status="completed",
                )
            elif response.status_code == 202:
                data = response.json()
                return TailorResult(
                    resume={},
                    task_id=data.get("task_id"),
                    theme=theme,
                    status="queued",
                )
            else:
                logger.error(
                    "Tailoring request failed with status %s: %s",
                    response.status_code,
                    response.text,
                )
                return None
        except Exception as e:
            logger.error("Exception during tailor bridge request to %s: %r", url, e)
            return None
