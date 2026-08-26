import { defineBackground } from 'wxt/utils/define-background';
import { onMessage } from '../shared/messaging.ts';
import { getConfig } from '../shared/config.ts';
import type { Config } from '../shared/config.ts';
import { runScanPipeline } from '../background/scan.js';
import { sendJobs } from '../shared/ingest-client.js';
import { checkLiveness } from '../background/liveness/index.js';
import { normalizeJob, withFingerprint } from '../background/normalize.js';
import { fingerprintText } from '../background/fingerprint.js';
import { dedupJobs, createSessionCache } from '../background/dedup.js';
import { makeHttpCtx } from '../background/providers/_http.mjs';

export const SCAN_ALARM_NAME = 'jobfoundry-periodic-scan';

export async function processDiscoveredJobs({
  rawJobs,
  cache = null,
  now = Date.now,
}: {
  rawJobs: any[];
  cache?: any;
  now?: () => number;
}) {
  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    return { ok: true, ingested: 0 };
  }
  const config = await getConfig();
  if (!config.serverUrl || !config.apiKey) {
    return { ok: false, error: 'extension not configured with serverUrl and apiKey' };
  }

  const httpCtx = makeHttpCtx();
  const dedupCache = cache ?? createSessionCache();
  const survivors: any[] = [];

  for (const raw of rawJobs) {
    try {
      const livenessResult = await checkLiveness(raw, httpCtx);
      if (livenessResult === 'expired') continue;
      const normalized = normalizeJob(raw, raw.source || 'content-script');
      const withFp = await withFingerprint(normalized, fingerprintText);
      survivors.push(withFp);
    } catch {
      // ignore malformed entries
    }
  }

  const deduped = await dedupJobs(survivors, dedupCache, { now: now() });
  if (deduped.length > 0) {
    await sendJobs({
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
      jobs: deduped,
    });
  }

  return { ok: true, ingested: deduped.length };
}

