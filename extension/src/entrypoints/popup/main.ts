import { getConfig, setConfig } from '../../shared/config.ts';
import type { Config } from '../../shared/config.ts';
import { sendMessage } from '../../shared/messaging.ts';

export const DOM = {
  autoConnect: '#auto-connect',
  serverUrl: '#server-url',
  apiKey: '#api-key',
  scanInterval: '#scan-interval',
  passiveMode: '#passive-mode',
  activeMode: '#active-mode',
  fitThreshold: '#fit-threshold',
  save: '#save',
  scanNow: '#scan-now',
  captureTab: '#capture-tab',
  status: '#status',
};

function $<T extends HTMLElement>(doc: Document, selector: string): T {
  return doc.querySelector(selector) as T;
}

export async function hydrate({
  doc = document,
  getConfig: gc = getConfig,
}: {
  doc?: Document;
  getConfig?: () => Promise<Config>;
} = {}) {
  const config = await gc();
  $<HTMLInputElement>(doc, DOM.serverUrl).value = config.serverUrl ?? '';
  $<HTMLInputElement>(doc, DOM.apiKey).value = config.apiKey ?? '';
  $<HTMLInputElement>(doc, DOM.scanInterval).value = String(config.scanIntervalHours);
  $<HTMLInputElement>(doc, DOM.fitThreshold).value = String(config.fitThreshold);
  $<HTMLInputElement>(doc, DOM.passiveMode).checked = Boolean(config.passiveMode);
  $<HTMLInputElement>(doc, DOM.activeMode).checked = Boolean(config.activeMode);
  return config;
}

export function collectForm({ doc = document }: { doc?: Document } = {}): Partial<Config> {
  return {
    serverUrl: $<HTMLInputElement>(doc, DOM.serverUrl).value.trim() || null,
    apiKey: $<HTMLInputElement>(doc, DOM.apiKey).value.trim() || null,
    scanIntervalHours: Number($<HTMLInputElement>(doc, DOM.scanInterval).value),
    passiveMode: $<HTMLInputElement>(doc, DOM.passiveMode).checked,
    activeMode: $<HTMLInputElement>(doc, DOM.activeMode).checked,
    fitThreshold: Number($<HTMLInputElement>(doc, DOM.fitThreshold).value),
  };
}

export async function autoConnect({
  doc = document,
  sendMessage: send = sendMessage,
}: {
  doc?: Document;
  sendMessage?: (type: 'popup:autoConnect', payload?: any) => Promise<any>;
} = {}) {
  const status = $<HTMLElement>(doc, DOM.status);
  if (status) {
    status.textContent = 'Verifying JobFoundry dashboard tab...';
    status.style.color = '';
  }
  try {
    const response = await send('popup:autoConnect', undefined);
    if (response?.ok) {
      $<HTMLInputElement>(doc, DOM.serverUrl).value = response.serverUrl || '';
      $<HTMLInputElement>(doc, DOM.apiKey).value = response.apiKey || '';
      const userLabel = response.email ? ` (${response.email})` : '';
      if (status) {
        status.textContent = `✅ Connected${userLabel}!`;
        status.style.color = '#10b981';
      }
    } else {
      if (status) {
        status.textContent = response?.error || 'Auto-connect failed.';
        status.style.color = '#ef4444';
      }
    }
    return response;
  } catch (err: any) {
    if (status) {
      status.textContent = `Auto-connect error: ${err?.message ?? err}`;
      status.style.color = '#ef4444';
    }
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function save({
  doc = document,
  setConfig: sc = setConfig,
}: {
  doc?: Document;
  setConfig?: (patch: Partial<Config>) => Promise<Config>;
} = {}) {
  const status = $<HTMLElement>(doc, DOM.status);
  try {
    await sc(collectForm({ doc }));
    if (status) {
      status.textContent = 'Saved';
      status.style.color = '#10b981';
    }
    return true;
  } catch (err: any) {
    if (status) {
      status.textContent = `Error: ${err.message}`;
      status.style.color = '#ef4444';
    }
    return false;
  }
}

export async function captureCurrentTab({
  doc = document,
  sendMessage: send = sendMessage,
}: {
  doc?: Document;
  sendMessage?: (type: 'popup:captureActiveTab', payload?: any) => Promise<any>;
} = {}) {
  const status = $<HTMLElement>(doc, DOM.status);
  if (status) {
    status.textContent = 'Capturing current page...';
    status.style.color = '';
  }
  try {
    const response = await send('popup:captureActiveTab', undefined);
    if (response?.ok) {
      const job = response.job;
      const label = job?.title ? `"${job.title}" (${job.company || 'Company'})` : `${response.count ?? 1} job(s)`;
      if (status) {
        status.textContent = `Ingested: ${label}!`;
        status.style.color = '#10b981';
      }
    } else {
      if (status) {
        status.textContent = `Capture failed: ${response?.error ?? 'unknown error'}`;
        status.style.color = '#ef4444';
      }
    }
    return response;
  } catch (err: any) {
    if (status) {
      status.textContent = `Capture error: ${err?.message ?? err}`;
      status.style.color = '#ef4444';
    }
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function scanNow({
  doc = document,
  sendMessage: send = sendMessage,
}: {
  doc?: Document;
  sendMessage?: (type: 'popup:scanNow', payload?: any) => Promise<any>;
} = {}) {
  const status = $<HTMLElement>(doc, DOM.status);
  if (status) {
    status.textContent = 'Scanning portals...';
    status.style.color = '';
  }
  try {
    const response = await send('popup:scanNow', undefined);
    if (response?.ok) {
      if (status) {
        status.textContent = `Scan complete: ${response.scanned ?? 0} job(s) found`;
        status.style.color = '#10b981';
      }
    } else if (response && !response.ok) {
      if (status) {
        status.textContent = `Scan failed: ${response.error ?? 'unknown error'}`;
        status.style.color = '#ef4444';
      }
    } else {
      if (status) status.textContent = 'Scan triggered';
    }
    return response;
  } catch (err: any) {
    if (status) {
      status.textContent = `Scan error: ${err?.message ?? err}`;
      status.style.color = '#ef4444';
    }
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export function init(opts: { doc?: Document; [key: string]: any } = {}) {
  const { doc = document } = opts;
  const hydrated = hydrate(opts).catch((err) => {
    const status = $<HTMLElement>(doc, DOM.status);
    if (status) status.textContent = `Error loading config: ${err.message}`;
  });
  $<HTMLButtonElement>(doc, DOM.autoConnect)?.addEventListener('click', () => {
    autoConnect(opts).catch(() => {});
  });
  $<HTMLFormElement>(doc, 'form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    save(opts).catch(() => {});
  });
  $<HTMLButtonElement>(doc, DOM.captureTab)?.addEventListener('click', () => {
    captureCurrentTab(opts).catch(() => {});
  });
  $<HTMLButtonElement>(doc, DOM.scanNow)?.addEventListener('click', () => {
    scanNow(opts).catch(() => {});
  });
  return hydrated;
}

const inNode = typeof process !== 'undefined' && process.versions?.node;
if (typeof document !== 'undefined' && !inNode) {
  document.addEventListener('DOMContentLoaded', () => init());
}
