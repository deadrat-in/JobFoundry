import { getConfig, setConfig, DEFAULT_CONFIG } from '../../shared/config.ts';
import type { Config, TrackedCompany } from '../../shared/config.ts';
import { sendMessage } from '../../shared/messaging.ts';
import { extractKeywordsFromResume } from '../../background/filters/resume-keywords.js';
import { runScanPipeline } from '../../background/scan.js';
import { sendJobs } from '../../shared/ingest-client.js';

function $(selector: string): any {
  return document.querySelector(selector);
}

function $$(selector: string): any[] {
  return Array.from(document.querySelectorAll(selector));
}

let currentConfig: Config = { ...DEFAULT_CONFIG };

// Tab Navigation
function setupTabs() {
  const tabs = $$('.tab-btn');
  const panels = $$('.tab-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      if (targetId) {
        $(`#${targetId}`)?.classList.add('active');
      }
    });
  });
}

function parseCommaList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatCommaList(arr: string[]): string {
  return (arr || []).join(', ');
}

// Hydrate UI from Config
async function hydrate() {
  currentConfig = await getConfig();

  // Tab 1: Filters
  $('#positive-keywords').value = formatCommaList(currentConfig.titleFilter?.positive || []);
  $('#negative-keywords').value = formatCommaList(currentConfig.titleFilter?.negative || []);
  $('#max-posting-age').value = String(currentConfig.maxPostingAgeDays ?? 30);
  $('#location-allow').value = formatCommaList(currentConfig.locationFilter?.allow || []);
  $('#location-block').value = formatCommaList(currentConfig.locationFilter?.block || []);

  // Tab 2: Scrapers
  const portals = currentConfig.portals || {};
  $$('input[data-portal]').forEach((input) => {
    const portalId = input.getAttribute('data-portal');
    if (portalId) {
      input.checked = Boolean(portals[portalId] !== false && portals[portalId] !== undefined);
    }
  });

  renderCompaniesTable();

  // Tab 4: Connection
  $('#server-url').value = currentConfig.serverUrl || '';
  $('#api-key').value = currentConfig.apiKey || '';
  $('#scan-interval').value = String(currentConfig.scanIntervalHours || 6);
  $('#fit-threshold').value = String(currentConfig.fitThreshold || 75);
  $('#passive-mode').checked = Boolean(currentConfig.passiveMode);
  $('#active-mode').checked = Boolean(currentConfig.activeMode);

  updateConnectionBadge();
  loadScanHistory();
}

function updateConnectionBadge() {
  const badge = $('#conn-badge');
  if (!badge) return;

  if (currentConfig.serverUrl && currentConfig.apiKey) {
    badge.className = 'badge badge-connected';
    badge.textContent = `🟢 Connected (${currentConfig.serverUrl})`;
  } else {
    badge.className = 'badge badge-disconnected';
    badge.textContent = '🔴 Disconnected (Needs Server & Key)';
  }
}

function renderCompaniesTable() {
  const list = $('#companies-list');
  const empty = $('#no-companies');
  const companies: TrackedCompany[] = currentConfig.trackedCompanies || [];

  if (!list || !empty) return;

  list.textContent = '';
  if (companies.length === 0) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  companies.forEach((co, idx) => {
    const tr = document.createElement('tr');

    const tdCheck = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = co.enabled !== false;
    checkbox.setAttribute('data-co-idx', String(idx));
    checkbox.className = 'co-toggle';
    tdCheck.appendChild(checkbox);

    const tdName = document.createElement('td');
    const strongName = document.createElement('strong');
    strongName.textContent = co.name || '';
    tdName.appendChild(strongName);

    const tdUrl = document.createElement('td');
    const link = document.createElement('a');
    link.href = co.careers_url || '';
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.color = 'var(--accent)';
    link.style.textDecoration = 'none';
    link.textContent = co.careers_url || '';
    tdUrl.appendChild(link);

    const tdAction = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.setAttribute('data-del-idx', String(idx));
    delBtn.className = 'btn btn-danger btn-sm del-co-btn';
    delBtn.textContent = 'Remove';
    tdAction.appendChild(delBtn);

    tr.appendChild(tdCheck);
    tr.appendChild(tdName);
    tr.appendChild(tdUrl);
    tr.appendChild(tdAction);

    list.appendChild(tr);
  });

  // Wire delete & toggle buttons
  $$('.del-co-btn').forEach((btn) => {
    btn.addEventListener('click', (e: any) => {
      const idx = Number(e.target.getAttribute('data-del-idx'));
      currentConfig.trackedCompanies.splice(idx, 1);
      renderCompaniesTable();
      markUnsaved();
    });
  });

  $$('.co-toggle').forEach((box) => {
    box.addEventListener('change', (e: any) => {
      const idx = Number(e.target.getAttribute('data-co-idx'));
      if (currentConfig.trackedCompanies[idx]) {
        currentConfig.trackedCompanies[idx].enabled = e.target.checked;
        markUnsaved();
      }
    });
  });
}

