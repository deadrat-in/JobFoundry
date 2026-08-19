import logging
import uuid
from typing import Any
from src.artifacts import ArtifactManager
from src.screener import Screener
from src.store import JobStore
from src.tailor_bridge import TailorBridge

logger = logging.getLogger(__name__)


async def process_unscored_user_jobs(
    store: JobStore,
    screener: Screener,
    tailor_bridge: TailorBridge | None = None,
    artifact_manager: ArtifactManager | None = None,
    default_master_resume: dict[str, Any] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """
    Multi-tenant worker process:
    1. Fetches unscored jobs from user_jobs joining each user's active JSON Resume.
    2. Scores each job against that user's specific master resume.
    3. If threshold passed, tailors resume and stores artifacts under /artifacts/{user_id}/{job_id}/.
    4. Updates user_jobs status and score.
    """
    unscored = store.get_unscored_user_jobs(limit=limit)
    processed = 0
    passed = 0
    rejected = 0
    tailored = 0
    scored_jobs = []

    for item in unscored:
        user_job_id = item["user_job_id"]
        user_id = item["user_id"]
        job_id = item["job_id"]
        resume = item.get("master_resume") or default_master_resume

        if not resume:
            logger.warning(
                "Skipping user_job %s (user %s) because no active resume is found",
                user_job_id,
                user_id,
            )
            continue

        try:
            job_dict = {
                "id": job_id,
                "title": item["title"],
                "company": item["company"],
                "location": item.get("location"),
                "description": item.get("description"),
                "url": item.get("url"),
                "source": item.get("source"),
            }
            result = await screener.score(job=job_dict, master_resume=resume)
            updated_uj = store.score_user_job(user_job_id=user_job_id, result=result)
            processed += 1

            if updated_uj.get("status") == "new":
                passed += 1

                if tailor_bridge and tailor_bridge.base_url:
                    try:
                        tailor_res = await tailor_bridge.tailor(
                            job=job_dict,
                            master_resume=resume,
                            theme="jsonresume-theme-folio",
                        )
                        concise_res = await tailor_bridge.tailor(
                            job=job_dict,
                            master_resume=resume,
                            theme="jsonresume-theme-folio-concise",
                        )

                        if tailor_res and tailor_res.status == "completed":
                            pdf_concise_b64 = concise_res.pdf_base64 if concise_res else None

                            if artifact_manager:
                                artifact_manager.save_artifacts(
                                    job_id=job_id,
                                    user_id=user_id,
                                    resume=tailor_res.resume,
                                    pdf_base64=tailor_res.pdf_base64,
                                    pdf_concise_base64=pdf_concise_b64,
                                    plain_text=tailor_res.plain_text,
                                )

                            tailored_resume_id = (
                                tailor_res.task_id
                                or f"tailored-{user_id}-{job_id}-{uuid.uuid4().hex[:8]}"
                            )
                            updated_uj = store.update_user_job_tailoring(
                                user_job_id=user_job_id,
                                tailored_resume_id=tailored_resume_id,
                                status="tailored",
                            )
                            tailored += 1
                    except Exception as te:
                        logger.error("Tailoring bridge error for user_job %s: %s", user_job_id, te)
            else:
                rejected += 1

            scored_jobs.append(updated_uj)
        except Exception as e:
            logger.error("Failed to score user_job %s: %s", user_job_id, e)

    return {
        "processed": processed,
        "passed": passed,
        "rejected": rejected,
        "tailored": tailored,
        "jobs": scored_jobs,
    }


async def process_unscored_jobs(
    store: JobStore,
    screener: Screener,
    master_resume: dict[str, Any] | None = None,
    tailor_bridge: TailorBridge | None = None,
    artifact_manager: ArtifactManager | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """
    Unified entrypoint:
    If database contains user_jobs table and unscored user_jobs, processes multi-tenant queue.
    Otherwise falls back to single-tenant jobs table.
    """
    if store.has_user_jobs_table():
        user_jobs_result = await process_unscored_user_jobs(
            store=store,
            screener=screener,
            tailor_bridge=tailor_bridge,
            artifact_manager=artifact_manager,
            default_master_resume=master_resume,
            limit=limit,
        )
        if user_jobs_result["processed"] > 0:
            return user_jobs_result

    # Fallback to single-tenant jobs table
    if not master_resume:
        return {"processed": 0, "passed": 0, "rejected": 0, "tailored": 0, "jobs": []}

    unscored_jobs = store.get_unscored_jobs(limit=limit)
    processed = 0
    passed = 0
    rejected = 0
    tailored = 0
    scored_jobs = []

    for job in unscored_jobs:
        job_id = job["id"]
        try:
            result = await screener.score(job=job, master_resume=master_resume)
            updated_job = store.score_job(job_id=job_id, result=result)
            processed += 1

            if updated_job.get("status") == "new":
                passed += 1

                # Step 2: Tailoring bridge if configured
                if tailor_bridge and tailor_bridge.base_url:
                    try:
                        tailor_res = await tailor_bridge.tailor(
                            job=job,
                            master_resume=master_resume,
                            theme="jsonresume-theme-folio",
                        )

                        concise_res = await tailor_bridge.tailor(
                            job=job,
                            master_resume=master_resume,
                            theme="jsonresume-theme-folio-concise",
                        )

                        if tailor_res and tailor_res.status == "completed":
                            pdf_concise_b64 = concise_res.pdf_base64 if concise_res else None

                            if artifact_manager:
                                artifact_manager.save_artifacts(
                                    job_id=job_id,
                                    resume=tailor_res.resume,
                                    pdf_base64=tailor_res.pdf_base64,
                                    pdf_concise_base64=pdf_concise_b64,
                                    plain_text=tailor_res.plain_text,
                                )

                            tailored_resume_id = (
                                tailor_res.task_id or f"tailored-{job_id}-{uuid.uuid4().hex[:8]}"
                            )
                            updated_job = store.update_job_tailoring(
                                job_id=job_id,
                                tailored_resume_id=tailored_resume_id,
                                status="tailored",
                            )
                            tailored += 1
                    except Exception as te:
                        logger.error("Tailoring bridge error for job %s: %s", job_id, te)
            else:
                rejected += 1

            scored_jobs.append(updated_job)
        except Exception as e:
            logger.error("Failed to score job %s: %s", job_id, e)

    return {
        "processed": processed,
        "passed": passed,
        "rejected": rejected,
        "tailored": tailored,
        "jobs": scored_jobs,
    }
