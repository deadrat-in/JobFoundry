import os
from dataclasses import dataclass


@dataclass
class ScorerConfig:
    scorer_model: str = "gpt-4o-mini"
    scorer_provider: str | None = None
    scorer_threshold: int = 75
    db_path: str = "./jobs.db"
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
    
    raw_port = os.getenv("PORT", "8001")
    try:
        port = int(raw_port)
    except ValueError as e:
        raise ValueError(f"Invalid PORT: {raw_port}") from e

    host = os.getenv("HOST", "0.0.0.0")

    return ScorerConfig(
        scorer_model=scorer_model,
        scorer_provider=scorer_provider,
        scorer_threshold=scorer_threshold,
        db_path=db_path,
        port=port,
        host=host,
    )
