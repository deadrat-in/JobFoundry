import { getConfig, setConfig } from '../../shared/config.ts';
import type { Config } from '../../shared/config.ts';
import { sendMessage } from '../../shared/messaging.ts';

export const DOM = {
  connBadge: '#popup-conn-badge',
  unpairedBox: '#unpaired-box',
  pairedBox: '#paired-box',
  userEmail: '#user-email',
  scrapersCount: '#active-scrapers-count',
  autoConnect: '#auto-connect',
  captureTab: '#capture-tab',
  scanNow: '#scan-now',
  passiveMode: '#passive-mode',
  activeMode: '#active-mode',
  status: '#status',
  openOptions: '#open-options',
  openDashboard: '#open-dashboard',
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

  const isConnected = Boolean(config.serverUrl && config.apiKey);
  const connBadge = $<HTMLElement>(doc, DOM.connBadge);
  const unpairedBox = $<HTMLElement>(doc, DOM.unpairedBox);
  const pairedBox = $<HTMLElement>(doc, DOM.pairedBox);
  const scrapersCount = $<HTMLElement>(doc, DOM.scrapersCount);
  const passiveMode = $<HTMLInputElement>(doc, DOM.passiveMode);
  const activeMode = $<HTMLInputElement>(doc, DOM.activeMode);

  if (connBadge) {
    if (isConnected) {
      connBadge.className = 'badge badge-connected';
      connBadge.textContent = '🟢 Connected';
    } else {
      connBadge.className = 'badge badge-disconnected';
      connBadge.textContent = '🔴 Disconnected';
    }
  }

  if (unpairedBox) unpairedBox.style.display = isConnected ? 'none' : 'flex';
  if (pairedBox) pairedBox.style.display = isConnected ? 'block' : 'none';

  if (scrapersCount) {
    const activePortals = Object.values(config.portals || {}).filter(Boolean).length;
    const trackedCo = (config.trackedCompanies || []).filter((c) => c.enabled !== false).length;
    scrapersCount.textContent = `${activePortals + trackedCo} scrapers active`;
  }

  if (passiveMode) passiveMode.checked = Boolean(config.passiveMode);
  if (activeMode) activeMode.checked = Boolean(config.activeMode);

  return config;
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
      const userLabel = response.email || 'Logged In User';
      const userEmailEl = $<HTMLElement>(doc, DOM.userEmail);
      if (userEmailEl) userEmailEl.textContent = userLabel;
      if (status) {
        status.textContent = `✅ Connected as ${userLabel}!`;
        status.style.color = '#10b981';
      }
      await hydrate({ doc });
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
        status.textContent = `✓ Ingested: ${label}!`;
        status.style.color = '#10b981';
      }
    } else {
      if (status) {
        status.textContent = `Capture failed: ${response?.error ?? 'No job detected'}`;
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
    status.textContent = 'Scanning portals & filtering...';
    status.style.color = '';
  }
  try {
    const response = await send('popup:scanNow', undefined);
    if (response?.ok) {
      if (status) {
        status.textContent = `✓ Scan complete: ${response.scanned ?? 0} job(s) matched keywords and queued`;
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

  $<HTMLButtonElement>(doc, DOM.captureTab)?.addEventListener('click', () => {
    captureCurrentTab(opts).catch(() => {});
  });

  $<HTMLButtonElement>(doc, DOM.scanNow)?.addEventListener('click', () => {
    scanNow(opts).catch(() => {});
  });

  $<HTMLInputElement>(doc, DOM.passiveMode)?.addEventListener('change', (e: any) => {
    setConfig({ passiveMode: e.target.checked }).catch(() => {});
  });

  $<HTMLInputElement>(doc, DOM.activeMode)?.addEventListener('change', (e: any) => {
    setConfig({ activeMode: e.target.checked }).catch(() => {});
  });

  $<HTMLButtonElement>(doc, DOM.openOptions)?.addEventListener('click', () => {
    const api = (globalThis as any).browser ?? (globalThis as any).chrome;
    if (api?.runtime?.openOptionsPage) {
      api.runtime.openOptionsPage();
    } else {
      window.open('options.html');
    }
  });

  $<HTMLButtonElement>(doc, DOM.openDashboard)?.addEventListener('click', async () => {
    const config = await getConfig();
    const url = config.serverUrl ? 'http://localhost:5173' : 'http://localhost:5173';
    const api = (globalThis as any).browser ?? (globalThis as any).chrome;
    if (api?.tabs?.create) {
      api.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  });

  return hydrated;
}

const inNode = typeof process !== 'undefined' && process.versions?.node;
if (typeof document !== 'undefined' && !inNode) {
  document.addEventListener('DOMContentLoaded', () => init());
}
