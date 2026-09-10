import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, fetchSeedConfig, validate } from '../src/shared/config.ts';

test('defaults match the implementation plan table exactly', () => {
  assert.deepEqual(defaults, {
    serverUrl: null,
    apiKey: null,
    scanIntervalHours: 6,
    passiveMode: true,
    activeMode: false,
    activeModeDelayMs: 2000,
    fitThreshold: 75,
    titleFilter: {
      positive: [],
      negative: ['word:intern', 'junior', '.net', 'php', 'wordpress', 'embedded', 'firmware'],
    },
    maxPostingAgeDays: 30,
    locationFilter: {
      allow: ['remote', 'worldwide', 'anywhere'],
      block: [],
    },
    portals: {
      // Global Remote — ON by default (except ✦ paid-post boards)
      remoteok: false,
      weworkremotely: false,
      himalayas: true,
      arbeitnow: true,
      jobspresso: true,
      '4dayweek': true,
      remotive: true,
      workingnomads: true,
      hackernews: true,
      cryptocurrencyjobs: true,
      nodesk: true,
      larajobs: true,
      torre: true,
      themuse: true,
      landingjobs: true,
      flowxtra: true,
      thehub: true,
      'agentic-jobs': true,
      // Regional & Niche — ON by default
      jobicy: true,
      remotli: true,
      getonbrd: true,
      manfred: true,
      wttj: true,
      nofluffjobs: true,
      justjoin: true,
      solidjobs: true,
      senjob: true,
      jobbankca: true,
      arbeitsagentur: true,
      vdab: true,
      higheredjobs: true,
      glints: true,
      jobstreet: true,
      mycareersfuture: true,
      careerviet: true,
      itviec: true,
      yourator: true,
      // Company-Specific — ON by default
      ibm: true,
      amazon: true,
      'a16z-speedrun-talent': true,
    },
    trackedCompanies: [],
  });
});

test('validate accepts valid configuration', () => {
  assert.doesNotThrow(() => {
    validate({ scanIntervalHours: 4, fitThreshold: 80, activeModeDelayMs: 1500 });
  });
});

test('validate rejects non-numeric or <1 scanIntervalHours', () => {
  assert.throws(() => validate({ scanIntervalHours: 0 }), /scanIntervalHours/);
  assert.throws(() => validate({ scanIntervalHours: -2 }), /scanIntervalHours/);
});

test('validate rejects fitThreshold out of 0-100 range', () => {
  assert.throws(() => validate({ fitThreshold: -1 }), /fitThreshold/);
  assert.throws(() => validate({ fitThreshold: 101 }), /fitThreshold/);
});

test('validate rejects negative activeModeDelayMs', () => {
  assert.throws(() => validate({ activeModeDelayMs: -500 }), /activeModeDelayMs/);
});

test('fetchSeedConfig retrieves config bundle from server', async () => {
  const mockFetch = async (url) => {
    assert.equal(url, 'http://127.0.0.1:8080/api/v1/extension/config');
    return {
      ok: true,
      json: async () => ({
        serverUrl: 'http://127.0.0.1:8080',
        apiKey: 'seed-token-123',
        fitThreshold: 80,
      }),
    };
  };

  const seed = await fetchSeedConfig('http://127.0.0.1:8080', { fetchImpl: mockFetch });
  assert.equal(seed.serverUrl, 'http://127.0.0.1:8080');
  assert.equal(seed.apiKey, 'seed-token-123');
  assert.equal(seed.fitThreshold, 80);
});

