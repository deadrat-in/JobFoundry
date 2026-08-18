import base64
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class ArtifactManager:
    def __init__(self, base_dir: str | Path = "./data/artifacts"):
        self.base_dir = Path(base_dir)

    def save_artifacts(
        self,
        job_id: str,
        resume: dict[str, Any],
        pdf_bytes: bytes | None = None,
        pdf_base64: str | None = None,
        pdf_concise_bytes: bytes | None = None,
        pdf_concise_base64: str | None = None,
        plain_text: str | None = None,
    ) -> dict[str, str | None]:
        """
        Save tailored resume artifacts to disk under {base_dir}/{job_id}/:
        - resume.json
        - resume.pdf (primary theme)
        - resume-concise.pdf (concise theme)
        - resume.txt (ATS plain text)
        """
        job_dir = self.base_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        # 1. Save JSON resume
        json_path = job_dir / "resume.json"
        json_path.write_text(
            json.dumps(resume, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        # 2. Save Standard PDF
        pdf_path = None
        if pdf_bytes is not None:
            pdf_path = job_dir / "resume.pdf"
            pdf_path.write_bytes(pdf_bytes)
        elif pdf_base64 is not None:
            try:
                pdf_path = job_dir / "resume.pdf"
                pdf_path.write_bytes(base64.b64decode(pdf_base64))
            except Exception as e:
                logger.error("Failed to decode standard pdf_base64 for job %s: %s", job_id, e)
                pdf_path = None

        # 3. Save Concise PDF
        pdf_concise_path = None
        if pdf_concise_bytes is not None:
            pdf_concise_path = job_dir / "resume-concise.pdf"
            pdf_concise_path.write_bytes(pdf_concise_bytes)
        elif pdf_concise_base64 is not None:
            try:
                pdf_concise_path = job_dir / "resume-concise.pdf"
                pdf_concise_path.write_bytes(base64.b64decode(pdf_concise_base64))
            except Exception as e:
                logger.error("Failed to decode concise pdf_base64 for job %s: %s", job_id, e)
                pdf_concise_path = None

        # 4. Save ATS Plain Text
        txt_path = None
        if plain_text is not None:
            txt_path = job_dir / "resume.txt"
            txt_path.write_text(plain_text, encoding="utf-8")

        return {
            "json": str(json_path),
            "pdf": str(pdf_path) if pdf_path else None,
            "pdf_concise": str(pdf_concise_path) if pdf_concise_path else None,
            "txt": str(txt_path) if txt_path else None,
        }
