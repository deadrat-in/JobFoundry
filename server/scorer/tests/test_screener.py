import json
import os
from pathlib import Path
import pytest
from src.llm import StubLLM, LiteLLMClient, ScoreResult
from src.screener import Screener


GOLDEN_DIR = Path(__file__).parent / "golden"


def load_golden_case(case_name: str):
    case_dir = GOLDEN_DIR / case_name
    with open(case_dir / "job.json", "r", encoding="utf-8") as f:
        job = json.load(f)
    with open(case_dir / "master-resume.json", "r", encoding="utf-8") as f:
        resume = json.load(f)
    with open(case_dir / "expected.json", "r", encoding="utf-8") as f:
        expected = json.load(f)
    return job, resume, expected


@pytest.mark.parametrize("case_name", ["case1", "case2", "case3"])
@pytest.mark.asyncio
async def test_screener_with_stub_golden_set(case_name: str):
    job, resume, expected = load_golden_case(case_name)
    expected_result = ScoreResult(
        score=expected["score"],
        reasoning=expected["reasoning"],
        matching_skills=expected["matching_skills"],
        missing_skills=expected["missing_skills"],
    )
    stub = StubLLM(default_result=expected_result)
    screener = Screener(llm_client=stub)

    result = await screener.score(job=job, master_resume=resume)

    assert result.score == expected["score"]
    assert result.reasoning == expected["reasoning"]
    assert result.matching_skills == expected["matching_skills"]
    assert result.missing_skills == expected["missing_skills"]
    assert 0 <= result.score <= 100
    assert len(stub.call_history) == 1


@pytest.mark.asyncio
async def test_screener_handles_missing_optional_fields():
    stub = StubLLM(
        default_result=ScoreResult(
            score=70,
            reasoning="Adequate fit",
            missing_skills=[],
            matching_skills=["Python"],
        )
    )
    screener = Screener(llm_client=stub)

    # Job with only minimal fields
    job = {"title": "Software Engineer", "description": "Write code"}
    resume = {"skills": ["Python"]}

    result = await screener.score(job=job, master_resume=resume)
    assert result.score == 70
    assert result.matching_skills == ["Python"]


@pytest.mark.parametrize("case_name", ["case1", "case2", "case3"])
@pytest.mark.asyncio
async def test_screener_live_llm(case_name: str):
    if not os.getenv("LIVE"):
        pytest.skip("Skipping live LLM test (set LIVE=1 to run)")

    job, resume, expected = load_golden_case(case_name)
    model = os.getenv("SCORER_MODEL", "gpt-4o-mini")
    client = LiteLLMClient(model=model)
    screener = Screener(llm_client=client)

    result = await screener.score(job=job, master_resume=resume)
    assert 0 <= result.score <= 100
    assert expected["min_score"] <= result.score <= expected["max_score"]
    assert isinstance(result.reasoning, str) and len(result.reasoning) > 0
    assert isinstance(result.matching_skills, list)
    assert isinstance(result.missing_skills, list)
