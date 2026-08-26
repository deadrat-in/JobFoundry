import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import { buildApp } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';

const JD =
  'Senior backend engineer working on distributed payment platforms. You will design and operate high throughput services, own reliability, and mentor other engineers across the payments organisation. Experience with Go, Kubernetes and event driven systems is expected for this role.';

function makeApp() {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, apiKeys: ['testkey'] });
  return { app, db };
}

function payload() {
  return [
    {
      title: 'Backend Engineer',
      company: 'Acme Corp',
      location: 'Berlin, DE',
      url: 'https://acme.example/j/42',
      source: 'greenhouse',
      postedAt: '2026-08-01T12:00:00Z',
      description: JD,
    },
  ];
}

test('GET /health returns ok:true without auth', async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  await app.close();
});

test('POST /api/v1/jobs/ingest without an API key returns 401', async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: 'POST', url: '/api/v1/jobs/ingest', payload: payload() });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /api/v1/jobs/ingest with a wrong API key returns 401', async () => {
  const { app } = makeApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { authorization: 'Bearer wrongkey' },
    payload: payload(),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('valid key + valid payload ingests and returns counts', async () => {
  const { app, db } = makeApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { authorization: 'Bearer testkey' },
    payload: payload(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ingested, 1);
  assert.equal(body.deduped, 0);
  assert.equal(body.ids.length, 1);
  assert.match(body.ids[0], /^[0-9a-f]{40}$/);
  const row = db.prepare('SELECT * FROM jobs WHERE url = ?').get('https://acme.example/j/42');
  assert.ok(row);
  assert.equal(row.status, 'new');
  assert.equal(row.liveness, 'unknown');
  assert.match(row.fingerprint, /^[0-9a-f]{16}$/);
  await app.close();
});

test('wrapped { jobs: [...] } body form is accepted', async () => {
  const { app } = makeApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { authorization: 'Bearer testkey' },
    payload: { jobs: payload() },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ingested, 1);
  await app.close();
});

test('second ingest of the same URL is deduped and ids stay stable', async () => {
  const { app } = makeApp();
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { authorization: 'Bearer testkey' },
    payload: payload(),
  });
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { authorization: 'Bearer testkey' },
    payload: payload(),
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), { ingested: 0, deduped: 1, ids: first.json().ids });
  await app.close();
});

test('same content from two agencies is deduped to one authoritative row', async () => {
  const { app } = makeApp();
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { authorization: 'Bearer testkey' },
    payload: [
      {
        title: 'Backend Engineer',
        company: 'Acme Corp',
        url: 'https://acme.example/j/42',
        source: 'greenhouse',
        description: JD,
      },
    ],
  });
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { authorization: 'Bearer testkey' },
    payload: [
      {
        title: 'Platform Engineer',
        company: 'Hays',
        url: 'https://hays.example/listing/7',
        source: 'lever',
        description: JD,
      },
    ],
  });
  assert.equal(first.json().ingested, 1);
  assert.equal(second.json().ingested, 0);
  assert.equal(second.json().deduped, 1);
  assert.deepEqual(second.json().ids, first.json().ids);
  await app.close();
});

test('invalid payload shape returns 400 with detail', async () => {
  const { app } = makeApp();
  const cases = [
    { payload: { jobs: [] }, label: 'object body' },
    { payload: [], label: 'empty array' },
    { payload: 'nope', headers: { 'content-type': 'application/json' }, label: 'string body' },
    { payload: [{ title: 'no url' }], label: 'job with invalid url' },
  ];
  for (const c of cases) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/ingest',
      headers: { authorization: 'Bearer testkey', ...(c.headers ?? {}) },
      payload: c.payload,
    });
    assert.equal(res.statusCode, 400, c.label);
    assert.ok(res.json().error, `detail missing for ${c.label}`);
  }

  // Batch cap test (>200 jobs)
  const hugeBatch = Array.from({ length: 201 }, (_, i) => ({
    title: `Job ${i}`,
    company: 'Acme',
    url: `https://acme.example/job/${i}`,
    source: 'greenhouse',
  }));
  const batchRes = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/ingest',
    headers: { authorization: 'Bearer testkey' },
    payload: hugeBatch,
  });
  assert.equal(batchRes.statusCode, 400);
  assert.match(batchRes.json().error, /batch size exceeds maximum/);

  await app.close();
});

test('GET /api/v1/extension/config returns seed configuration bundle', async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: 'GET', url: '/api/v1/extension/config' });
  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.equal(data.apiKey, 'testkey');
  assert.equal(data.scanIntervalHours, 6);
  assert.equal(data.fitThreshold, 75);
  assert.ok(data.serverUrl);
  await app.close();
});

test('loadConfig reads env with defaults', () => {
  const config = loadConfig({});
  assert.equal(config.port, 8080);
  assert.deepEqual(config.apiKeys, []);
  assert.equal(config.dbPath, './data/jobfoundry.db');
  assert.equal(config.artifactsDir, './data/artifacts');
  assert.equal(config.serverUrl, 'http://localhost:8080');

  const custom = loadConfig({
    PORT: '9000',
    API_KEYS: 'a, b,,c',
    DB_PATH: ':memory:',
    ARTIFACTS_DIR: '/custom/artifacts',
    SERVER_URL: 'https://jobs.example.com',
  });
  assert.equal(custom.port, 9000);
  assert.deepEqual(custom.apiKeys, ['a', 'b', 'c']);
  assert.equal(custom.dbPath, ':memory:');
  assert.equal(custom.artifactsDir, '/custom/artifacts');
  assert.equal(custom.serverUrl, 'https://jobs.example.com');
});