test('syncConfigFromServer updates local config from server API', async () => {
  const { syncConfigFromServer } = await import('../src/shared/config.ts');
  const store = {};
  const mockStorage = {
    async get(key) {
      return { [key]: store[key] };
    },
    async set(obj) {
      Object.assign(store, obj);
    },
  };

  const mockFetch = async (url, options) => {
    assert.ok(url.endsWith('/api/v1/extension/config'));
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return {
      ok: true,
      json: async () => ({
        ok: true,
        config: {
          titleFilter: { positive: ['AI Engineer'], negative: ['junior'] },
          portals: { himalayas: true, remoteok: true },
          scanIntervalHours: 12,
        },
      }),
    };
  };

  const updated = await syncConfigFromServer('http://127.0.0.1:8080', 'test-key', {
    fetchImpl: mockFetch,
    storageImpl: mockStorage,
  });

  assert.equal(updated.serverUrl, 'http://127.0.0.1:8080');
  assert.equal(updated.apiKey, 'test-key');
  assert.deepEqual(updated.titleFilter.positive, ['AI Engineer']);
  assert.equal(updated.portals.remoteok, true);
  assert.equal(updated.scanIntervalHours, 12);
});

test('syncConfigFromServer preserves cached local config if server fetch fails', async () => {
  const { syncConfigFromServer, setConfig } = await import('../src/shared/config.ts');
  const store = {};
  const mockStorage = {
    async get(key) {
      return { [key]: store[key] };
    },
    async set(obj) {
      Object.assign(store, obj);
    },
  };

  await setConfig(
    {
      serverUrl: 'http://cached-server:8080',
      apiKey: 'cached-key',
      scanIntervalHours: 4,
    },
    { storageImpl: mockStorage }
  );

  const failingFetch = async () => {
    throw new Error('Network offline');
  };

  const config = await syncConfigFromServer('http://cached-server:8080', 'cached-key', {
    fetchImpl: failingFetch,
    storageImpl: mockStorage,
  });

  assert.equal(config.serverUrl, 'http://cached-server:8080');
  assert.equal(config.scanIntervalHours, 4);
});

test('enqueueOfflineJobs and flushOfflineJobs manage queue and retry on connect', async () => {
  const { enqueueOfflineJobs, getOfflineQueue, flushOfflineJobs, clearOfflineQueue } =
    await import('../src/shared/config.ts');
  const store = {};
  const mockStorage = {
    async get(key) {
      return { [key]: store[key] };
    },
    async set(obj) {
      Object.assign(store, obj);
    },
    async remove(key) {
      delete store[key];
    },
  };

  await clearOfflineQueue({ storageImpl: mockStorage });
  const initial = await getOfflineQueue({ storageImpl: mockStorage });
  assert.equal(initial.length, 0);

  const jobs = [
    { title: 'Job 1', company: 'Acme', url: 'https://acme.com/1', fingerprint: 'fp1' },
    { title: 'Job 2', company: 'Beta', url: 'https://beta.com/2', fingerprint: 'fp2' },
  ];

  await enqueueOfflineJobs(jobs, { storageImpl: mockStorage });
  // Adding duplicates should deduplicate
  await enqueueOfflineJobs([jobs[0]], { storageImpl: mockStorage });

  const queued = await getOfflineQueue({ storageImpl: mockStorage });
  assert.equal(queued.length, 2);

  // When sendJobs fails (e.g. still offline), queue is preserved
  const failedFlush = await flushOfflineJobs(
    async () => {
      throw new Error('Connection refused');
    },
    {
      storageImpl: mockStorage,
      getConfig: async () => ({ serverUrl: 'http://localhost:8080', apiKey: 'test' }),
    }
  );
  assert.equal(failedFlush.flushed, 0);
  assert.equal(failedFlush.remaining, 2);
  const stillQueued = await getOfflineQueue({ storageImpl: mockStorage });
  assert.equal(stillQueued.length, 2);

  // When sendJobs succeeds, queue is cleared
  const sent = [];
  const successFlush = await flushOfflineJobs(
    async ({ jobs }) => {
      sent.push(...jobs);
      return { ok: true };
    },
    {
      storageImpl: mockStorage,
      getConfig: async () => ({ serverUrl: 'http://localhost:8080', apiKey: 'test' }),
    }
  );

  assert.equal(successFlush.flushed, 2);
  assert.equal(successFlush.remaining, 0);
  assert.equal(sent.length, 2);

  const finalQueue = await getOfflineQueue({ storageImpl: mockStorage });
  assert.equal(finalQueue.length, 0);
});
