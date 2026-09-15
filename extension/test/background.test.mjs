import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import background, {
  SCAN_ALARM_NAME,
  processDiscoveredJobs,
} from '../src/entrypoints/background.ts';

test('SCAN_ALARM_NAME is defined', () => {
  assert.equal(SCAN_ALARM_NAME, 'jobfoundry-periodic-scan');
});

test('processDiscoveredJobs handles empty array cleanly', async () => {
  const result = await processDiscoveredJobs({ rawJobs: [] });
  assert.deepEqual(result, { ok: true, ingested: 0 });
});

test('processDiscoveredJobs validates required jobs array', async () => {
  const result = await processDiscoveredJobs({ rawJobs: null });
  assert.deepEqual(result, { ok: true, ingested: 0 });
});

test('background URL routing ignores hostname text in credentials, paths, and queries', async () => {
  let rootMessageListener;
  let mode = 'auto-connect';
  let captureResult;
  const executedTabIds = [];
  const activeTab = { id: 10, url: 'https://news.example.com/', title: 'News' };
  const allTabs = [
    { id: 1, url: 'https://jobfoundry@evil.example/', title: 'Sign in' },
    { id: 2, url: 'https://evil.example/?next=https://covai.org', title: 'Redirect' },
    { id: 3, url: 'https://app.covai.org/dashboard', title: 'Dashboard' },
    activeTab,
  ];

  const storageArea = {
    async get() {
      return {};
    },
    async set() {},
  };
  const browser = {
    storage: {
      sync: storageArea,
      onChanged: { addListener() {} },
    },
    alarms: {
      async create() {},
      onAlarm: { addListener() {} },
    },
    commands: { onCommand: { addListener() {} } },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          rootMessageListener = listener;
        },
        removeListener() {},
      },
    },
    tabs: {
      async query(query) {
        return query.active ? [activeTab] : allTabs;
      },
    },
    scripting: {
      async executeScript({ target, func }) {
        executedTabIds.push(target.tabId);
        if (mode === 'auto-connect') {
          return [
            {
              result: {
                ok: false,
                code: 'NOT_JOBFOUNDRY',
                error: 'Tab is not a JobFoundry dashboard.',
              },
            },
          ];
        }

        const dom = new JSDOM(
          `<script type="application/ld+json">${JSON.stringify({
            '@type': 'JobPosting',
            title: 'Security Engineer',
            description: '<p>Build secure distributed systems for a global platform.</p>',
            hiringOrganization: { name: 'Example' },
          })}</script>`,
          { url: 'https://linkedin.com.evil.example/jobs/1' }
        );
        const hadWindow = 'window' in globalThis;
        const hadDocument = 'document' in globalThis;
        const previousWindow = globalThis.window;
        const previousDocument = globalThis.document;
        globalThis.window = dom.window;
        globalThis.document = dom.window.document;
        try {
          captureResult = func();
          return [{ result: captureResult }];
        } finally {
          if (hadWindow) globalThis.window = previousWindow;
          else delete globalThis.window;
          if (hadDocument) globalThis.document = previousDocument;
          else delete globalThis.document;
          dom.window.close();
        }
      },
    },
  };

  const hadBrowser = 'browser' in globalThis;
  const hadChrome = 'chrome' in globalThis;
  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;
  const previousSetTimeout = globalThis.setTimeout;
  globalThis.browser = browser;
  globalThis.chrome = browser;
  globalThis.setTimeout = () => 0;

  const dispatch = (type) =>
    new Promise((resolve, reject) => {
      const handled = rootMessageListener(
        { id: 1, type, data: undefined, timestamp: Date.now() },
        {},
        resolve
      );
      if (!handled) reject(new Error(`Message ${type} was not handled asynchronously`));
    });

  try {
    background.main();
    assert.equal(typeof rootMessageListener, 'function');

    const autoConnectResponse = await dispatch('popup:autoConnect');
    assert.equal(autoConnectResponse.res.ok, false);
    assert.deepEqual(executedTabIds, [3, 10]);

    mode = 'capture';
    executedTabIds.length = 0;
    const captureResponse = await dispatch('popup:captureActiveTab');
    assert.equal(captureResponse.res.ok, false);
    assert.match(captureResponse.res.error, /not configured/);
    assert.equal(captureResult[0].source, 'web');
    assert.equal(captureResult[0].url, 'https://linkedin.com.evil.example/jobs/1');
  } finally {
    if (hadBrowser) globalThis.browser = previousBrowser;
    else delete globalThis.browser;
    if (hadChrome) globalThis.chrome = previousChrome;
    else delete globalThis.chrome;
    globalThis.setTimeout = previousSetTimeout;
  }
});
