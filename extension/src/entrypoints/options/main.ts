import { getConfig, setConfig, syncConfigFromServer, DEFAULT_CONFIG } from '../../shared/config.ts';
import type { Config } from '../../shared/config.ts';
import { sendMessage } from '../../shared/messaging.ts';

function $(selector: string): any {
  return document.querySelector(selector);
}

function $$(selector: string): any[] {
  return Array.from(document.querySelectorAll(selector));
}

let currentConfig: Config = { ...DEFAULT_CONFIG };

function getWebSettingsUrl(serverUrl?: string | null): string {
  const base = (serverUrl || 'http://localhost:8080').replace(/\/+$/, '');
  return `${base}/settings?tab=scrapers`;
}

function openWebSettings(url: string) {
  const api = (globalThis as any).browser ?? (globalThis as any).chrome;
  if (api?.tabs?.create) {
    api.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}

async function hydrate() {
  currentConfig = await getConfig();

  const serverUrl = currentConfig.serverUrl || 'http://localhost:8080';
  const targetUrl = getWebSettingsUrl(serverUrl);

  const urlLink = $('#web-settings-url');
  if (urlLink) {
    urlLink.textContent = targetUrl;
    urlLink.href = targetUrl;
  }

  const displayServerUrl = $('#display-server-url');
  if (displayServerUrl) {
    displayServerUrl.textContent = currentConfig.serverUrl || 'Not configured';
  }

  const displayUserEmail = $('#display-user-email');
  if (displayUserEmail) {
    displayUserEmail.textContent = currentConfig.userEmail || '—';
  }

  const displayScrapers = $('#display-scrapers-count');
  if (displayScrapers) {
    const activePortals = Object.values(currentConfig.portals || {}).filter(Boolean).length;
    const trackedCo = (currentConfig.trackedCompanies || []).filter(
      (c) => c.enabled !== false
    ).length;
    displayScrapers.textContent = `${activePortals + trackedCo} feeds active`;
  }

  // Populate manual settings form
  if ($('#server-url')) $('#server-url').value = currentConfig.serverUrl || '';
  if ($('#api-key')) $('#api-key').value = currentConfig.apiKey || '';
  if ($('#scan-interval')) $('#scan-interval').value = String(currentConfig.scanIntervalHours || 6);
  if ($('#fit-threshold')) $('#fit-threshold').value = String(currentConfig.fitThreshold || 75);
  if ($('#passive-mode')) $('#passive-mode').checked = Boolean(currentConfig.passiveMode);
  if ($('#active-mode')) $('#active-mode').checked = Boolean(currentConfig.activeMode);

  updateConnectionBadge();
}

let connBadgeRun = 0;

async function updateConnectionBadge() {
  const badge = $('#conn-badge');
  if (!badge) return;
  const run = ++connBadgeRun;

  if (!currentConfig.serverUrl || !currentConfig.apiKey) {
    badge.className = 'badge badge-disconnected';
    badge.textContent = '🔴 Disconnected (Needs Server & Key)';
    return;
  }

  badge.className = 'badge badge-disconnected';
  badge.textContent = `🟡 Verifying (${currentConfig.serverUrl})...`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 4000) : null;
  try {
    const res = await fetch(`${currentConfig.serverUrl.replace(/\/+$/, '')}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${currentConfig.apiKey}`,
        Accept: 'application/json',
      },
      signal: controller?.signal,
    });

    if (run !== connBadgeRun) return;

    if (res.ok) {
      const data = await res.json().catch(() => null);
      badge.className = 'badge badge-connected';
      badge.textContent = '🟢 Connected & Synced';
      if (data?.user?.email) {
        const displayUserEmail = $('#display-user-email');
        if (displayUserEmail) displayUserEmail.textContent = data.user.email;
        if (data.user.email !== currentConfig.userEmail) {
          setConfig({ userEmail: data.user.email }).catch(() => {});
        }
      }
    } else if (res.status === 401 || res.status === 403) {
      badge.className = 'badge badge-disconnected';
      badge.textContent = '🔴 Invalid API Key';
    } else {
      badge.className = 'badge badge-disconnected';
      badge.textContent = `🔴 HTTP ${res.status}`;
    }
  } catch {
    if (run !== connBadgeRun) return;
    badge.className = 'badge badge-disconnected';
    badge.textContent = '🔴 Server Offline';
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function triggerSync() {
  const syncStatus = $('#display-sync-status');
  if (syncStatus) {
    syncStatus.textContent = 'Syncing...';
    syncStatus.style.color = 'var(--accent)';
  }

  if (!currentConfig.serverUrl || !currentConfig.apiKey) {
    if (syncStatus) {
      syncStatus.textContent = 'Cannot sync: not connected';
      syncStatus.style.color = 'var(--red)';
    }
    return;
  }

  try {
    await syncConfigFromServer(currentConfig.serverUrl, currentConfig.apiKey);
    await hydrate();
    if (syncStatus) {
      syncStatus.textContent = `Synced at ${new Date().toLocaleTimeString()}`;
      syncStatus.style.color = 'var(--green)';
    }
  } catch (err: any) {
    if (syncStatus) {
      syncStatus.textContent = `Sync failed: ${err?.message || err}`;
      syncStatus.style.color = 'var(--red)';
    }
  }
}

export function init() {
  hydrate().catch(console.error);

  $('#open-web-settings')?.addEventListener('click', () => {
    const targetUrl = getWebSettingsUrl(currentConfig.serverUrl);
    openWebSettings(targetUrl);
  });

  $('#sync-now-btn')?.addEventListener('click', () => {
    triggerSync().catch(console.error);
  });

  $('#options-auto-connect')?.addEventListener('click', async () => {
    const syncStatus = $('#display-sync-status');
    if (syncStatus) {
      syncStatus.textContent = 'Auto-connecting to open tab...';
      syncStatus.style.color = 'var(--accent)';
    }
    try {
      const response = await sendMessage('popup:autoConnect', undefined);
      if (response?.ok) {
        await hydrate();
        if (syncStatus) {
          syncStatus.textContent = `✅ Connected as ${response.email || 'User'}`;
          syncStatus.style.color = 'var(--green)';
        }
      } else {
        if (syncStatus) {
          syncStatus.textContent = response?.error || 'Auto-connect failed';
          syncStatus.style.color = 'var(--red)';
        }
      }
    } catch (err: any) {
      if (syncStatus) {
        syncStatus.textContent = `Auto-connect error: ${err?.message || err}`;
        syncStatus.style.color = 'var(--red)';
      }
    }
  });

  $('#manual-config-form')?.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    const saveStatus = $('#save-status');
    try {
      const patch: Partial<Config> = {
        serverUrl: $('#server-url')?.value.trim() || null,
        apiKey: $('#api-key')?.value.trim() || null,
        scanIntervalHours: parseInt($('#scan-interval')?.value, 10) || 6,
        fitThreshold: parseInt($('#fit-threshold')?.value, 10) || 75,
        passiveMode: Boolean($('#passive-mode')?.checked),
        activeMode: Boolean($('#active-mode')?.checked),
      };

      await setConfig(patch);
      if (saveStatus) {
        saveStatus.textContent = 'Settings saved!';
        saveStatus.style.color = 'var(--green)';
      }
      await hydrate();
      if (patch.serverUrl && patch.apiKey) {
        await triggerSync();
      }
    } catch (err: any) {
      if (saveStatus) {
        saveStatus.textContent = `Save error: ${err?.message || err}`;
        saveStatus.style.color = 'var(--red)';
      }
    }
  });
}

const inNode = typeof process !== 'undefined' && process.versions?.node;
if (typeof document !== 'undefined' && !inNode) {
  document.addEventListener('DOMContentLoaded', () => init());
}
