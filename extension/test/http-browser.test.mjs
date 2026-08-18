import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(join(EXT, 'src', 'background', 'providers', '_http.mjs')).then(
  () => import(join(EXT, 'src', 'background', 'providers', '_http.mjs'))
);
const {
  fetchJson,
  fetchText,
  fetchResponse,
  sleep,
  parseRetryAfterMs,
  isRetryableError,
  fetchJsonWithRetry,
  makeHttpCtx,
} = mod;

function mockResponse(status, body, { headers = {}, type } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `S${status}`,
    type,
    headers: new Headers(headers),
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

// A tiny fetch impl that never needs the network.
let fetchImpl;
function setFetch(fn) {
  fetchImpl = fn;
}

// The module under test references global fetch; wire it via a shim that
// proxies to fetchImpl so each test controls the response.
const realFetch = globalThis.fetch;
const shim = async (...args) => {
  if (!fetchImpl) throw new Error('no fetch stub');
  return fetchImpl(...args);
};
globalThis.fetch = shim;
test.after(() => {
  if (realFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = realFetch;
});

test('isRedirectResponse refuses 3xx under manual redirect (SSRF trust guard)', async () => {
  setFetch(async (url, opts) => {
    assert.equal(opts.redirect, 'manual', 'browser port pins redirect:manual');
    return mockResponse(302, '', {
      headers: { location: 'https://evil.example/steal' },
      type: 'basic',
    });
  });
  await assert.rejects(
    () => fetchText('https://boards.example.com/jobs/1'),
    (err) => {
      assert.ok(err instanceof TypeError);
      assert.equal(err.cause?.message, 'unexpected redirect');
      assert.equal(err.status, 302);
      assert.equal(err.location, 'https://evil.example/steal');
      return true;
    }
  );
});

test('opaqueredirect (status 0) is refused as a redirect too', async () => {
  setFetch(async () => mockResponse(0, '', { type: 'opaqueredirect' }));
  await assert.rejects(
    () => fetchJson('https://boards.example.com/jobs/1'),
    (err) => err instanceof TypeError && err.cause?.message === 'unexpected redirect'
  );
});

test('redirect refusal is non-retryable (same shape as undici redirect:error)', () => {
  const redirectErr = new TypeError('fetch failed');
  redirectErr.cause = { message: 'unexpected redirect' };
  assert.equal(isRetryableError(redirectErr), false);

  const opaqueredirect = new TypeError('fetch failed');
  opaqueredirect.cause = { message: 'unexpected redirect' };
  opaqueredirect.status = 302;
  assert.equal(isRetryableError(opaqueredirect), false);
});

test('HTTP errors carry status, body, retry-after and location', async () => {
  setFetch(async () =>
    mockResponse(429, '{"error":"slow down"}', {
      headers: { 'retry-after': '5', location: 'https://cdn.example/list' },
    })
  );
  await assert.rejects(
    () => fetchJson('https://api.example.com/list'),
    (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.retryAfter, '5');
      assert.equal(err.location, 'https://cdn.example/list');
      assert.equal(err.body, '{"error":"slow down"}');
      return true;
    }
  );
});

test('non-2xx without retry-after retries with exponential backoff then rethrows with attempts', async () => {
  const calls = [];
  setFetch(async () => {
    calls.push(1);
    return mockResponse(500, 'boom');
  });
  await assert.rejects(() =>
    fetchJsonWithRetry(
      makeHttpCtx(),
      'https://api.example.com/500',
      {},
      { retries: 2, baseDelayMs: 1 }
    )
  );
  assert.equal(calls.length, 3, 'two retries = three total attempts');
});

test('retry-after clamp prevents a hostile Retry-After from stalling the sweep', async () => {
  const calls = [];
  let n = 0;
  setFetch(async () => {
    calls.push(1);
    n++;
    return mockResponse(n === 1 ? 429 : 200, n === 1 ? 'slow' : '{"ok":true}', {
      headers: { 'retry-after': '86400' },
    });
  });
  const out = await fetchJsonWithRetry(
    makeHttpCtx(),
    'https://api.example.com/429',
    {},
    { retries: 1, baseDelayMs: 1, maxDelayMs: 4 }
  );
  assert.equal(out.ok, true);
  assert.equal(calls.length, 2);
});

test('5xx is retryable, 404 is not', () => {
  assert.equal(isRetryableError({ status: 500 }), true);
  assert.equal(isRetryableError({ status: 503 }), true);
  assert.equal(isRetryableError({ status: 404 }), false);
  assert.equal(isRetryableError({ status: 403 }), false);
  assert.equal(isRetryableError({}), true, 'transport errors without a status are retryable');
});

test('parseRetryAfterMs handles delta-seconds and HTTP-date, rejects garbage', () => {
  assert.equal(parseRetryAfterMs('5'), 5000);
  assert.equal(parseRetryAfterMs('0'), 0);
  const future = new Date(Date.now() + 60_000).toUTCString();
  const parsed = parseRetryAfterMs(future);
  assert.ok(parsed !== null && parsed > 0 && parsed <= 60_000);
  assert.equal(parseRetryAfterMs('not-a-date'), null);
  assert.equal(parseRetryAfterMs(null), null);
});

test('ctx.sleep is honoured so tests never wall-clock wait', async () => {
  const slept = [];
  await sleep(10, { sleep: async (ms) => slept.push(ms) });
  assert.deepEqual(slept, [10]);
});

test('fetchResponse returns a real Response with body for 200', async () => {
  setFetch(async () =>
    mockResponse(200, '{"jobs":[]}', { headers: { 'content-type': 'application/json' } })
  );
  const res = await fetchResponse('https://boards.example.com/jobs');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"jobs":[]}');
});

test('fetchResponse nulls the body for 204/205/304', async () => {
  for (const status of [204, 205, 304]) {
    setFetch(async () => mockResponse(status, 'should-not-survive'));
    const res = await fetchResponse('https://boards.example.com/jobs');
    assert.equal(res.status, status);
    assert.equal(await res.text(), '');
  }
});
