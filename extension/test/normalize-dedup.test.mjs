import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { normalizeJob, withFingerprint } = await import(
  join(EXT, 'src', 'background', 'normalize.js')
);
const { dedupJobs, createSessionCache, DEDUP_WINDOW_HOURS, STORAGE_KEY } = await import(
  join(EXT, 'src', 'background', 'dedup.js')
);

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

test('normalizeJob produces the Phase 01 canonical shape', () => {
  const out = normalizeJob(
    {
      title: '  Agentic AI Engineer  ',
      company: 'Acme Corp',
      location: 'Remote (US)',
      url: 'https://boards.greenhouse.io/acme/jobs/123',
      postedAt: '2026-08-01T00:00:00Z',
      description: '<p>Build agents.</p>',
    },
    'greenhouse'
  );
  assert.deepEqual(out, {
    title: '  Agentic AI Engineer  ',
    company: 'Acme Corp',
    location: 'Remote (US)',
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    source: 'greenhouse',
    postedAt: Date.parse('2026-08-01T00:00:00Z'),
    description: '<p>Build agents.</p>',
    fingerprint: '',
  });
});

test('normalizeJob sanitizes null/missing/blank fields like the server normalizer', () => {
  const out = normalizeJob(
    {
      url: 'https://example.com/jobs/1',
      postedAt: 'not-a-date',
      location: '',
      title: 42,
      company: null,
    },
    ''
  );
  assert.equal(out.title, '');
  assert.equal(out.company, '');
  assert.equal(out.location, null);
  assert.equal(out.postedAt, null);
  assert.equal(out.source, 'unknown');
  assert.equal(out.description, '');
});

test('normalizeJob rejects missing/invalid url and non-object jobs', () => {
  assert.throws(() => normalizeJob({ title: 'x' }, 'gh'), /invalid url/);
  assert.throws(() => normalizeJob({ url: 'ftp://x' }, 'gh'), /invalid url/);
  assert.throws(() => normalizeJob('nope', 'gh'), TypeError);
  assert.throws(() => normalizeJob([], 'gh'), TypeError);
});

test('withFingerprint attaches the computed content fingerprint', async () => {
  const fp = 'ab'.repeat(8);
  const out = await withFingerprint({ description: 'long body' }, async () => fp);
  assert.equal(out.fingerprint, fp);
});

test('dedupJobs drops exact-duplicate fingerprints within one batch', async () => {
  const cache = inMemoryCache();
  const jobs = [
    { title: 'A', fingerprint: 'a1'.repeat(8) },
    { title: 'B', fingerprint: 'b2'.repeat(8) },
    { title: 'A2', fingerprint: 'a1'.repeat(8) },
  ];
  const survivors = await dedupJobs(jobs, cache);
  assert.deepEqual(
    survivors.map((j) => j.title),
    ['A', 'B']
  );
});

test('dedupJobs keeps jobs without a fingerprint (no signal, no drop)', async () => {
  const cache = inMemoryCache();
  const jobs = [{ title: 'A', fingerprint: '' }, { title: 'B' }];
  const survivors = await dedupJobs(jobs, cache);
  assert.deepEqual(
    survivors.map((j) => j.title),
    ['A', 'B']
  );
});

test('dedupJobs drops a fingerprint seen within the window, keeps it after expiry', async () => {
  const cache = inMemoryCache();
  const fp = 'c3'.repeat(8);
  const t0 = 1_000_000_000_000;
  const jobs = [{ title: 'A', fingerprint: fp }];

  const first = await dedupJobs(jobs, cache, { now: () => t0 });
  assert.deepEqual(
    first.map((j) => j.title),
    ['A']
  );

  const within = await dedupJobs(jobs, cache, { now: () => t0 + DEDUP_WINDOW_HOURS * 3600000 - 1 });
  assert.deepEqual(
    within.map((j) => j.title),
    [],
    'dropped within the 24h window'
  );

  const after = await dedupJobs(jobs, cache, { now: () => t0 + DEDUP_WINDOW_HOURS * 3600000 + 1 });
  assert.deepEqual(
    after.map((j) => j.title),
    ['A'],
    're-sent after the window'
  );
});

test('dedupJobs prunes expired entries when persisting the cache', async () => {
  const cache = inMemoryCache();
  const fresh = 'f'.repeat(16);
  const stale = 's'.repeat(16);
  const t0 = 1_000_000_000_000;
  await cache.setAll(
    new Map([
      [fresh, t0],
      [stale, t0 - DEDUP_WINDOW_HOURS * 3600000 * 2],
    ])
  );
  await dedupJobs([{ title: 'A', fingerprint: fresh }], cache, { now: () => t0 });
  const after = await cache.getAll();
  assert.ok(after.has(fresh));
  assert.ok(!after.has(stale), 'stale entry pruned from persisted cache');
});

test('onDedup callback receives each dropped job', async () => {
  const cache = inMemoryCache();
  const dropped = [];
  const fp = 'd'.repeat(16);
  await dedupJobs(
    [
      { title: 'A', fingerprint: fp },
      { title: 'B', fingerprint: fp },
    ],
    cache,
    { onDedup: (job) => dropped.push(job.title) }
  );
  assert.deepEqual(dropped, ['B']);
});

test('createSessionCache reads/writes through browser.storage.session', async () => {
  const session = (() => {
    const map = new Map();
    return {
      async get(key) {
        return { [key]: map.get(key) };
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) map.set(k, v);
      },
    };
  })();
  const cache = createSessionCache({ browser: { storage: { session } } });
  await cache.setAll(new Map([['aa'.repeat(8), 123]]));
  const out = await cache.getAll();
  assert.equal(out.get('aa'.repeat(8)), 123);
});

test('createSessionCache falls back to in-memory when session storage is absent', async () => {
  const cache = createSessionCache({ browser: { storage: {} } });
  await cache.setAll(new Map([['bb'.repeat(8), 1]]));
  assert.equal((await cache.getAll()).get('bb'.repeat(8)), 1);
  // Fallback key is the documented STORAGE_KEY for shape compat.
  assert.equal(typeof STORAGE_KEY, 'string');
  assert.ok(STORAGE_KEY.length > 0);
});
