import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendJobs,
  ConfigError,
  AuthError,
  HttpError,
  TimeoutError,
} from '../src/shared/ingest-client.js';

const JOB = { title: 'Backend Engineer', url: 'https://acme.example/j/1', company: 'Acme' };

function config(overrides = {}) {
  return {
    getConfig: async () => ({
      serverUrl: 'http://localhost:8080',
      apiKey: 'secret',
      ...overrides,
    }),
  };
}

function jsonResponse(body, status = 200, ok = true) {
  return { ok, status, json: async () => body };
}

test('POSTs to the ingest endpoint with auth header and { jobs } body', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return jsonResponse({ ingested: 2, deduped: 1, ids: ['a', 'b'] });
  };
  const res = await sendJobs({ jobs: [JOB], ...config(), fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:8080/api/v1/jobs/ingest');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer secret');
  assert.match(calls[0].opts.headers['Content-Type'], /application\/json/);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { jobs: [JOB] });
  assert.deepEqual(res, { ingested: 2, deduped: 1, ids: ['a', 'b'] });
});

test('normalizes a trailing slash on serverUrl', async () => {
  let seenUrl;
  const fetchImpl = async (url) => {
    seenUrl = url;
    return jsonResponse({ ingested: 0, deduped: 0, ids: [] });
  };
  await sendJobs({
    jobs: [JOB],
    ...config({ serverUrl: 'http://localhost:8080/' }),
    fetchImpl,
  });
  assert.equal(seenUrl, 'http://localhost:8080/api/v1/jobs/ingest');
});

test('rejects with an auth error on 401', async () => {
  const fetchImpl = async () => jsonResponse({ error: 'unauthorized' }, 401, false);
  await assert.rejects(
    () => sendJobs({ jobs: [JOB], ...config(), fetchImpl }),
    (err) => err instanceof AuthError && /auth/i.test(err.message)
  );
});

test('retries 5xx responses with backoff and rejects after retries exhausted', async () => {
  let attempts = 0;
  const sleeps = [];
  const fetchImpl = async () => {
    attempts += 1;
    return jsonResponse({ error: 'boom' }, 503, false);
  };
  const sleep = async (ms) => {
    sleeps.push(ms);
  };
  await assert.rejects(
    () =>
      sendJobs({
        jobs: [JOB],
        ...config(),
        fetchImpl,
        retries: 2,
        backoffMs: 10,
        sleep,
      }),
    (err) => err instanceof HttpError && err.status === 503
  );
  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(
    sleeps.every((ms) => ms >= 10),
    'backoff delays should respect backoffMs'
  );
});

test('succeeds when a retry eventually returns 2xx', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 3) return jsonResponse({ error: 'busy' }, 502, false);
    return jsonResponse({ ingested: 1, deduped: 0, ids: ['x'] });
  };
  const res = await sendJobs({
    jobs: [JOB],
    ...config(),
    fetchImpl,
    retries: 2,
    backoffMs: 5,
    sleep: async () => {},
  });
  assert.equal(attempts, 3);
  assert.deepEqual(res, { ingested: 1, deduped: 0, ids: ['x'] });
});

test('rejects with a timeout error when the request hangs', async () => {
  const fetchImpl = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  await assert.rejects(
    () => sendJobs({ jobs: [JOB], ...config(), fetchImpl, timeoutMs: 20 }),
    (err) => err instanceof TimeoutError
  );
});

test('throws a config error when serverUrl is unset', async () => {
  await assert.rejects(
    () => sendJobs({ jobs: [JOB], ...config({ serverUrl: null }), fetchImpl: async () => {} }),
    (err) => err instanceof ConfigError && /serverUrl/i.test(err.message)
  );
});

test('throws a config error when apiKey is unset', async () => {
  await assert.rejects(
    () => sendJobs({ jobs: [JOB], ...config({ apiKey: null }), fetchImpl: async () => {} }),
    (err) => err instanceof ConfigError && /apiKey/i.test(err.message)
  );
});
