import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { hydrate, scanNow } from '../src/entrypoints/popup/main.ts';

const EXT = resolve(import.meta.dirname, '..');
const HTML = readFileSync(resolve(EXT, 'src/entrypoints/sidepanel/index.html'), 'utf8');

function setupDom() {
  const dom = new JSDOM(HTML, { url: 'https://jobfoundry.invalid/' });
  const doc = dom.window.document;
  return { doc };
}

test('sidepanel exposes all required controls matching popup', () => {
  const { doc } = setupDom();
  for (const selector of [
    '#popup-conn-badge',
    '#capture-tab',
    '#scan-now',
    '#passive-mode',
    '#active-mode',
    '#status',
    '#open-options',
    '#open-dashboard',
  ]) {
    assert.ok(doc.querySelector(selector), `missing control in sidepanel: ${selector}`);
  }
});

test('sidepanel values hydrate from getConfig on load', async () => {
  const { doc } = setupDom();
  const mockGetConfig = async () => ({
    serverUrl: 'http://localhost:8080',
    apiKey: 'topsecret',
    scanIntervalHours: 12,
    passiveMode: true,
    activeMode: false,
    fitThreshold: 80,
    activeModeDelayMs: 2000,
    portals: {},
  });

  await hydrate({ doc, getConfig: mockGetConfig });
  assert.equal(doc.querySelector('#popup-conn-badge').textContent.includes('Connected'), true);
  assert.equal(doc.querySelector('#passive-mode').checked, true);
  assert.equal(doc.querySelector('#active-mode').checked, false);
});
