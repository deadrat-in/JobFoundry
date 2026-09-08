import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import { buildApp } from '../src/app.mjs';

function makeApp() {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, apiKeys: ['testkey'] });
  return { app, db };
}

test('relay API: decant and liveness return 202 and companion can lease/fulfill', async () => {
  const { app, db } = makeApp();

  try {
    const now = Date.now();
    // Seed a job
    db.prepare(
      'INSERT INTO jobs (id, title, company, url, source, liveness, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'job_1',
      'Software Engineer',
      'Acme',
      'https://boards.greenhouse.io/acme/jobs/101',
      'greenhouse',
      'unknown',
      now,
      now
    );

    // 1. Check relay status initially
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/v1/relay/status',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(statusRes.statusCode, 200);
    const statusJson = statusRes.json();
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.relay.counts.queued, 0);

    // 2. Request decant on job -> returns 202 Accepted { taskId }
    const decantRes = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/job_1/decant',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(decantRes.statusCode, 202);
    const decantJson = decantRes.json();
    assert.equal(decantJson.ok, true);
    assert.equal(decantJson.status, 'queued');
    assert.ok(decantJson.taskId.startsWith('task_'));

    // 3. Companion leases task
    const leaseRes = await app.inject({
      method: 'GET',
      url: '/api/v1/relay/tasks/lease',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(leaseRes.statusCode, 200);
    const leaseJson = leaseRes.json();
    assert.ok(leaseJson.task);
    assert.equal(leaseJson.task.id, decantJson.taskId);
    assert.equal(leaseJson.task.type, 'FETCH_JOB_PAGE');
    assert.equal(leaseJson.task.url, 'https://boards.greenhouse.io/acme/jobs/101');

    // 4. Companion fulfills task with extracted description
    const fulfillRes = await app.inject({
      method: 'POST',
      url: `/api/v1/relay/tasks/${leaseJson.task.id}/fulfill`,
      headers: { authorization: 'Bearer testkey' },
      payload: {
        leaseToken: leaseJson.task.leaseToken,
        result: {
          description:
            'We are hiring a backend engineer with Node.js and distributed systems expertise.',
        },
      },
    });
    assert.equal(fulfillRes.statusCode, 200);
    assert.equal(fulfillRes.json().status, 'completed');

    // 5. Job record has updated description in DB
    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get('job_1');
    assert.equal(
      updatedJob.description,
      'We are hiring a backend engineer with Node.js and distributed systems expertise.'
    );

    // 6. Query task status endpoint
    const taskStatusRes = await app.inject({
      method: 'GET',
      url: `/api/v1/relay/tasks/${decantJson.taskId}`,
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(taskStatusRes.statusCode, 200);
    assert.equal(taskStatusRes.json().task.status, 'completed');

    // 7. Request check-liveness -> returns 202
    const livenessReq = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/job_1/check-liveness',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(livenessReq.statusCode, 202);
    const livenessJson = livenessReq.json();
    assert.ok(livenessJson.taskId);

    // Lease and fulfill liveness
    const lease2 = await app.inject({
      method: 'GET',
      url: '/api/v1/relay/tasks/lease',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(lease2.json().task.type, 'CHECK_LIVENESS');

    await app.inject({
      method: 'POST',
      url: `/api/v1/relay/tasks/${lease2.json().task.id}/fulfill`,
      headers: { authorization: 'Bearer testkey' },
      payload: {
        leaseToken: lease2.json().task.leaseToken,
        result: { liveness: 'live' },
      },
    });

    const liveJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get('job_1');
    assert.equal(liveJob.liveness, 'live');
  } finally {
    await app.close();
  }
});
