import pytest
from src.config import ScorerConfig, load_config


def test_load_config_defaults(monkeypatch):
    monkeypatch.delenv("SCORER_MODEL", raising=False)
    monkeypatch.delenv("SCORER_PROVIDER", raising=False)
    monkeypatch.delenv("SCORER_THRESHOLD", raising=False)
    monkeypatch.delenv("DB_PATH", raising=False)
    monkeypatch.delenv("RESUME_OPS_URL", raising=False)
    monkeypatch.delenv("ARTIFACTS_DIR", raising=False)
    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.delenv("HOST", raising=False)

    config = load_config()
    assert config.scorer_threshold == 75
    assert config.scorer_model == "gpt-4o-mini"
    assert config.db_path == "./jobs.db"
    assert config.resume_ops_url is None
    assert config.artifacts_dir == "./data/artifacts"
    assert config.port == 8001
    assert config.host == "0.0.0.0"


def test_load_config_custom_env(monkeypatch):
    monkeypatch.setenv("SCORER_MODEL", "claude-3-5-sonnet-20241022")
    monkeypatch.setenv("SCORER_PROVIDER", "anthropic")
    monkeypatch.setenv("SCORER_THRESHOLD", "80")
    monkeypatch.setenv("DB_PATH", "/tmp/custom.db")
    monkeypatch.setenv("RESUME_OPS_URL", "http://localhost:8081")
    monkeypatch.setenv("ARTIFACTS_DIR", "/tmp/artifacts")
    monkeypatch.setenv("PORT", "9000")
    monkeypatch.setenv("HOST", "127.0.0.1")

    config = load_config()
    assert config.scorer_model == "claude-3-5-sonnet-20241022"
    assert config.scorer_provider == "anthropic"
    assert config.scorer_threshold == 80
    assert config.db_path == "/tmp/custom.db"
    assert config.resume_ops_url == "http://localhost:8081"
    assert config.artifacts_dir == "/tmp/artifacts"
    assert config.port == 9000
    assert config.host == "127.0.0.1"


def test_invalid_threshold_raises(monkeypatch):
    monkeypatch.setenv("SCORER_THRESHOLD", "120")
    with pytest.raises(ValueError, match="Threshold must be between 0 and 100"):
        load_config()

    monkeypatch.setenv("SCORER_THRESHOLD", "-5")
    with pytest.raises(ValueError, match="Threshold must be between 0 and 100"):
        load_config()

    monkeypatch.setenv("SCORER_THRESHOLD", "not_a_number")
    with pytest.raises(ValueError):
        load_config()