function collectFormData(): Partial<Config> {
  const portals: Record<string, boolean> = { ...currentConfig.portals };
  $$('input[data-portal]').forEach((input) => {
    const portalId = input.getAttribute('data-portal');
    if (portalId) {
      portals[portalId] = input.checked;
    }
  });

  return {
    serverUrl: $('#server-url').value.trim() || null,
    apiKey: $('#api-key').value.trim() || null,
    scanIntervalHours: Number($('#scan-interval').value) || 6,
    fitThreshold: Number($('#fit-threshold').value) || 75,
    passiveMode: $('#passive-mode').checked,
    activeMode: $('#active-mode').checked,
    maxPostingAgeDays: Number($('#max-posting-age').value) || 0,
    titleFilter: {
      positive: parseCommaList($('#positive-keywords').value),
      negative: parseCommaList($('#negative-keywords').value),
    },
    locationFilter: {
      allow: parseCommaList($('#location-allow').value),
      block: parseCommaList($('#location-block').value),
    },
    portals,
    trackedCompanies: currentConfig.trackedCompanies || [],
  };
}

async function saveAll() {
  const status = $('#save-status');
  if (status) status.textContent = 'Saving changes...';

  try {
    const patch = collectFormData();
    currentConfig = await setConfig(patch);
    updateConnectionBadge();
    if (status) {
      status.textContent = '✓ All settings saved successfully!';
      status.style.color = 'var(--green)';
      setTimeout(() => {
        status.textContent = 'Settings up to date.';
        status.style.color = 'var(--muted)';
      }, 3000);
    }
  } catch (err: any) {
    if (status) {
      status.textContent = `Error: ${err.message}`;
      status.style.color = 'var(--red)';
    }
  }
}

function markUnsaved() {
  const status = $('#save-status');
  if (status) {
    status.textContent = '● Unsaved changes';
    status.style.color = '#f59e0b';
  }
}

async function loadScanHistory() {
  const api = (globalThis as any).browser ?? (globalThis as any).chrome;
  const storageArea = api?.storage?.local;
  if (!storageArea) return;

  const res = await storageArea.get('jobfoundry-scan-history');
  const history: any[] = res?.['jobfoundry-scan-history'] || [];
  const list = $('#history-list');
  const empty = $('#no-history');

  if (!list || !empty) return;
  list.textContent = '';

  if (history.length === 0) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  history.slice(0, 15).forEach((run) => {
    const tr = document.createElement('tr');
    const d = new Date(run.timestamp);
    const timeStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;

    const tdTime = document.createElement('td');
    tdTime.textContent = timeStr;

    const tdRaw = document.createElement('td');
    const strongRaw = document.createElement('strong');
    strongRaw.textContent = String(run.totalFetched ?? 0);
    tdRaw.appendChild(strongRaw);
    tdRaw.appendChild(document.createTextNode(' raw jobs'));

    const tdMatched = document.createElement('td');
    const spanMatched = document.createElement('span');
    spanMatched.style.color = 'var(--green)';
    spanMatched.textContent = `✓ ${run.passedFilters ?? 0}`;
    tdMatched.appendChild(spanMatched);
    tdMatched.appendChild(document.createTextNode(' matched'));

    const tdSent = document.createElement('td');
    const strongSent = document.createElement('strong');
    strongSent.textContent = String(run.ingested ?? 0);
    tdSent.appendChild(strongSent);
    tdSent.appendChild(document.createTextNode(' sent to queue'));

    tr.appendChild(tdTime);
    tr.appendChild(tdRaw);
    tr.appendChild(tdMatched);
    tr.appendChild(tdSent);

    list.appendChild(tr);
  });
}

// 1-Click Auto-Connect
async function autoConnect() {
  const status = $('#save-status');
  if (status) status.textContent = 'Connecting to open JobFoundry tab...';

  try {
    const res = await sendMessage('popup:autoConnect', undefined);
    if (res?.ok) {
      $('#server-url').value = res.serverUrl || '';
      $('#api-key').value = res.apiKey || '';
      await hydrate();
      if (status) {
        status.textContent = `✅ Connected as ${res.email}!`;
        status.style.color = 'var(--green)';
      }
    } else {
      if (status) {
        status.textContent = res?.error || 'Auto-connect failed.';
        status.style.color = 'var(--red)';
      }
    }
  } catch (err: any) {
    if (status) {
      status.textContent = `Auto-connect error: ${err.message}`;
      status.style.color = 'var(--red)';
    }
  }
}

