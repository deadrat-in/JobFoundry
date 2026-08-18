import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { createBrowserMock } from './helpers/browser-mock.mjs';

const EXT = resolve(import.meta.dirname, '..');
const HTML = readFileSync(resolve(EXT, 'src/popup/index.html'), 'utf8');

async function bundlePopup() {
  const result = await build({
    entryPoints: [resolve(EXT, 'src/popup/index.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const code = result.outputFiles[0].text;
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

function setupDom(initialStore = {}) {
  const dom = new JSDOM(HTML, { url: 'https://jobfoundry.invalid/' });
  const doc = dom.window.document;
  const { browser, snapshot } = createBrowserMock(initialStore);
  const hadDocument = 'document' in globalThis;
  const hadBrowser = 'browser' in globalThis;
  const prevDocument = globalThis.document;
  const prevBrowser = globalThis.browser;
  globalThis.document = doc;
  globalThis.browser = browser;
  return {
    doc,
    browser,
    snapshot,
    restore() {
      if (hadDocument) globalThis.document = prevDocument;
      else delete globalThis.document;
      if (hadBrowser) globalThis.browser = prevBrowser;
      else delete globalThis.browser;
    },
  };
}

const tick = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

test('popup exposes all required controls', async () => {
  const mod = await bundlePopup();
  const ctx = setupDom();
  try {
    await mod.init({ browser: ctx.browser });
    for (const selector of [
      '#server-url',
      '#api-key',
      '#scan-interval',
      '#passive-mode',
      '#active-mode',
      '#fit-threshold',
      '#scan-now',
      '#status',
    ]) {
      assert.ok(ctx.doc.querySelector(selector), `missing control: ${selector}`);
    }
  } finally {
    ctx.restore();
  }
});

test('values hydrate from getConfig on load', async () => {
  const mod = await bundlePopup();
  const ctx = setupDom({
    serverUrl: 'http://localhost:8080',
    apiKey: 'topsecret',
    scanIntervalHours: 12,
    passiveMode: false,
    activeMode: true,
    fitThreshold: 80,
  });
  try {
    await mod.init({ browser: ctx.browser });
    assert.equal(ctx.doc.querySelector('#server-url').value, 'http://localhost:8080');
    assert.equal(ctx.doc.querySelector('#api-key').value, 'topsecret');
    assert.equal(ctx.doc.querySelector('#scan-interval').value, '12');
    assert.equal(ctx.doc.querySelector('#passive-mode').checked, false);
    assert.equal(ctx.doc.querySelector('#active-mode').checked, true);
    assert.equal(ctx.doc.querySelector('#fit-threshold').value, '80');
  } finally {
    ctx.restore();
  }
});

test('saving writes via setConfig', async () => {
  const mod = await bundlePopup();
  const ctx = setupDom({
    serverUrl: 'http://localhost:8080',
    scanIntervalHours: 6,
    fitThreshold: 75,
  });
  try {
    await mod.init({ browser: ctx.browser });
    ctx.doc.querySelector('#server-url').value = 'http://new.example:9000';
    ctx.doc.querySelector('#scan-interval').value = '24';
    ctx.doc.querySelector('#fit-threshold').value = '90';
    ctx.doc.querySelector('#passive-mode').checked = false;
    ctx.doc.querySelector('#save').click();
    await tick();
    const store = ctx.snapshot().store;
    assert.equal(store.serverUrl, 'http://new.example:9000');
    assert.equal(store.scanIntervalHours, 24);
    assert.equal(store.fitThreshold, 90);
    assert.equal(store.passiveMode, false);
    assert.match(ctx.doc.querySelector('#status').textContent, /Saved/i);
  } finally {
    ctx.restore();
  }
});

test('invalid fitThreshold shows an error and does not persist', async () => {
  const mod = await bundlePopup();
  const ctx = setupDom({ fitThreshold: 75 });
  try {
    await mod.init({ browser: ctx.browser });
    ctx.doc.querySelector('#fit-threshold').value = '150';
    const saved = await mod.save({ doc: ctx.doc });
    assert.equal(saved, false);
    assert.match(ctx.doc.querySelector('#status').textContent, /Error/i);
    assert.equal(ctx.snapshot().store.fitThreshold, 75);
  } finally {
    ctx.restore();
  }
});

test('scan-now posts popup:scanNow and renders the returned status', async () => {
  const mod = await bundlePopup();
  const ctx = setupDom();
  try {
    let sent;
    const sendMessage = async (message) => {
      sent = message;
      return { ok: true, scanned: 3 };
    };
    await mod.init({ browser: ctx.browser, sendMessage });
    ctx.doc.querySelector('#scan-now').click();
    await tick();
    assert.deepEqual(sent, { type: 'popup:scanNow' });
    assert.match(ctx.doc.querySelector('#status').textContent, /Scan complete: 3 job/);
  } finally {
    ctx.restore();
  }
});

test('scan-now renders an error status when the scan fails', async () => {
  const mod = await bundlePopup();
  const ctx = setupDom();
  try {
    const sendMessage = async () => ({ ok: false, error: 'boom' });
    await mod.init({ browser: ctx.browser, sendMessage });
    ctx.doc.querySelector('#scan-now').click();
    await tick();
    assert.match(ctx.doc.querySelector('#status').textContent, /Scan failed: boom/);
  } finally {
    ctx.restore();
  }
});
