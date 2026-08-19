import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { hydrate, save, scanNow } from '../src/entrypoints/popup/main.ts';

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
    '#server-url',
    '#api-key',
    '#scan-interval',
    '#passive-mode',
    '#active-mode',
    '#fit-threshold',
    '#scan-now',
    '#status',
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
  assert.equal(doc.querySelector('#server-url').value, 'http://localhost:8080');
  assert.equal(doc.querySelector('#api-key').value, 'topsecret');
  assert.equal(doc.querySelector('#scan-interval').value, '12');
  assert.equal(doc.querySelector('#passive-mode').checked, false);
  assert.equal(doc.querySelector('#active-mode').checked, true);
  assert.equal(doc.querySelector('#fit-threshold').value, '80');
});

test('saving writes via setConfig', async () => {
  const { doc } = setupDom();
  let savedConfig = null;
  const mockSetConfig = async (patch) => {
    savedConfig = patch;
    return patch;
  };

  doc.querySelector('#server-url').value = 'http://new.example:9000';
  doc.querySelector('#scan-interval').value = '24';
  doc.querySelector('#fit-threshold').value = '90';
  doc.querySelector('#passive-mode').checked = false;

  const result = await save({ doc, setConfig: mockSetConfig });
  assert.equal(result, true);
  assert.equal(savedConfig.serverUrl, 'http://new.example:9000');
  assert.equal(savedConfig.scanIntervalHours, 24);
  assert.equal(savedConfig.fitThreshold, 90);
  assert.equal(savedConfig.passiveMode, false);
  assert.match(doc.querySelector('#status').textContent, /Saved/i);
});

test('invalid fitThreshold shows an error and returns false', async () => {
  const { doc } = setupDom();
  const mockSetConfig = async () => {
    throw new Error('fitThreshold must be a number between 0 and 100');
  };

  doc.querySelector('#fit-threshold').value = '150';
  const result = await save({ doc, setConfig: mockSetConfig });
  assert.equal(result, false);
  assert.match(doc.querySelector('#status').textContent, /Error/i);
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
  assert.match(doc.querySelector('#status').textContent, /Scan complete: 3 job/);
});

test('scan-now renders an error status when the scan fails', async () => {
  const { doc } = setupDom();
  const mockSendMessage = async () => ({ ok: false, error: 'network error' });

  const res = await scanNow({ doc, sendMessage: mockSendMessage });
  assert.equal(res.ok, false);
  assert.match(doc.querySelector('#status').textContent, /Scan failed: network error/);
});
