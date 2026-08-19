import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import { buildApp } from '../src/app.mjs';

const JOB_1 = {
  title: 'Backend Engineer',
  company: 'Alpha Corp',
  location: 'Remote',
  url: 'https://alpha.test/jobs/1',
  source: 'greenhouse',
  postedAt: '2026-08-18T10:00:00Z',
  description: 'Building Go microservices.',
};

const JOB_2 = {
  title: 'Frontend React Engineer',
  company: 'Beta Inc',
  location: 'NYC',
  url: 'https://beta.test/jobs/2',
  source: 'lever',
  postedAt: '2026-08-18T11:00:00Z',
  description: 'Building React and TypeScript dashboards.',
};

test('multi-user job ingest and pipeline isolation', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, jwtSecret: 'test-secret' });

  // Register User A (Alice)
  const regA = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'alice@test.com', password: 'password123' },
  });
  const tokenA = JSON.parse(regA.body).token;
  const apiKeyA = JSON.parse(regA.body).user.apiKey;

  // Register User B (Bob)
  const regB = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'bob@test.com', password: 'password123' },
  });
  const tokenB = JSON.parse(regB.body).token;
  const apiKeyB = JSON.parse(regB.body).user.apiKey;

  // Alice ingests JOB_1 and JOB_2 via personal API key
  const ingestA = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { Authorization: `Bearer ${apiKeyA}` },
    payload: { jobs: [JOB_1, JOB_2] },
  });
  assert.equal(ingestA.statusCode, 200);
  assert.equal(JSON.parse(ingestA.body).ingested, 2);

  // Bob ingests JOB_2 only (deduplicated in global catalog, but added to Bob's pipeline)
  const ingestB = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { Authorization: `Bearer ${apiKeyB}` },
    payload: { jobs: [JOB_2] },
  });
  assert.equal(ingestB.statusCode, 200);
  assert.equal(JSON.parse(ingestB.body).deduped, 1);

  // Global jobs table has only 2 unique rows
  const globalCount = db.prepare('SELECT COUNT(*) as n FROM jobs').get().n;
  assert.equal(globalCount, 2);

  // Alice queries jobs -> sees 2 jobs
  const jobsA = await app.inject({
    method: 'GET',
    url: '/api/v1/jobs',
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(jobsA.statusCode, 200);
  const aList = JSON.parse(jobsA.body).jobs;
  assert.equal(aList.length, 2);

  // Bob queries jobs -> sees only 1 job (JOB_2)
  const jobsB = await app.inject({
    method: 'GET',
    url: '/api/v1/jobs',
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(jobsB.statusCode, 200);
  const bList = JSON.parse(jobsB.body).jobs;
  assert.equal(bList.length, 1);
  assert.equal(bList[0].title, 'Frontend React Engineer');

  // Alice updates status of JOB_2 to 'applied'
  const job2Id = bList[0].id;
  const updateA = await app.inject({
    method: 'PATCH',
    url: `/api/v1/jobs/${job2Id}`,
    headers: { Authorization: `Bearer ${tokenA}` },
    payload: { status: 'applied' },
  });
  assert.equal(updateA.statusCode, 200);

  // Verify Alice's status is 'applied'
  const checkA = await app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${job2Id}`,
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(JSON.parse(checkA.body).job.status, 'applied');

  // Verify Bob's status is STILL 'new' (complete isolation)
  const checkB = await app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${job2Id}`,
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(JSON.parse(checkB.body).job.status, 'new');
});
