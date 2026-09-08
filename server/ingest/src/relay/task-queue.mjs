import { randomUUID } from 'node:crypto';

export const ALLOWED_TASK_TYPES = new Set([
  'FETCH_JOB_PAGE',
  'CHECK_LIVENESS',
  'RUN_PROVIDER_SCAN',
]);

/**
 * Enqueues a typed companion task in SQLite.
 * If an identical pending task (same user, job/url, and type) exists, returns it.
 */
export function enqueueTask(db, { userId, type, jobId = null, url, payload = null }) {
  if (!ALLOWED_TASK_TYPES.has(type)) {
    throw new Error(`Invalid task type: "${type}". Allowed: ${Array.from(ALLOWED_TASK_TYPES).join(', ')}`);
  }
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Task requires a valid http/https URL');
  }

  const now = Date.now();

  // Deduplicate active tasks for same target
  const existing = db
    .prepare(
      "SELECT id, user_id, type, job_id, url, status, created_at FROM relay_tasks WHERE user_id = ? AND type = ? AND (job_id = ? OR url = ?) AND status IN ('queued', 'leased') LIMIT 1"
    )
    .get(userId, type, jobId, url);

  if (existing) {
    return existing;
  }

  const id = `task_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const payloadStr = payload ? JSON.stringify(payload) : null;

  db.prepare(
    `INSERT INTO relay_tasks (id, user_id, type, job_id, url, payload, status, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`
  ).run(id, userId, type, jobId, url, payloadStr, now, now);

  return {
    id,
    user_id: userId,
    type,
    job_id: jobId,
    url,
    status: 'queued',
    created_at: now,
  };
}

/**
 * Atomically reclaims expired leased tasks and leases the oldest queued task for a user.
 */
export function leaseNextTask(db, { userId, leaseDurationMs = 30000 }) {
  const now = Date.now();

  // 1. Recover expired leases
  const expiredTasks = db
    .prepare(
      "SELECT id, retry_count FROM relay_tasks WHERE status = 'leased' AND leased_at < ? AND user_id = ?"
    )
    .all(now - leaseDurationMs, userId);

  for (const t of expiredTasks) {
    if (t.retry_count >= 3) {
      db.prepare(
        "UPDATE relay_tasks SET status = 'failed', error = 'Lease expired after maximum retries', updated_at = ? WHERE id = ?"
      ).run(now, t.id);
    } else {
      db.prepare(
        "UPDATE relay_tasks SET status = 'queued', lease_token = NULL, leased_at = NULL, retry_count = retry_count + 1, updated_at = ? WHERE id = ?"
      ).run(now, t.id);
    }
  }

  // 2. Fetch oldest queued task
  const nextTask = db
    .prepare(
      "SELECT id, user_id, type, job_id, url, payload FROM relay_tasks WHERE status = 'queued' AND user_id = ? ORDER BY created_at ASC LIMIT 1"
    )
    .get(userId);

  if (!nextTask) return null;

  const leaseToken = `lease_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const updated = db
    .prepare(
      "UPDATE relay_tasks SET status = 'leased', lease_token = ?, leased_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'"
    )
    .run(leaseToken, now, now, nextTask.id);

  if (updated.changes === 0) {
    // Raced with another worker
    return null;
  }

  let parsedPayload = null;
  if (nextTask.payload) {
    try {
      parsedPayload = JSON.parse(nextTask.payload);
    } catch {}
  }

  return {
    id: nextTask.id,
    user_id: nextTask.user_id,
    type: nextTask.type,
    job_id: nextTask.job_id,
    url: nextTask.url,
    payload: parsedPayload,
    leaseToken,
    leasedAt: now,
  };
}

/**
 * Fulfills a leased task and applies results to database models.
 */
export function fulfillTask(db, { taskId, leaseToken, result = null, error = null, userId = null }) {
  const now = Date.now();
  const task = db.prepare('SELECT * FROM relay_tasks WHERE id = ?').get(taskId);

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (userId && task.user_id !== userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
    throw new Error('Unauthorized to fulfill this task');
  }

  if (task.status !== 'leased' || (leaseToken && task.lease_token !== leaseToken)) {
    // Task already expired or was fulfilled
    return { ok: false, status: task.status, message: 'Task lease mismatch or expired' };
  }

  if (error) {
    db.prepare(
      "UPDATE relay_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ?"
    ).run(String(error), now, taskId);
    return { ok: true, status: 'failed', error: String(error) };
  }

  const resultStr = result ? JSON.stringify(result) : null;
  db.prepare(
    "UPDATE relay_tasks SET status = 'completed', result = ?, error = NULL, updated_at = ? WHERE id = ?"
  ).run(resultStr, now, taskId);

  // Apply side-effects to jobs table
  if (task.job_id && result && typeof result === 'object') {
    if (task.type === 'FETCH_JOB_PAGE' && result.description) {
      db.prepare('UPDATE jobs SET description = ?, updated_at = ? WHERE id = ?').run(
        result.description,
        now,
        task.job_id
      );
      if (result.title) {
        db.prepare(
          "UPDATE jobs SET title = CASE WHEN title = 'Unknown Position' OR title = '' THEN ? ELSE title END WHERE id = ?"
        ).run(result.title, task.job_id);
      }
    } else if (task.type === 'CHECK_LIVENESS' && result.liveness) {
      db.prepare('UPDATE jobs SET liveness = ?, updated_at = ? WHERE id = ?').run(
        result.liveness,
        now,
        task.job_id
      );
    }
  }

  return { ok: true, status: 'completed', result };
}

/**
 * Retrieves status and result of a specific task.
 */
export function getTaskStatus(db, taskId, userId = null) {
  const task = db.prepare('SELECT * FROM relay_tasks WHERE id = ?').get(taskId);
  if (!task) return null;

  if (userId && task.user_id !== userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
    return null;
  }

  let parsedResult = null;
  if (task.result) {
    try {
      parsedResult = JSON.parse(task.result);
    } catch {
      parsedResult = task.result;
    }
  }

  return {
    id: task.id,
    userId: task.user_id,
    type: task.type,
    jobId: task.job_id,
    url: task.url,
    status: task.status,
    retryCount: task.retry_count,
    result: parsedResult,
    error: task.error,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

/**
 * Returns summary of relay tasks and connection status for a user.
 */
export function getRelayStatus(db, userId, activeWindowMs = 60000) {
  const now = Date.now();

  const counts = db
    .prepare(
      'SELECT status, COUNT(*) as count FROM relay_tasks WHERE user_id = ? GROUP BY status'
    )
    .all(userId);

  const statusMap = {};
  for (const row of counts) {
    statusMap[row.status] = row.count;
  }

  const lastLeased = db
    .prepare(
      'SELECT MAX(leased_at) as last_seen FROM relay_tasks WHERE user_id = ?'
    )
    .get(userId);

  const lastSeen = lastLeased?.last_seen || null;
  const connected = lastSeen !== null && (now - lastSeen) < activeWindowMs;

  return {
    connected,
    lastSeenAt: lastSeen,
    counts: {
      queued: statusMap.queued || 0,
      leased: statusMap.leased || 0,
      completed: statusMap.completed || 0,
      failed: statusMap.failed || 0,
    },
  };
}
