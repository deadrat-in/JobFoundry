import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import {
  enqueueTask,
  leaseNextTask,
  fulfillTask,
  getTaskStatus,
  getRelayStatus,
} from '../src/relay/task-queue.mjs';

test('task-queue: rejects invalid task types, non-http URLs, and private destinations', () => {
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
    assert.throws(
      () =>
        enqueueTask(db, {
          userId: 'u1',
          type: 'FETCH_JOB_PAGE',
          url: 'http://127.0.0.1:8080/admin',
        }),
      /forbidden private\/reserved IP/
    );
    assert.throws(
      () =>
        enqueueTask(db, { userId: 'u1', type: 'FETCH_JOB_PAGE', url: 'http://localhost/secret' }),
      /forbidden private\/local destination/
    );
  } finally {
    db.close();
  }
});

test('task-queue: enqueues, deduplicates, leases, and fulfills task', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('u1', 'test@example.com', 'h', 'k1', now, now);
    db.prepare(
      'INSERT INTO jobs (id, title, company, url, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('j1', 'Unknown Position', 'Acme', 'https://acme.test/job1', 'greenhouse', now, now);

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
    db.prepare(
      'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('u1', 'test@example.com', 'h', 'k1', now, now);
    db.prepare(
      'INSERT INTO jobs (id, title, company, url, source, liveness, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('j2', 'Frontend Dev', 'Stark', 'https://stark.test/job2', 'lever', 'unknown', now, now);

    enqueueTask(db, {
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
    db.prepare(
      'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('u1', 'test@example.com', 'h', 'k1', now, now);

    const task = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      url: 'https://example.com/expired-test',
    });

    // Lease with expired timestamp
    db.prepare(
      "UPDATE relay_tasks SET status = 'leased', lease_token = 'l1', leased_at = ?, retry_count = 0 WHERE id = ?"
    ).run(now - 60000, task.id);

    // Calling leaseNextTask should recover expired task
    const leasedAgain = leaseNextTask(db, { userId: 'u1', leaseDurationMs: 10000 });
    assert.ok(leasedAgain);
    assert.equal(leasedAgain.id, task.id);

    // If it expires 3 times, next recovery fails it
    db.prepare(
      "UPDATE relay_tasks SET status = 'leased', leased_at = ?, retry_count = 3 WHERE id = ?"
    ).run(now - 60000, task.id);

    const leasedNone = leaseNextTask(db, { userId: 'u1', leaseDurationMs: 10000 });
    assert.equal(leasedNone, null);

    const failedTask = getTaskStatus(db, task.id, 'u1');
    assert.equal(failedTask.status, 'failed');
    assert.match(failedTask.error, /maximum retries/);
  } finally {
    db.close();
  }
});

test('task-queue: rejects IPv4-mapped IPv6 loopback and private addresses', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const invalidUrls = [
      'http://[::ffff:127.0.0.1]/job',
      'http://[::ffff:7f00:1]/job',
      'http://[::ffff:169.254.169.254]/job',
      'http://[::ffff:10.0.0.1]/job',
      'http://[::ffff:0a00:1]/job',
    ];

    for (const url of invalidUrls) {
      assert.throws(
        () => enqueueTask(db, { userId: 'u1', type: 'FETCH_JOB_PAGE', url }),
        /forbidden private\/reserved IP/
      );
    }
  } finally {
    db.close();
  }
});

test('task-queue: distinct jobs and standalone tasks do not hijack each other', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('u1', 'test@example.com', 'h', 'k1', now, now);

    const jobUrl = 'https://company.test/careers/openings';

    db.prepare(
      'INSERT INTO jobs (id, title, company, url, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('job_alpha', 'Role A', 'Acme', jobUrl, 'lever', now, now);

    // 1. Enqueue task linked to specific job
    const t1 = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      jobId: 'job_alpha',
      url: jobUrl,
    });

    // 2. Enqueue standalone task on same URL without jobId
    const t2 = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      jobId: null,
      url: jobUrl,
    });

    assert.notEqual(t1.id, t2.id);
    assert.equal(t1.job_id, 'job_alpha');
    assert.equal(t2.job_id, null);

    // 3. Repeating the job task returns t1
    const t1Dupe = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      jobId: 'job_alpha',
      url: jobUrl,
    });
    assert.equal(t1Dupe.id, t1.id);

    // 4. Repeating the standalone task returns t2
    const t2Dupe = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      jobId: null,
      url: jobUrl,
    });
    assert.equal(t2Dupe.id, t2.id);
  } finally {
    db.close();
  }
});

test('task-queue: fulfillTask strictly requires valid lease token', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('u1', 'test@example.com', 'h', 'k1', now, now);

    const task = enqueueTask(db, {
      userId: 'u1',
      type: 'FETCH_JOB_PAGE',
      url: 'https://example.com/job-token-test',
    });

    const leased = leaseNextTask(db, { userId: 'u1' });
    assert.ok(leased.leaseToken);

    // Fulfill without token -> rejected
    const noToken = fulfillTask(db, {
      taskId: task.id,
      userId: 'u1',
      result: { description: 'test' },
    });
    assert.equal(noToken.ok, false);

    // Fulfill with wrong token -> rejected
    const wrongToken = fulfillTask(db, {
      taskId: task.id,
      leaseToken: 'lease_invalid_token',
      userId: 'u1',
      result: { description: 'test' },
    });
    assert.equal(wrongToken.ok, false);

    // Fulfill with correct token -> succeeds
    const success = fulfillTask(db, {
      taskId: task.id,
      leaseToken: leased.leaseToken,
      userId: 'u1',
      result: { description: 'test' },
    });
    assert.equal(success.ok, true);
    assert.equal(success.status, 'completed');
  } finally {
    db.close();
  }
});
