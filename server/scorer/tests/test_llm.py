import pytest
import os
from src.llm import LLMClient, StubLLM, LiteLLMClient, ScoreResult


def test_score_result_validation():
    res = ScoreResult(
        score=90,
        reasoning="Great fit",
        missing_skills=["Rust"],
        matching_skills=["Python", "FastAPI"],
    )
    assert res.score == 90
    assert res.reasoning == "Great fit"
    assert res.missing_skills == ["Rust"]
    assert res.matching_skills == ["Python", "FastAPI"]


def test_score_result_boundaries():
    with pytest.raises(ValueError):
        ScoreResult(
            score=105,
            reasoning="Too high",
            missing_skills=[],
            matching_skills=[],
        )

    with pytest.raises(ValueError):
        ScoreResult(
            score=-5,
            reasoning="Negative score",
            missing_skills=[],
            matching_skills=[],
        )


@pytest.mark.asyncio
async def test_stub_llm():
    stub = StubLLM(
        default_result=ScoreResult(
            score=80,
            reasoning="Solid match",
            missing_skills=["Docker"],
            matching_skills=["Python"],
        )
    )
    assert isinstance(stub, LLMClient)
    result = await stub.score(job={"title": "Dev"}, resume={"skills": ["Python"]})
    assert result.score == 80
    assert result.reasoning == "Solid match"
    assert result.missing_skills == ["Docker"]
    assert result.matching_skills == ["Python"]


@pytest.mark.asyncio
async def test_litellm_client_skips_without_env(monkeypatch):
    monkeypatch.delenv("SCORER_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    
    # Without API keys or model configured, live calls should be skipped in normal test suite
    if not os.getenv("LIVE"):
        pytest.skip("Skipping live LLM test (LIVE env not set)")
