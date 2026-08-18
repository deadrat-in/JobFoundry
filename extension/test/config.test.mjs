import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserMock, withBrowser } from './helpers/browser-mock.mjs';

const DEFAULTS = {
  serverUrl: null,
  apiKey: null,
  scanIntervalHours: 6,
  passiveMode: true,
  activeMode: false,
  activeModeDelayMs: 2000,
  fitThreshold: 75,
  portals: {},
};

async function freshConfig() {
  return await import(`../src/shared/config.js?t=${Date.now()}`);
}

test('defaults match the implementation plan table exactly', async () => {
  const mod = await freshConfig();
  assert.deepEqual(mod.defaults, DEFAULTS);
});

test('getConfig returns defaults when nothing is stored', async () => {
  const { browser } = createBrowserMock();
  const mod = await freshConfig();
  const cfg = await withBrowser(browser, () => mod.getConfig());
  assert.deepEqual(cfg, DEFAULTS);
});

test('getConfig merges stored values over defaults', async () => {
  const { browser } = createBrowserMock({ scanIntervalHours: 12, fitThreshold: 90 });
  const mod = await freshConfig();
  const cfg = await withBrowser(browser, () => mod.getConfig());
  assert.equal(cfg.scanIntervalHours, 12);
  assert.equal(cfg.fitThreshold, 90);
  assert.equal(cfg.serverUrl, null);
  assert.equal(cfg.passiveMode, true);
});

test('setConfig persists only the provided keys', async () => {
  const { browser, snapshot } = createBrowserMock();
  const mod = await freshConfig();
  await withBrowser(browser, () => mod.setConfig({ serverUrl: 'http://localhost:8080' }));
  assert.deepEqual(snapshot().store, { serverUrl: 'http://localhost:8080' });
});

test('setConfig supports storing portals and booleans', async () => {
  const { browser, snapshot } = createBrowserMock();
  const mod = await freshConfig();
  await withBrowser(browser, () =>
    mod.setConfig({ passiveMode: false, portals: { linkedin: true } })
  );
  assert.deepEqual(snapshot().store, {
    passiveMode: false,
    portals: { linkedin: true },
  });
});

test('setConfig rejects a non-numeric scanIntervalHours', async () => {
  const { browser } = createBrowserMock();
  const mod = await freshConfig();
  await assert.rejects(
    () => withBrowser(browser, () => mod.setConfig({ scanIntervalHours: 'six' })),
    /scanIntervalHours/
  );
});

test('setConfig rejects scanIntervalHours below 1', async () => {
  const { browser } = createBrowserMock();
  const mod = await freshConfig();
  await assert.rejects(
    () => withBrowser(browser, () => mod.setConfig({ scanIntervalHours: 0 })),
    /scanIntervalHours/
  );
});

test('setConfig rejects fitThreshold out of 0-100 range', async () => {
  const { browser } = createBrowserMock();
  const mod = await freshConfig();
  await assert.rejects(
    () => withBrowser(browser, () => mod.setConfig({ fitThreshold: -1 })),
    /fitThreshold/
  );
  await assert.rejects(
    () => withBrowser(browser, () => mod.setConfig({ fitThreshold: 101 })),
    /fitThreshold/
  );
});

test('falls back to the chrome global when browser is unavailable', async () => {
  const chrome = {
    storage: {
      sync: {
        async get() {
          return { scanIntervalHours: 3 };
        },
      },
    },
  };
  const hadChrome = 'chrome' in globalThis;
  const prevChrome = globalThis.chrome;
  globalThis.chrome = chrome;
  try {
    const mod = await freshConfig();
    const cfg = await mod.getConfig();
    assert.equal(cfg.scanIntervalHours, 3);
    assert.equal(cfg.fitThreshold, 75);
  } finally {
    if (hadChrome) globalThis.chrome = prevChrome;
    else delete globalThis.chrome;
  }
});
