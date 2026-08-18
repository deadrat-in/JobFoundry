import os
from fastapi.testclient import TestClient
from src.main import build_app


def test_main_app_boots(monkeypatch):
    monkeypatch.setenv("USE_STUB_LLM", "1")
    monkeypatch.setenv("SCORER_THRESHOLD", "75")
    app = build_app()
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
