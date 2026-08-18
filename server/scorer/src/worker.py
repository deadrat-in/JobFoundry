import logging
from typing import Any
from src.screener import Screener
from src.store import JobStore

logger = logging.getLogger(__name__)


async def process_unscored_jobs(
    store: JobStore,
    screener: Screener,
    master_resume: dict[str, Any],
    limit: int = 50,
) -> dict[str, Any]:
    """
    Fetches unscored jobs from the store, scores them against the master resume,
    and updates their fit_score, fit_notes, and status.
    """
    unscored_jobs = store.get_unscored_jobs(limit=limit)
    processed = 0
    passed = 0
    rejected = 0
    scored_jobs = []

    for job in unscored_jobs:
        job_id = job["id"]
        try:
            result = await screener.score(job=job, master_resume=master_resume)
            updated_job = store.score_job(job_id=job_id, result=result)
            processed += 1
            if updated_job.get("status") == "new":
                passed += 1
            else:
                rejected += 1
            scored_jobs.append(updated_job)
        except Exception as e:
            logger.error("Failed to score job %s: %s", job_id, e)

    return {
        "processed": processed,
        "passed": passed,
        "rejected": rejected,
        "jobs": scored_jobs,
    }
