import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import {
  enqueueTask,
  leaseNextTask,
  fulfillTask,
  getTaskStatus,
  getRelayStatus,
  ALLOWED_TASK_TYPES,
} from '../src/relay/task-queue.mjs';

test('task-queue: rejects invalid task types and non-http URLs', () => {
  const db = openDb({ path: ':memory:' });
  try {
    assert.throws(
      () => enqueueTask(db, { userId: 'u1', type: 'INVALID_TYPE', url: 'https://example.com' }),
      /Invalid task type/
    );
    assert.throws(
      () => enqueueTask(db, { userId: 'u1', type: 'FETCH_JOB_PAGE', url: 'ftp://bad' }),
      /valid http\/https URL/
    );
  } finally {
    db.close();
  }
});

test('task-queue: enqueues, deduplicates, leases, and fulfills task', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const now = Date.now();
    db.prepare('INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'u1', 'test@example.com', 'h', 'k1', now, now
    );
    db.prepare('INSERT INTO jobs (id, title, company, url, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'j1', 'Unknown Position', 'Acme', 'https://acme.test/job1', 'greenhouse', now, now
    );

    // 1. Enqueue task
    const t1 = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      jobId: 'j1',
      url: 'https://acme.test/job1',
    });
    assert.ok(t1.id.startsWith('task_'));
    assert.equal(t1.status, 'queued');

    // 2. Duplicate enqueue returns existing active task
    const t1Dup = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      jobId: 'j1',
      url: 'https://acme.test/job1',
    });
    assert.equal(t1Dup.id, t1.id);

    // 3. Lease task
    const leased = leaseNextTask(db, { userId: 'u1' });
    assert.ok(leased);
    assert.equal(leased.id, t1.id);
    assert.ok(leased.leaseToken.startsWith('lease_'));

    // 4. Second lease has no queued tasks
    const leasedNone = leaseNextTask(db, { userId: 'u1' });
    assert.equal(leasedNone, null);

    // 5. Fulfill task with scraped JD
    const fulfilled = fulfillTask(db, {
      taskId: leased.id,
      leaseToken: leased.leaseToken,
      userId: 'u1',
      result: {
        title: 'Senior Backend Engineer',
        description: 'Full extracted job description from browser.',
      },
    });
    assert.equal(fulfilled.ok, true);
    assert.equal(fulfilled.status, 'completed');

    // 6. Verify job description and title updated
    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get('j1');
    assert.equal(updatedJob.title, 'Senior Backend Engineer');
    assert.equal(updatedJob.description, 'Full extracted job description from browser.');

    // 7. Verify task status
    const status = getTaskStatus(db, t1.id, 'u1');
    assert.equal(status.status, 'completed');
    assert.equal(status.result.description, 'Full extracted job description from browser.');

    // 8. Relay status shows completed count
    const relay = getRelayStatus(db, 'u1');
    assert.equal(relay.connected, true);
    assert.equal(relay.counts.completed, 1);
    assert.equal(relay.counts.queued, 0);
  } finally {
    db.close();
  }
});

test('task-queue: check liveness task updates job liveness in db', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const now = Date.now();
    db.prepare('INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'u1', 'test@example.com', 'h', 'k1', now, now
    );
    db.prepare('INSERT INTO jobs (id, title, company, url, source, liveness, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'j2', 'Frontend Dev', 'Stark', 'https://stark.test/job2', 'lever', 'unknown', now, now
    );

    const task = enqueueTask(db, {
      userId: 'u1',
      type: 'CHECK_LIVENESS',
      jobId: 'j2',
      url: 'https://stark.test/job2',
    });

    const leased = leaseNextTask(db, { userId: 'u1' });
    fulfillTask(db, {
      taskId: leased.id,
      leaseToken: leased.leaseToken,
      userId: 'u1',
      result: { liveness: 'live' },
    });

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get('j2');
    assert.equal(job.liveness, 'live');
  } finally {
    db.close();
  }
});

test('task-queue: reclaims expired lease and marks failed after max retries', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const now = Date.now();
    db.prepare('INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'u1', 'test@example.com', 'h', 'k1', now, now
    );

    const task = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      url: 'https://example.com/expired-test',
    });

    // Lease with expired timestamp
    db.prepare("UPDATE relay_tasks SET status = 'leased', lease_token = 'l1', leased_at = ?, retry_count = 0 WHERE id = ?").run(
      now - 60000,
      task.id
    );

    // Calling leaseNextTask should recover expired task
    const leasedAgain = leaseNextTask(db, { userId: 'u1', leaseDurationMs: 10000 });
    assert.ok(leasedAgain);
    assert.equal(leasedAgain.id, task.id);

    // If it expires 3 times, next recovery fails it
    db.prepare("UPDATE relay_tasks SET status = 'leased', leased_at = ?, retry_count = 3 WHERE id = ?").run(
      now - 60000,
      task.id
    );

    const leasedNone = leaseNextTask(db, { userId: 'u1', leaseDurationMs: 10000 });
    assert.equal(leasedNone, null);

    const failedTask = getTaskStatus(db, task.id, 'u1');
    assert.equal(failedTask.status, 'failed');
    assert.match(failedTask.error, /maximum retries/);
  } finally {
    db.close();
  }
});
