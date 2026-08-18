import { getConfig, setConfig } from '../shared/config.js';

const DOM = {
  serverUrl: '#server-url',
  apiKey: '#api-key',
  scanInterval: '#scan-interval',
  passiveMode: '#passive-mode',
  activeMode: '#active-mode',
  fitThreshold: '#fit-threshold',
  save: '#save',
  scanNow: '#scan-now',
  status: '#status',
};

function $(doc, selector) {
  return doc.querySelector(selector);
}

export async function hydrate({ doc = document, getConfig: gc = getConfig } = {}) {
  const config = await gc();
  $(doc, DOM.serverUrl).value = config.serverUrl ?? '';
  $(doc, DOM.apiKey).value = config.apiKey ?? '';
  $(doc, DOM.scanInterval).value = config.scanIntervalHours;
  $(doc, DOM.fitThreshold).value = config.fitThreshold;
  $(doc, DOM.passiveMode).checked = Boolean(config.passiveMode);
  $(doc, DOM.activeMode).checked = Boolean(config.activeMode);
  return config;
}

export function collectForm({ doc = document } = {}) {
  return {
    serverUrl: $(doc, DOM.serverUrl).value.trim() || null,
    apiKey: $(doc, DOM.apiKey).value.trim() || null,
    scanIntervalHours: Number($(doc, DOM.scanInterval).value),
    passiveMode: $(doc, DOM.passiveMode).checked,
    activeMode: $(doc, DOM.activeMode).checked,
    fitThreshold: Number($(doc, DOM.fitThreshold).value),
  };
}

export async function save({ doc = document, setConfig: sc = setConfig } = {}) {
  const status = $(doc, DOM.status);
  try {
    await sc(collectForm({ doc }));
    status.textContent = 'Saved';
    return true;
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    return false;
  }
}

export async function scanNow({ browser, doc = document, sendMessage } = {}) {
  const status = $(doc, DOM.status);
  const api = browser ?? globalThis.browser ?? globalThis.chrome;
  const send = sendMessage ?? api?.runtime?.sendMessage?.bind(api.runtime);
  if (!send) {
    status.textContent = 'Error: messaging API unavailable';
    return null;
  }
  const response = await send({ type: 'popup:scanNow' });
  if (response?.ok) {
    status.textContent = `Scan complete: ${response.scanned} job(s) found`;
  } else if (response && !response.ok) {
    status.textContent = `Scan failed: ${response.error ?? 'unknown error'}`;
  } else {
    status.textContent = 'Scan triggered';
  }
  return response;
}

export function init(opts = {}) {
  const { doc = document } = opts;
  const hydrated = hydrate(opts).catch((err) => {
    const status = $(doc, DOM.status);
    if (status) status.textContent = `Error loading config: ${err.message}`;
  });
  $(doc, 'form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    save(opts).catch(() => {});
  });
  $(doc, DOM.scanNow)?.addEventListener('click', () => {
    scanNow(opts).catch(() => {});
  });
  return hydrated;
}

const inNode = typeof process !== 'undefined' && process.versions?.node;
if (typeof document !== 'undefined' && !inNode) {
  document.addEventListener('DOMContentLoaded', () => init());
}