// Fetch Keywords from Active Resume
async function fetchResumeKeywords() {
  const status = $('#save-status');
  const serverUrl = $('#server-url').value.trim() || currentConfig.serverUrl;
  const apiKey = $('#api-key').value.trim() || currentConfig.apiKey;

  if (!serverUrl || !apiKey) {
    alert('Please configure and save your Server URL and API Key first.');
    return;
  }

  if (status) status.textContent = 'Fetching active Master Resume...';

  try {
    const res = await fetch(`${serverUrl}/api/v1/resumes/active`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data?.resume?.resume) {
      alert(
        'No active Master Resume found on your account. Upload a JSON resume in the dashboard first.'
      );
      return;
    }

    const titles = extractKeywordsFromResume(data.resume.resume);
    if (titles.length === 0) {
      alert('Could not find explicit role titles in active resume basics/work fields.');
      return;
    }

    const existing = parseCommaList($('#positive-keywords').value);
    const combined = Array.from(new Set([...existing, ...titles]));
    $('#positive-keywords').value = formatCommaList(combined);
    markUnsaved();

    if (status) {
      status.textContent = `✓ Extracted ${titles.length} role keyword(s) from your Master Resume!`;
      status.style.color = 'var(--green)';
    }
  } catch (err: any) {
    alert(`Failed to fetch resume: ${err.message}`);
  }
}

// Manual Scan Trigger
async function triggerScan() {
  const banner = $('#scan-status-banner');
  const btn = $('#scan-now-btn');

  if (banner) {
    banner.style.display = 'block';
    banner.className = 'status-banner';
    banner.style.background = 'rgba(99, 102, 241, 0.15)';
    banner.style.color = '#e0e7ff';
    banner.textContent = 'Scanning all active portals & filtering postings...';
  }
  if (btn) btn.disabled = true;

  try {
    let res: any;
    try {
      res = await sendMessage('popup:scanNow', undefined);
    } catch (msgErr: any) {
      console.warn(
        'Background message failed, falling back to direct scan in options context:',
        msgErr
      );
      const jobs = await runScanPipeline({ getConfig, sendJobs });
      res = { ok: true, scanned: Array.isArray(jobs) ? jobs.length : 0 };
    }

    if (res?.ok) {
      if (banner) {
        banner.style.background = 'var(--green-bg)';
        banner.style.color = 'var(--green)';
        banner.textContent = `✓ Scan complete! ${res.scanned ?? 0} job(s) passed all keyword & date filters and were queued.`;
      }
      await loadScanHistory();
    } else {
      if (banner) {
        banner.style.background = 'var(--red-bg)';
        banner.style.color = 'var(--red)';
        banner.textContent = `Scan failed: ${res?.error || 'Unknown error'}`;
      }
    }
  } catch (err: any) {
    if (banner) {
      banner.style.background = 'var(--red-bg)';
      banner.style.color = 'var(--red)';
      banner.textContent = `Scan error: ${err.message}`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  hydrate().catch(console.error);

  $('#header-save-btn')?.addEventListener('click', saveAll);
  $('#footer-save-btn')?.addEventListener('click', saveAll);

  $('#options-auto-connect')?.addEventListener('click', autoConnect);
  $('#extract-resume-keywords')?.addEventListener('click', fetchResumeKeywords);
  $('#scan-now-btn')?.addEventListener('click', triggerScan);

  $('#reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset all filter and search settings to default values?')) {
      setConfig(DEFAULT_CONFIG).then(hydrate);
    }
  });

  // Tracked company addition
  $('#add-company-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    const name = $('#company-name').value.trim();
    const careers_url = $('#company-url').value.trim();
    if (!name || !careers_url) return;

    if (!currentConfig.trackedCompanies) currentConfig.trackedCompanies = [];
    currentConfig.trackedCompanies.push({
      id: `co_${Date.now()}`,
      name,
      careers_url,
      enabled: true,
    });

    $('#company-name').value = '';
    $('#company-url').value = '';
    renderCompaniesTable();
    markUnsaved();
  });

  // Input change listeners to mark unsaved
  $$('input, textarea, select').forEach((el) => {
    el.addEventListener('input', markUnsaved);
  });
});
