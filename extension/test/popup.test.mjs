import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { hydrate, scanNow, verifyConnection } from '../src/entrypoints/popup/main.ts';

const EXT = resolve(import.meta.dirname, '..');
const HTML = readFileSync(resolve(EXT, 'src/entrypoints/popup/index.html'), 'utf8');

function setupDom() {
  const dom = new JSDOM(HTML, { url: 'https://jobfoundry.invalid/' });
  const doc = dom.window.document;
  return { doc };
}

test('popup exposes all required controls', () => {
  const { doc } = setupDom();
  for (const selector of [
    '#popup-conn-badge',
    '#capture-tab',
    '#scan-now',
    '#passive-mode',
    '#active-mode',
    '#status',
    '#open-options',
    '#open-sidebar',
    '#open-dashboard',
  ]) {
    assert.ok(doc.querySelector(selector), `missing control: ${selector}`);
  }
});

test('values hydrate from getConfig on load', async () => {
  const { doc } = setupDom();
  const mockGetConfig = async () => ({
    serverUrl: 'http://localhost:8080',
    apiKey: 'topsecret',
    scanIntervalHours: 12,
    passiveMode: false,
    activeMode: true,
    fitThreshold: 80,
    activeModeDelayMs: 2000,
    portals: {},
  });

  await hydrate({ doc, getConfig: mockGetConfig });
  assert.equal(doc.querySelector('#popup-conn-badge').textContent.includes('Connected'), true);
  assert.equal(doc.querySelector('#passive-mode').checked, false);
  assert.equal(doc.querySelector('#active-mode').checked, true);
});

test('scan-now triggers scan and renders the returned status', async () => {
  const { doc } = setupDom();
  let sentType = null;
  const mockSendMessage = async (type) => {
    sentType = type;
    return { ok: true, scanned: 3 };
  };

  const res = await scanNow({ doc, sendMessage: mockSendMessage });
  assert.equal(sentType, 'popup:scanNow');
  assert.equal(res.ok, true);
  assert.match(doc.querySelector('#status').textContent, /Scan complete: 3 job/i);
});

test('scan-now renders an error status when the scan fails', async () => {
  const { doc } = setupDom();
  const mockSendMessage = async () => ({ ok: false, error: 'network error' });

  const res = await scanNow({ doc, sendMessage: mockSendMessage });
  assert.equal(res.ok, false);
  assert.match(doc.querySelector('#status').textContent, /Scan failed: network error/);
});

test('verifyConnection sets Connected and updates userEmail on 200 OK', async () => {
  const { doc } = setupDom();
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ user: { email: 'alice@example.com' } }),
  });

  const res = await verifyConnection({
    doc,
    config: { serverUrl: 'http://localhost:8080', apiKey: 'secret' },
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(doc.querySelector('#popup-conn-badge').textContent, '🟢 Connected');
  assert.equal(doc.querySelector('#user-email').textContent, 'alice@example.com');
});

test('verifyConnection sets Invalid API Key on 401', async () => {
  const { doc } = setupDom();
  const mockFetch = async () => ({
    ok: false,
    status: 401,
  });

  const res = await verifyConnection({
    doc,
    config: { serverUrl: 'http://localhost:8080', apiKey: 'badkey' },
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, false);
  assert.equal(doc.querySelector('#popup-conn-badge').textContent, '🔴 Invalid API Key');
});

test('verifyConnection sets Server Offline on fetch rejection', async () => {
  const { doc } = setupDom();
  const mockFetch = async () => {
    throw new Error('Failed to fetch');
  };

  const res = await verifyConnection({
    doc,
    config: { serverUrl: 'http://localhost:8080', apiKey: 'secret' },
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, false);
  assert.equal(doc.querySelector('#popup-conn-badge').textContent, '🔴 Server Offline');
});
