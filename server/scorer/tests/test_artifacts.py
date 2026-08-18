import base64
import json
from pathlib import Path
import pytest
from src.artifacts import ArtifactManager


def test_save_artifacts_all(tmp_path: Path):
    manager = ArtifactManager(base_dir=tmp_path)

    sample_resume = {
        "basics": {
            "name": "Jane Doe",
            "label": "Software Engineer",
        }
    }
    sample_pdf_bytes = b"%PDF-1.4 standard theme pdf content"
    sample_concise_pdf_bytes = b"%PDF-1.4 concise theme pdf content"
    sample_plain_text = "Name: Jane Doe\nTitle: Software Engineer"

    result = manager.save_artifacts(
        job_id="job-123",
        resume=sample_resume,
        pdf_bytes=sample_pdf_bytes,
        pdf_concise_bytes=sample_concise_pdf_bytes,
        plain_text=sample_plain_text,
    )

    job_dir = tmp_path / "job-123"
    assert job_dir.exists()

    # Check json
    json_path = job_dir / "resume.json"
    assert json_path.exists()
    with open(json_path, "r", encoding="utf-8") as f:
        saved_resume = json.load(f)
    assert saved_resume["basics"]["name"] == "Jane Doe"

    # Check pdf
    pdf_path = job_dir / "resume.pdf"
    assert pdf_path.exists()
    assert pdf_path.read_bytes() == sample_pdf_bytes

    # Check concise pdf
    pdf_concise_path = job_dir / "resume-concise.pdf"
    assert pdf_concise_path.exists()
    assert pdf_concise_path.read_bytes() == sample_concise_pdf_bytes

    # Check plain text
    txt_path = job_dir / "resume.txt"
    assert txt_path.exists()
    assert txt_path.read_text(encoding="utf-8") == sample_plain_text

    assert result["json"] == str(json_path)
    assert result["pdf"] == str(pdf_path)
    assert result["pdf_concise"] == str(pdf_concise_path)
    assert result["txt"] == str(txt_path)


def test_save_artifacts_from_base64(tmp_path: Path):
    manager = ArtifactManager(base_dir=tmp_path)

    sample_pdf_bytes = b"%PDF-1.4 base64 decoded content"
    b64_pdf = base64.b64encode(sample_pdf_bytes).decode("utf-8")

    result = manager.save_artifacts(
        job_id="job-456",
        resume={"name": "Alex"},
        pdf_base64=b64_pdf,
    )

    pdf_path = tmp_path / "job-456" / "resume.pdf"
    assert pdf_path.exists()
    assert pdf_path.read_bytes() == sample_pdf_bytes
    assert result["pdf"] == str(pdf_path)
    assert result["pdf_concise"] is None
    assert result["txt"] is None
