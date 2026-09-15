import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openDb } from '../src/db/index.mjs';
import { buildApp } from '../src/app.mjs';

function makeApp(options = {}) {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, apiKeys: ['testkey'], logger: false, ...options });
  return { app, db };
}

const RATE_LIMITED_ROUTES = [
  { method: 'PUT', url: '/api/v1/extension/config', max: 30 },
  { method: 'GET', url: '/api/v1/relay/tasks/lease', max: 60 },
  { method: 'POST', url: '/api/v1/relay/tasks/task-1/fulfill', max: 60 },
  { method: 'GET', url: '/api/v1/relay/tasks/task-1', max: 60 },
  { method: 'POST', url: '/api/v1/jobs/job-1/sanitize', max: 30 },
  { method: 'PATCH', url: '/api/v1/jobs/job-1', max: 60 },
  { method: 'DELETE', url: '/api/v1/jobs/job-1', max: 30 },
  { method: 'POST', url: '/api/v1/jobs/job-1/tailor', max: 30 },
  { method: 'GET', url: '/api/v1/jobs/job-1/artifacts/resume.txt', max: 60 },
  { method: 'GET', url: '/api/v1/pipeline/stats', max: 60 },
  { method: 'GET', url: '/api/v1/pipeline/jobs', max: 60 },
];

test('security rate limits protect every newly shielded endpoint', async () => {
  for (const route of RATE_LIMITED_ROUTES) {
    const { app } = makeApp();
    try {
      for (let attempt = 0; attempt < route.max; attempt += 1) {
        const response = await app.inject({ method: route.method, url: route.url });
        assert.equal(
          response.statusCode,
          401,
          `${route.method} ${route.url}, attempt ${attempt + 1}`
        );
      }

      const blocked = await app.inject({ method: route.method, url: route.url });
      assert.equal(blocked.statusCode, 429, `${route.method} ${route.url}`);
      assert.deepEqual(blocked.json(), {
        error: 'Too many requests, please try again later.',
      });
    } finally {
      await app.close();
    }
  }
});

test('security rate limit releases an address after the sliding window expires', async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const { app } = makeApp();

  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await app.inject({ method: 'PUT', url: '/api/v1/extension/config' });
      assert.equal(response.statusCode, 401);
    }
    assert.equal(
      (await app.inject({ method: 'PUT', url: '/api/v1/extension/config' })).statusCode,
      429
    );

    now += 60_001;
    assert.equal(
      (await app.inject({ method: 'PUT', url: '/api/v1/extension/config' })).statusCode,
      401
    );
  } finally {
    Date.now = originalNow;
    await app.close();
  }
});

test('tailor and artifact routes reject invalid job IDs before accessing storage', async () => {
  const { app } = makeApp();

  try {
    const tailorResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/job.bad/tailor',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(tailorResponse.statusCode, 400);
    assert.deepEqual(tailorResponse.json(), { error: 'Invalid job ID format' });

    const artifactResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/job.bad/artifacts/resume.txt',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(artifactResponse.statusCode, 400);
    assert.deepEqual(artifactResponse.json(), { error: 'Invalid job ID format' });

    const validMissingJob = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/job_ok-1/tailor',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(validMissingJob.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('tailoring never falls back to another users active resume', async () => {
  const { app, db } = makeApp();
  const now = Date.now();
  const resume = JSON.stringify({ basics: { name: 'Bob' } });

  db.prepare(
    'INSERT INTO users (id, email, password_hash, name, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('alice', 'alice@example.com', 'hash', 'Alice', 'alice-key', now, now);
  db.prepare(
    'INSERT INTO users (id, email, password_hash, name, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('bob', 'bob@example.com', 'hash', 'Bob', 'bob-key', now, now);
  db.prepare(
    'INSERT INTO user_resumes (id, user_id, title, resume_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('resume-bob', 'bob', 'Master Resume', resume, 1, now, now);
  db.prepare(
    `INSERT INTO jobs (id, title, company, location, url, source, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'job-1',
    'Engineer',
    'Acme',
    'Remote',
    'https://jobs.example.com/job-1',
    'test',
    'Build reliable systems.',
    now,
    now
  );
  db.prepare(
    `INSERT INTO user_jobs (id, user_id, job_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('alice-job-1', 'alice', 'job-1', 'new', now, now);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/job-1/tailor',
      headers: { authorization: 'Bearer alice-key' },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'No active master resume found. Please upload one in Profile & Resume before tailoring.',
    });
  } finally {
    await app.close();
  }
});

test('artifact route serves safe files but cannot traverse outside the artifacts directory', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'jobfoundry-artifacts-'));
  const artifactsDir = join(tempRoot, 'artifacts');
  const expectedPath = join(artifactsDir, 'legacy-admin', 'job-safe', 'resume.txt');
  const outsidePath = join(tempRoot, 'outside.txt');
  await mkdir(dirname(expectedPath), { recursive: true });
  await writeFile(expectedPath, 'expected artifact', 'utf8');
  await writeFile(outsidePath, 'outside secret', 'utf8');
  const { app } = makeApp({ artifactsDir });

  try {
    const valid = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/job-safe/artifacts/resume.txt',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(valid.body, 'expected artifact');

    const traversal = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/job-safe/artifacts/..%2F..%2Foutside.txt',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.notEqual(traversal.statusCode, 200);
    assert.notEqual(traversal.body, 'outside secret');

    const malformedFilename = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/job-safe/artifacts/@@@',
      headers: { authorization: 'Bearer testkey' },
    });
    assert.equal(malformedFilename.statusCode, 400);
    assert.deepEqual(malformedFilename.json(), { error: 'Invalid artifact filename' });
  } finally {
    await app.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