export default defineBackground(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.runtime?.onInstalled) return;

  const syncAlarms = async () => {
    try {
      const config = await getConfig();
      await api.alarms?.create(SCAN_ALARM_NAME, {
        periodInMinutes: Math.max(1, config.scanIntervalHours * 60),
      });
    } catch {
      // ignore in environments without alarms
    }
  };

  api.runtime.onInstalled.addListener(syncAlarms);

  api.alarms?.onAlarm?.addListener(async (alarm: any) => {
    if (alarm.name === SCAN_ALARM_NAME) {
      try {
        await runScanPipeline({ getConfig, sendJobs });
      } catch (err) {
        console.error('Periodic scan error:', err);
      }
    }
  });

  // Protocol Message Handlers
  onMessage('popup:scanNow', async () => {
    try {
      const jobs = await runScanPipeline({ getConfig, sendJobs });
      return { ok: true, scanned: Array.isArray(jobs) ? jobs.length : 0 };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  onMessage('popup:captureActiveTab', async () => {
    try {
      const tabs = await api.tabs?.query({ active: true, currentWindow: true });
      const activeTab = tabs?.[0];
      if (!activeTab?.id) {
        return { ok: false, error: 'no active tab found' };
      }

      let extracted: any[] = [];
      if (api.scripting?.executeScript) {
        try {
          const results = await api.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
              const clean = (t: any) =>
                (t || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
              const getCanon = () =>
                (document.querySelector('link[rel="canonical"]') as HTMLLinkElement)?.href ||
                window.location.href;

              const url = getCanon();
              const host = window.location.hostname.toLowerCase();

              if (host.includes('linkedin.com')) {
                const titleEl =
                  document.querySelector('.job-details-jobs-unified-top-card__job-title') ||
                  document.querySelector('.jobs-unified-top-card__job-title') ||
                  document.querySelector('h2.job-details-jobs-unified-top-card__job-title') ||
                  document.querySelector('.jobs-details__main-content h1') ||
                  document.querySelector('.topcard__title') ||
                  document.querySelector('h1.t-24') ||
                  document.querySelector('h1');
                const title = clean(titleEl?.textContent);
                const companyEl =
                  document.querySelector('.job-details-jobs-unified-top-card__company-name') ||
                  document.querySelector('.jobs-unified-top-card__company-name') ||
                  document.querySelector('a.topcard__org-name-link') ||
                  document.querySelector('a[href*="/company/"]');
                const company = clean(companyEl?.textContent) || 'LinkedIn Company';
                const locEl =
                  document.querySelector('.job-details-jobs-unified-top-card__bullet') ||
                  document.querySelector('.jobs-unified-top-card__bullet') ||
                  document.querySelector('.topcard__flavor--bullet');
                const location = clean(locEl?.textContent) || null;
                const descEl =
                  document.querySelector('#job-details') ||
                  document.querySelector('.jobs-description-content__text') ||
                  document.querySelector('.jobs-box__html-content') ||
                  document.querySelector('article');
                const description = clean(descEl?.textContent) || '';
                if (title) {
                  return [
                    {
                      title,
                      company,
                      location,
                      description,
                      url,
                      source: 'linkedin',
                      postedAt: null,
                    },
                  ];
                }
              }

              if (host.includes('greenhouse.io')) {
                const titleEl =
                  document.querySelector('h1.app-title') ||
                  document.querySelector('h1.heading') ||
                  document.querySelector('.job-name') ||
                  document.querySelector('h1');
                const title = clean(titleEl?.textContent);
                const companyEl =
                  document.querySelector('.company-name') ||
                  document.querySelector('meta[property="og:site_name"]');
                const company =
                  clean(companyEl?.textContent || (companyEl as HTMLMetaElement)?.content) ||
                  window.location.pathname.split('/')[1] ||
                  'Greenhouse Company';
                const locEl =
                  document.querySelector('.location') ||
                  document.querySelector('.body--secondary');
                const location = clean(locEl?.textContent) || null;
                const descEl =
                  document.querySelector('#content') ||
                  document.querySelector('#app_body') ||
                  document.querySelector('.job-description') ||
                  document.querySelector('article');
                const description = clean(descEl?.textContent) || '';
                if (title) {
                  return [
                    {
                      title,
                      company,
                      location,
                      description,
                      url,
                      source: 'greenhouse',
                      postedAt: null,
                    },
                  ];
                }
              }

              const titleEl = document.querySelector('h1') || document.querySelector('h2');
              const title = clean(titleEl?.textContent);
              const descEl =
                document.querySelector('article') ||
                document.querySelector('#job-description') ||
                document.querySelector('main') ||
                document.body;
              const description = clean(descEl?.textContent) || '';
              const company =
                clean(document.title?.split('-')[0]?.split('|')[0]) || 'Company';

              if (title && description.length > 30) {
                return [
                  {
                    title,
                    company,
                    location: null,
                    description,
                    url,
                    source: 'web',
                    postedAt: null,
                  },
                ];
              }
              return [];
            },
          });
          extracted = results?.[0]?.result || [];
        } catch (err: any) {
          console.warn('Scripting extraction error:', err);
        }
      }

      if (!extracted || extracted.length === 0) {
        return { ok: false, error: 'could not detect job details on active tab' };
      }

      const res = await processDiscoveredJobs({ rawJobs: extracted });
      if (!res.ok) {
        return { ok: false, error: res.error };
      }
      return { ok: true, job: extracted[0], count: extracted.length };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  onMessage('content:jobsDiscovered', async ({ data }) => {
    try {
      return await processDiscoveredJobs({ rawJobs: data.jobs });
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // Watch for scan interval changes
  storage.watch<Config>('sync:jobfoundry-config', async (newConfig) => {
    if (newConfig?.scanIntervalHours) {
      try {
        await api.alarms?.create(SCAN_ALARM_NAME, {
          periodInMinutes: Math.max(1, newConfig.scanIntervalHours * 60),
        });
      } catch {
        // ignore
      }
    }
  });
});
