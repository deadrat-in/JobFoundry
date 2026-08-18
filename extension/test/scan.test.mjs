import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { runScanPipeline } = await import(join(EXT, 'src', 'background', 'scan.js'));

function fakeProvider(id, jobs, { detect } = {}) {
  return {
    id,
    detect:
      detect ??
      ((entry) =>
        String(entry?.careers_url ?? '').includes(id) ||
        String(entry?.name ?? '').toLowerCase() === id),
    async fetch(entry, ctx) {
      assert.ok(ctx && typeof ctx.fetchJson === 'function', 'provider gets an http ctx');
      return jobs;
    },
  };
}

function inMemoryCache() {
  const map = new Map();
  return {
    async getAll() {
      return new Map(map);
    },
    async setAll(next) {
      map.clear();
      for (const [k, v] of next) map.set(k, v);
    },
  };
}

// Identity-ish fingerprint: maps description to a stable 16-hex string so the
// dedup tests are deterministic without WebCrypto.
async function fakeFingerprint(description) {
  let h = 0;
  for (const ch of String(description ?? '')) h = (h * 31 + ch.codePointAt(0)) % 0xffffffff;
  return h.toString(16).padStart(8, '0').repeat(2);
}

function job(over = {}) {
  return {
    title: 'Agentic AI Engineer',
    company: 'Acme',
    location: 'Remote',
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    description: 'Build autonomous agents that ship. ' + 'lorem ipsum dolor sit amet '.repeat(12),
    ...over,
  };
}

test('runScan resolves providers via detect and sends the normalized batch once', async () => {
  const sent = [];
  const registry = new Map([
    ['greenhouse', fakeProvider('greenhouse', [job()])],
    ['ashby', fakeProvider('ashby', [])],
  ]);
  const survivors = await runScanPipeline({
    portals: {
      acme: { name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' },
      ashbyco: { name: 'AshbyCo', careers_url: 'https://jobs.ashbyhq.com/ashbyco' },
    },
    providers: registry,
    sendJobs: async ({ jobs }) => sent.push(jobs),
    fingerprint: fakeFingerprint,
    cache: inMemoryCache(),
    liveness: async () => 'active',
    logger: { warn() {} },
  });
  assert.equal(survivors.length, 1);
  assert.equal(survivors[0].source, 'greenhouse');
  assert.equal(survivors[0].title, 'Agentic AI Engineer');
  assert.match(survivors[0].fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(sent.length, 1, 'sendJobs called exactly once');
  assert.deepEqual(
    sent[0].map((j) => j.url),
    [job().url]
  );
});

test('runScan drops expired jobs before normalizing/sending', async () => {
  const sent = [];
  const registry = new Map([
    [
      'greenhouse',
      fakeProvider('greenhouse', [
        job({ url: 'https://boards.greenhouse.io/acme/jobs/1' }),
        job({ url: 'https://boards.greenhouse.io/acme/jobs/2' }),
      ]),
    ],
  ]);
  const survivors = await runScanPipeline({
    portals: { acme: { name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' } },
    providers: registry,
    sendJobs: async ({ jobs }) => sent.push(jobs),
    fingerprint: fakeFingerprint,
    cache: inMemoryCache(),
    liveness: async (j) => (j.url.endsWith('/1') ? 'expired' : 'active'),
    logger: { warn() {} },
  });
  assert.equal(survivors.length, 1);
  assert.ok(survivors[0].url.endsWith('/2'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 1);
});

test('runScan skips sendJobs entirely when nothing survives', async () => {
  let sentCalls = 0;
  const registry = new Map([['greenhouse', fakeProvider('greenhouse', [job()])]]);
  const survivors = await runScanPipeline({
    portals: { acme: { name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' } },
    providers: registry,
    sendJobs: async () => sentCalls++,
    fingerprint: fakeFingerprint,
    cache: inMemoryCache(),
    liveness: async () => 'expired',
    logger: { warn() {} },
  });
  assert.equal(survivors.length, 0);
  assert.equal(sentCalls, 0, 'no send when the batch is empty');
});

test('runScan dedups within a batch (two providers surface the same role)', async () => {
  const sent = [];
  const same = job();
  const registry = new Map([
    ['greenhouse', fakeProvider('greenhouse', [same])],
    ['lever', fakeProvider('lever', [same])],
  ]);
  const survivors = await runScanPipeline({
    portals: {
      acme: { name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' },
      acme2: { name: 'Acme2', careers_url: 'https://jobs.lever.co/acme' },
    },
    providers: registry,
    sendJobs: async ({ jobs }) => sent.push(jobs),
    fingerprint: fakeFingerprint,
    cache: inMemoryCache(),
    liveness: async () => 'active',
    logger: { warn() {} },
  });
  assert.equal(survivors.length, 1, 'identical description across providers deduped to one');
  assert.equal(sent[0].length, 1);
});

test('runScan warns and skips a portal whose provider cannot be resolved', async () => {
  const warnings = [];
  const registry = new Map();
  const survivors = await runScanPipeline({
    portals: { orphan: { name: 'Orphan' } },
    providers: registry,
    sendJobs: async () => {},
    fingerprint: fakeFingerprint,
    cache: inMemoryCache(),
    liveness: async () => 'active',
    logger: { warn: (msg) => warnings.push(msg) },
  });
  assert.deepEqual(survivors, []);
  assert.ok(warnings.length >= 1, 'warned about the unresolvable portal');
});

test('runScan swallows a provider fetch failure and continues', async () => {
  const sent = [];
  const registry = new Map([
    [
      'broken',
      {
        id: 'broken',
        detect: (entry) => String(entry?.careers_url ?? '').includes('broken'),
        async fetch() {
          throw new Error('down');
        },
      },
    ],
    ['greenhouse', fakeProvider('greenhouse', [job()])],
  ]);
  const survivors = await runScanPipeline({
    portals: {
      broken: { name: 'Broken', careers_url: 'https://broken.example' },
      acme: { name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' },
    },
    providers: registry,
    sendJobs: async ({ jobs }) => sent.push(jobs),
    fingerprint: fakeFingerprint,
    cache: inMemoryCache(),
    liveness: async () => 'active',
    logger: { warn() {} },
  });
  assert.equal(survivors.length, 1);
  assert.equal(sent.length, 1);
});

test('runScan skips portals explicitly disabled with false', async () => {
  let fetched = 0;
  const registry = new Map([
    [
      'greenhouse',
      {
        id: 'greenhouse',
        detect: () => true,
        async fetch() {
          fetched++;
          return [job()];
        },
      },
    ],
  ]);
  await runScanPipeline({
    portals: {
      disabled: false,
      acme: { name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' },
    },
    providers: registry,
    sendJobs: async () => {},
    fingerprint: fakeFingerprint,
    cache: inMemoryCache(),
    liveness: async () => 'active',
    logger: { warn() {} },
  });
  assert.equal(fetched, 1, 'disabled portal was not fetched');
});

test('runScan uses config.portals when getConfig is provided and portals is null', async () => {
  const sent = [];
  const registry = new Map([['greenhouse', fakeProvider('greenhouse', [job()])]]);
  await runScanPipeline({
    getConfig: async () => ({
      portals: { acme: { name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' } },
    }),
    providers: registry,
    sendJobs: async ({ jobs }) => sent.push(jobs),
    fingerprint: fakeFingerprint,
    cache: inMemoryCache(),
    liveness: async () => 'active',
    logger: { warn() {} },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].source, 'greenhouse');
});
