from fastapi.testclient import TestClient
import pytest
from src.app import create_app
from src.llm import StubLLM, ScoreResult


def test_health_endpoint():
    app = create_app(llm_client=StubLLM())
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_score_endpoint_valid_payload():
    stub = StubLLM(
        default_result=ScoreResult(
            score=85,
            reasoning="Strong match on backend skills",
            missing_skills=["Kubernetes"],
            matching_skills=["Python", "FastAPI", "SQLite"],
        )
    )
    app = create_app(llm_client=stub)
    client = TestClient(app)

    payload = {
        "job": {
            "title": "Senior Python Backend Engineer",
            "company": "Tech Corp",
            "description": "Looking for Python, FastAPI, and SQLite experience. Kubernetes is a plus.",
        },
        "masterResume": {
            "name": "Jane Doe",
            "skills": ["Python", "FastAPI", "SQLite", "Docker"],
            "experience": "5 years building backend services in Python and FastAPI.",
        },
    }

    response = client.post("/score", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["score"] == 85
    assert data["reasoning"] == "Strong match on backend skills"
    assert data["missing_skills"] == ["Kubernetes"]
    assert data["matching_skills"] == ["Python", "FastAPI", "SQLite"]


def test_score_endpoint_invalid_payload():
    app = create_app(llm_client=StubLLM())
    client = TestClient(app)

    # Missing masterResume
    response = client.post("/score", json={"job": {"title": "Engineer"}})
    assert response.status_code == 422
