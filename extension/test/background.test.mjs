import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserMock } from './helpers/browser-mock.mjs';
import { SCAN_ALARM_NAME } from '../src/background/alarms.js';
import { createBackground } from '../src/background/index.js';

function setup({ getConfig, runScan } = {}) {
  const { browser, snapshot } = createBrowserMock();
  const calls = [];
  const bg = createBackground({
    browser,
    getConfig: getConfig ?? (async () => ({ scanIntervalHours: 6 })),
    runScan:
      runScan ??
      (async () => {
        calls.push('runScan');
        return [];
      }),
  });
  return { browser, snapshot, bg, calls };
}

function listener(snapshot, key) {
  return [...snapshot()[key]][0];
}

test('onInstalled creates a scan alarm with periodInMinutes from config', async () => {
  const { snapshot, bg } = setup();
  await listener(snapshot, 'installedListeners')({ reason: 'install' });
  assert.equal(snapshot().createdAlarms.length, 1);
  assert.equal(snapshot().createdAlarms[0].name, SCAN_ALARM_NAME);
  assert.equal(snapshot().createdAlarms[0].alarmInfo.periodInMinutes, 360);
  bg.dispose();
});

test('an empty job list from onInstalled does not run a scan', async () => {
  const { snapshot, bg, calls } = setup();
  await listener(snapshot, 'installedListeners')({});
  assert.equal(calls.length, 0);
  bg.dispose();
});

test('alarm fire triggers runScan which returns [] (Phase 03 seam)', async () => {
  const { snapshot, bg, calls } = setup();
  await listener(snapshot, 'alarmListeners')({ name: SCAN_ALARM_NAME });
  assert.equal(calls.length, 1);
  bg.dispose();
});

test('unrelated alarms do not trigger a scan', async () => {
  const { snapshot, bg, calls } = setup();
  await listener(snapshot, 'alarmListeners')({ name: 'something-else' });
  assert.equal(calls.length, 0);
  bg.dispose();
});

test('popup:scanNow message triggers runScan and replies with status', async () => {
  const { snapshot, bg, calls } = setup({
    runScan: async () => {
      calls.push('runScan');
      return [{ title: 'x' }, { title: 'y' }];
    },
  });
  const status = await listener(snapshot, 'messageListeners')({ type: 'popup:scanNow' });
  assert.equal(calls.length, 1);
  assert.deepEqual(status, { ok: true, scanned: 2 });
  bg.dispose();
});

test('popup:scanNow replies with error when runScan throws', async () => {
  const { snapshot, bg } = setup({
    runScan: async () => {
      throw new Error('nope');
    },
  });
  const status = await listener(snapshot, 'messageListeners')({ type: 'popup:scanNow' });
  assert.deepEqual(status, { ok: false, error: 'nope' });
  bg.dispose();
});

test('non-scan messages are ignored', async () => {
  const { snapshot, bg, calls } = setup();
  const response = await listener(snapshot, 'messageListeners')({ type: 'other' });
  assert.equal(response, undefined);
  assert.equal(calls.length, 0);
  bg.dispose();
});

test('config change of scanIntervalHours re-registers the alarm', async () => {
  const { snapshot, bg } = setup();
  await listener(snapshot, 'installedListeners')({ reason: 'install' });
  const afterInstall = snapshot();
  assert.equal(afterInstall.createdAlarms.length, 1);
  await listener(snapshot, 'storageChangeListeners')(
    { scanIntervalHours: { oldValue: 6, newValue: 12 } },
    'sync'
  );
  const state = snapshot();
  assert.equal(state.createdAlarms.length, 2);
  assert.equal(state.createdAlarms[1].alarmInfo.periodInMinutes, 720);
  bg.dispose();
});

test('unrelated storage changes do not touch alarms', async () => {
  const { snapshot, bg } = setup();
  await listener(snapshot, 'installedListeners')({ reason: 'install' });
  await listener(snapshot, 'storageChangeListeners')(
    { fitThreshold: { oldValue: 75, newValue: 80 } },
    'sync'
  );
  const state = snapshot();
  assert.equal(state.createdAlarms.length, 1);
  bg.dispose();
});

test('default runScan returns an empty array', async () => {
  const { browser, snapshot } = createBrowserMock();
  const bg = createBackground({
    browser,
    getConfig: async () => ({ scanIntervalHours: 6 }),
  });
  const status = await listener(snapshot, 'messageListeners')({ type: 'popup:scanNow' });
  assert.deepEqual(status, { ok: true, scanned: 0 });
  bg.dispose();
});

test('dispose removes all listeners', async () => {
  const { snapshot, bg } = setup();
  bg.dispose();
  assert.equal(snapshot().installedListeners.size, 0);
  assert.equal(snapshot().alarmListeners.size, 0);
  assert.equal(snapshot().messageListeners.size, 0);
  assert.equal(snapshot().storageChangeListeners.size, 0);
});

test('content:jobsDiscovered ingests valid jobs via sendJobs', async () => {
  const sent = [];
  const { browser, snapshot } = createBrowserMock();
  const bgWithSend = createBackground({
    browser,
    getConfig: async () => ({
      serverUrl: 'http://localhost:3000',
      apiKey: 'test-key',
    }),
    sendJobs: async (payload) => {
      sent.push(payload);
    },
  });

  const messageHandler = listener(snapshot, 'messageListeners');
  const res = await messageHandler({
    type: 'content:jobsDiscovered',
    jobs: [
      {
        title: 'Backend Dev',
        company: 'Acme',
        url: 'https://example.com/job/1',
        description: 'Building microservices in Node and Go with distributed tracing and queues.',
      },
    ],
  });

  assert.equal(res.ok, true);
  assert.equal(res.ingested, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jobs.length, 1);
  assert.equal(sent[0].jobs[0].title, 'Backend Dev');
  assert.equal(sent[0].apiKey, 'test-key');

  bgWithSend.dispose();
});

test('content:jobsDiscovered returns error if server is unconfigured', async () => {
  const { browser, snapshot } = createBrowserMock();
  const bg = createBackground({
    browser,
    getConfig: async () => ({
      serverUrl: '',
      apiKey: '',
    }),
  });

  const messageHandler = listener(snapshot, 'messageListeners');
  const res = await messageHandler({
    type: 'content:jobsDiscovered',
    jobs: [{ title: 'A', url: 'https://example.com/a' }],
  });

  assert.equal(res.ok, false);
  assert.ok(res.error.includes('not configured'));
  bg.dispose();
});
