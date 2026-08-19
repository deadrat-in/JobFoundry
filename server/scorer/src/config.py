import os
from dataclasses import dataclass


@dataclass
class ScorerConfig:
    scorer_model: str = "gpt-4o-mini"
    scorer_provider: str | None = None
    scorer_api_key: str | None = None
    scorer_api_base: str | None = None
    scorer_threshold: int = 75
    db_path: str = "./jobs.db"
    resume_ops_url: str | None = None
    artifacts_dir: str = "./data/artifacts"
    port: int = 8001
    host: str = "0.0.0.0"



def load_config() -> ScorerConfig:
    scorer_model = os.getenv("SCORER_MODEL", "gpt-4o-mini")


    scorer_provider = os.getenv("SCORER_PROVIDER")
    raw_threshold = os.getenv("SCORER_THRESHOLD", "75")

    try:
        scorer_threshold = int(raw_threshold)
    except ValueError as e:
        raise ValueError(f"Invalid SCORER_THRESHOLD: {raw_threshold}") from e

    if scorer_threshold < 0 or scorer_threshold > 100:
        raise ValueError(f"Threshold must be between 0 and 100, got: {scorer_threshold}")

    db_path = os.getenv("DB_PATH", "./jobs.db")
    resume_ops_url = os.getenv("RESUME_OPS_URL")
    artifacts_dir = os.getenv("ARTIFACTS_DIR", "./data/artifacts")
    scorer_api_key = (
        os.getenv("OPENROUTER_API_KEY")
        or os.getenv("SCORER_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    )
    scorer_api_base = (
        os.getenv("OPENROUTER_API_BASE")
        or os.getenv("SCORER_API_BASE")
        or os.getenv("OPENAI_API_BASE")
    )
    
    raw_port = os.getenv("PORT", "8001")
    try:
        port = int(raw_port)
    except ValueError as e:
        raise ValueError(f"Invalid PORT: {raw_port}") from e

    host = os.getenv("HOST", "0.0.0.0")

    return ScorerConfig(
        scorer_model=scorer_model,
        scorer_provider=scorer_provider,
        scorer_api_key=scorer_api_key,
        scorer_api_base=scorer_api_base,
        scorer_threshold=scorer_threshold,
        db_path=db_path,
        resume_ops_url=resume_ops_url,
        artifacts_dir=artifacts_dir,
        port=port,
        host=host,
    )

