from __future__ import annotations

import uvicorn

from resume_ops_api.api.app import create_app
from resume_ops_api.core.config import get_settings


def run() -> None:
    settings = get_settings()
    if not settings.openai_base_url or not settings.openai_base_url.strip():
        raise RuntimeError(
            "No LLM API base configured. Set OPENROUTER_API_BASE or "
            "OPENAI_BASE_URL in the environment."
        )
    uvicorn.run(
        "resume_ops_api.main:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=False,
    )
