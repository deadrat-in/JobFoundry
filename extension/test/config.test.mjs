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
