import asyncio
import logging
import time
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
                        else:
                            # resume-ops unavailable or failed
                            store.update_user_job_tailoring(
                                user_job_id=user_job_id,
                                tailored_resume_id="",
                                status="tailor_failed",
                            )
                    except Exception as te:
                        logger.error("Tailoring bridge error for user_job %s: %s", user_job_id, te)
                        store.update_user_job_tailoring(
                            user_job_id=user_job_id,
                            tailored_resume_id="",
                            status="tailor_failed",
                        )
            else:
                rejected += 1

            scored_jobs.append(updated_uj)
        except Exception as e:
            logger.error("Failed to score user_job %s: %s", user_job_id, e)
            failed_uj = store.mark_user_job_failed(user_job_id=user_job_id, error_message=str(e))
            scored_jobs.append(failed_uj)

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
                        else:
                            store.update_job_tailoring(
                                job_id=job_id,
                                tailored_resume_id="",
                                status="tailor_failed",
                            )
                    except Exception as te:
                        logger.error("Tailoring bridge error for job %s: %s", job_id, te)
                        store.update_job_tailoring(
                            job_id=job_id,
                            tailored_resume_id="",
                            status="tailor_failed",
                        )
            else:
                rejected += 1

            scored_jobs.append(updated_job)
        except Exception as e:
            logger.error("Failed to score job %s: %s", job_id, e)
            failed_job = store.mark_job_failed(job_id=job_id, error_message=str(e))
            scored_jobs.append(failed_job)

    return {
        "processed": processed,
        "passed": passed,
        "rejected": rejected,
        "tailored": tailored,
        "jobs": scored_jobs,
    }


class WorkerDaemon:
    """
    Background worker daemon managing polling loop, overlap lock,
    lifecycle management, and health/status reporting.
    """

    def __init__(
        self,
        store: JobStore,
        screener: Screener,
        tailor_bridge: TailorBridge | None = None,
        artifact_manager: ArtifactManager | None = None,
        master_resume: dict[str, Any] | None = None,
        poll_interval_seconds: float = 10.0,
        enabled: bool = True,
    ):
        self.store = store
        self.screener = screener
        self.tailor_bridge = tailor_bridge
        self.artifact_manager = artifact_manager
        self.master_resume = master_resume
        self.poll_interval = max(1.0, poll_interval_seconds)
        self.enabled = enabled

        self._lock = asyncio.Lock()
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._last_run_at: int | None = None
        self._last_stats: dict[str, Any] | None = None
        self._in_flight: bool = False

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def tick(self) -> dict[str, Any]:
        """
        Execute a single processing iteration protected by an overlap lock.
        If another tick or the polling loop is already in-flight, returns status 'already_running'.
        """
        if self._lock.locked() or self._in_flight:
            return {"ok": True, "status": "already_running"}

        async with self._lock:
            self._in_flight = True
            try:
                result = await process_unscored_jobs(
                    store=self.store,
                    screener=self.screener,
                    master_resume=self.master_resume,
                    tailor_bridge=self.tailor_bridge,
                    artifact_manager=self.artifact_manager,
                )
                self._last_run_at = int(time.time() * 1000)
                self._last_stats = result
                return {"ok": True, "status": "completed", "result": result}
            except Exception as e:
                logger.error("Error during worker tick: %s", e)
                return {"ok": False, "status": "error", "error": str(e)}
            finally:
                self._in_flight = False

    async def _run_loop(self) -> None:
        logger.info("WorkerDaemon loop started (interval=%.1fs)", self.poll_interval)
        while not self._stop_event.is_set():
            try:
                await self.tick()
            except Exception as e:
                logger.error("Unhandled exception in WorkerDaemon loop: %s", e)

            try:
                # Wait for poll_interval or until stop_event is set
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval)
            except asyncio.TimeoutError:
                pass

        logger.info("WorkerDaemon loop exited")

    def start(self) -> None:
        if not self.enabled:
            logger.info("WorkerDaemon is disabled via config")
            return

        if self.is_running:
            return

        # Self-healing on startup: reset stranded in-progress records
        reset_count = self.store.reset_in_flight_jobs()
        if reset_count > 0:
            logger.info("WorkerDaemon self-healed %d in-flight jobs on startup", reset_count)

        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        if not self.is_running:
            return

        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def get_status(self) -> dict[str, Any]:
        return {
            "running": self.is_running,
            "enabled": self.enabled,
            "poll_interval_seconds": self.poll_interval,
            "in_flight": self._in_flight,
            "last_run_at": self._last_run_at,
            "last_stats": self._last_stats,
        }

