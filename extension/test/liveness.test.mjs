import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { classifyAshbyBoard, resolveAtsApi, isAtsPosting, checkLivenessViaApi, checkLiveness } =
  await import(join(EXT, 'src', 'background', 'liveness', 'index.js'));

// A minimal http ctx whose fetchResponse is under test control.
function ctxFor(response) {
  return { fetchResponse: async () => response };
}

function mockResponse(status, body = '', { type } = {}) {
  return {
    status,
    type,
    headers: new Headers(),
    text: async () => body,
    json: async () => {
      try {
        return JSON.parse(body);
      } catch {
        throw new Error('unparseable body');
      }
    },
  };
}

test('resolveAtsApi maps known ATS posting URLs to fixed-host API URLs', () => {
  const gh = resolveAtsApi('https://boards.greenhouse.io/acme/jobs/123');
  assert.equal(gh?.ats, 'greenhouse');
  assert.equal(gh.apiUrl, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/123');

  const lever = resolveAtsApi('https://jobs.lever.co/acme/xyz-123');
  assert.equal(lever?.ats, 'lever');
  assert.equal(lever.apiUrl, 'https://api.lever.co/v0/postings/acme/xyz-123');

  const euLever = resolveAtsApi('https://jobs.eu.lever.co/acme/xyz-123');
  assert.equal(euLever?.ats, 'lever');
  assert.equal(euLever.apiUrl, 'https://api.eu.lever.co/v0/postings/acme/xyz-123');

  const ashby = resolveAtsApi('https://jobs.ashbyhq.com/acme/abc-123');
  assert.equal(ashby?.ats, 'ashby');
  assert.equal(ashby.apiUrl, 'https://api.ashbyhq.com/posting-api/job-board/acme');
  assert.equal(typeof ashby.interpret, 'function');

  const workday = resolveAtsApi(
    'https://acme.wd1.myworkdayjobs.com/en-US/Acme/job/Toronto-ON-CAN/Agentic-AI-Engineer_R260010125'
  );
  assert.equal(workday?.ats, 'workday');
  assert.equal(
    workday.apiUrl,
    'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Acme/job/Toronto-ON-CAN/Agentic-AI-Engineer_R260010125'
  );
});

test('resolveAtsApi rejects unknown hosts, non-https, and unsafe segments', () => {
  assert.equal(resolveAtsApi('https://example.com/jobs/123'), null);
  assert.equal(resolveAtsApi('http://boards.greenhouse.io/acme/jobs/123'), null);
  assert.equal(resolveAtsApi('not a url'), null);
  // SSRF guard: junk in an extracted path segment is rejected (the URL parser
  // already normalizes literal `..` away, so traversal that survives is
  // percent-encoded — exactly what the strict charset refuses).
  assert.equal(resolveAtsApi('https://jobs.ashbyhq.com/acme/%2e%2e/job'), null);
  assert.equal(resolveAtsApi('https://boards.greenhouse.io/acme/jobs/123/../../x'), null);
  assert.equal(resolveAtsApi('https://jobs.lever.co/acme/bad%20segment'), null);
});

test('isAtsPosting delegates to resolveAtsApi', () => {
  assert.equal(isAtsPosting('https://boards.greenhouse.io/acme/jobs/1'), true);
  assert.equal(isAtsPosting('https://example.com/'), false);
});

test('classifyAshbyBoard is pure and deterministic', () => {
  const active = classifyAshbyBoard({ jobs: [{ id: 'ABC', isListed: true }] }, 'abc');
  assert.equal(active?.result, 'active');
  const unlisted = classifyAshbyBoard({ jobs: [{ id: 'ABC', isListed: false }] }, 'abc');
  assert.equal(unlisted?.result, 'expired');
  const absent = classifyAshbyBoard({ jobs: [{ id: 'XYZ' }] }, 'abc');
  assert.equal(absent?.result, 'expired');
  assert.equal(classifyAshbyBoard({ nope: true }, 'abc'), null);
  assert.equal(classifyAshbyBoard(null, 'abc'), null);
});

test('checkLivenessViaApi: definitive 404/410 → expired', async () => {
  const res = await checkLivenessViaApi(
    { url: 'https://boards.greenhouse.io/acme/jobs/123' },
    ctxFor(mockResponse(404))
  );
  assert.equal(res.result, 'expired');
  assert.equal(res.code, 'greenhouse_api_gone');
});

test('checkLivenessViaApi: greenhouse 200 → active (per-job API)', async () => {
  const res = await checkLivenessViaApi(
    { url: 'https://boards.greenhouse.io/acme/jobs/123' },
    ctxFor(mockResponse(200, '{"id":123}'))
  );
  assert.equal(res.result, 'active');
  assert.equal(res.code, 'greenhouse_api_ok');
});

test('checkLivenessViaApi: lever 404 is inconclusive (api404Authoritative false)', async () => {
  const res = await checkLivenessViaApi(
    { url: 'https://jobs.lever.co/acme/xyz-123' },
    ctxFor(mockResponse(404))
  );
  assert.equal(res, null);
});

test('checkLivenessViaApi: ashby 200 with listed job → active', async () => {
  const res = await checkLivenessViaApi(
    { url: 'https://jobs.ashbyhq.com/acme/abc-123' },
    ctxFor(mockResponse(200, JSON.stringify({ jobs: [{ id: 'abc-123', isListed: true }] })))
  );
  assert.equal(res.result, 'active');
  assert.equal(res.code, 'ashby_api_ok');
});

test('checkLivenessViaApi: ashby 200 with missing job → expired', async () => {
  const res = await checkLivenessViaApi(
    { url: 'https://jobs.ashbyhq.com/acme/abc-123' },
    ctxFor(mockResponse(200, JSON.stringify({ jobs: [] })))
  );
  assert.equal(res.result, 'expired');
  assert.equal(res.code, 'ashby_api_unlisted');
});

test('checkLivenessViaApi: 429/5xx/other → inconclusive (null)', async () => {
  for (const status of [429, 500, 503]) {
    const res = await checkLivenessViaApi(
      { url: 'https://boards.greenhouse.io/acme/jobs/123' },
      ctxFor(mockResponse(status))
    );
    assert.equal(res, null, `status ${status} must be inconclusive`);
  }
});

test('checkLivenessViaApi: non-ATS URL → null', async () => {
  const res = await checkLivenessViaApi(
    { url: 'https://example.com/jobs/1' },
    ctxFor(mockResponse(200))
  );
  assert.equal(res, null);
});

test('checkLivenessViaApi: fetch rejection → null (network/timeout/redirect)', async () => {
  const res = await checkLivenessViaApi(
    { url: 'https://boards.greenhouse.io/acme/jobs/123' },
    {
      fetchResponse: async () => {
        throw new TypeError('fetch failed');
      },
    }
  );
  assert.equal(res, null);
});

test('checkLiveness maps to the canonical tri-state', async () => {
  assert.equal(
    await checkLiveness(
      { url: 'https://boards.greenhouse.io/acme/jobs/123' },
      ctxFor(mockResponse(404))
    ),
    'expired'
  );
  assert.equal(
    await checkLiveness(
      { url: 'https://boards.greenhouse.io/acme/jobs/123' },
      ctxFor(mockResponse(200))
    ),
    'active'
  );
  assert.equal(
    await checkLiveness(
      { url: 'https://boards.greenhouse.io/acme/jobs/123' },
      ctxFor(mockResponse(500))
    ),
    'unknown'
  );
  assert.equal(
    await checkLiveness({ url: 'https://example.com/jobs/1' }, ctxFor(mockResponse(200))),
    'unknown'
  );
});
