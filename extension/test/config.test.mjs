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
    portals: {
      remoteok: true,
      weworkremotely: true,
      himalayas: true,
      arbeitnow: true,
      jobspresso: true,
      '4dayweek': true,
    },
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
