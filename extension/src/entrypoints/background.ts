import { defineBackground } from 'wxt/utils/define-background';
import { onMessage } from '../shared/messaging.ts';
import { getConfig, setConfig } from '../shared/config.ts';
import type { Config } from '../shared/config.ts';
import { runScanPipeline } from '../background/scan.js';
import { sendJobs } from '../shared/ingest-client.js';
import { checkLiveness } from '../background/liveness/index.js';
import { normalizeJob, withFingerprint } from '../background/normalize.js';
import { fingerprintText } from '../background/fingerprint.js';
import { dedupJobs, createSessionCache } from '../background/dedup.js';
import { makeHttpCtx } from '../background/providers/_http.mjs';
import { extractKeywordsFromResume } from '../background/filters/resume-keywords.js';

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

  api.commands?.onCommand?.addListener(async (command: string) => {
    if (command === 'open-side-panel') {
      try {
        const tabs = await api.tabs?.query({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        const windowId = tabs?.[0]?.windowId;
        if (api?.sidePanel?.open && windowId !== undefined) {
          await api.sidePanel.open({ windowId, tabId });
        } else if (api?.sidebarAction?.open) {
          await api.sidebarAction.open();
        }
      } catch {
        // ignore command errors
      }
    }
  });

  // Protocol Message Handlers
  onMessage('popup:autoConnect', async () => {
    try {
      const tabs = await api.tabs?.query({ active: true, currentWindow: true });
      const activeTab = tabs?.[0];
      if (!activeTab?.id) {
        return { ok: false, error: 'No active browser tab found.' };
      }

      if (!api.scripting?.executeScript) {
        return { ok: false, error: 'Browser scripting permission not available.' };
      }

      const results = await api.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          // SECURITY GUARANTEE:
          // Strictly verify this page is genuinely a JobFoundry web application instance
          // before reading any session or credentials from localStorage.
          const metaApp = document
            .querySelector('meta[name="jobfoundry-app"]')
            ?.getAttribute('content');
          const metaAppName = document
            .querySelector('meta[name="application-name"]')
            ?.getAttribute('content');
          const rootEl = document.querySelector('#root[data-jobfoundry-app="true"]');
          const isJobFoundry = metaApp === 'true' || metaAppName === 'JobFoundry' || !!rootEl;

          if (!isJobFoundry) {
            return {
              ok: false,
              code: 'NOT_JOBFOUNDRY',
              error:
                'Active tab is not a JobFoundry dashboard. Please switch to your JobFoundry dashboard tab first.',
            };
          }

          try {
            const userRaw = localStorage.getItem('jf_auth_user');
            const token = localStorage.getItem('jf_auth_token');
            const settingsRaw = localStorage.getItem('jf_settings');

            const user = userRaw ? JSON.parse(userRaw) : null;
            const settings = settingsRaw ? JSON.parse(settingsRaw) : null;

            const apiKey = user?.apiKey || (token ? token : null);
            let serverUrl = settings?.apiUrl;

            if (!serverUrl || serverUrl === 'http://localhost:8080') {
              serverUrl = 'http://localhost:8080';
            }

            if (!apiKey) {
              return {
                ok: false,
                code: 'NOT_LOGGED_IN',
                error:
                  'Found JobFoundry dashboard, but you are not logged in yet. Please log in to your dashboard first.',
              };
            }

            return {
              ok: true,
              serverUrl,
              apiKey,
              email: user?.email || 'Logged In User',
              name: user?.name || '',
            };
          } catch (err: any) {
            return {
              ok: false,
              code: 'STORAGE_ERROR',
              error: `Failed to read JobFoundry session: ${err?.message || err}`,
            };
          }
        },
      });

      const extracted = results?.[0]?.result;
      if (!extracted) {
        return { ok: false, error: 'Could not inspect active page.' };
      }

      if (!extracted.ok) {
        return { ok: false, error: extracted.error };
      }

      // Persist to extension sync config
      const patch = {
        serverUrl: extracted.serverUrl,
        apiKey: extracted.apiKey,
      };

      // Fetch active resume to populate positive keywords if user hasn't set any yet
      try {
        const curConfig = await getConfig();
        const res = await fetch(`${extracted.serverUrl}/api/v1/resumes/active`, {
          headers: { Authorization: `Bearer ${extracted.apiKey}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.resume?.resume) {
            const extractedTitles = extractKeywordsFromResume(data.resume.resume);
            if (extractedTitles.length > 0 && (!curConfig.titleFilter?.positive || curConfig.titleFilter.positive.length === 0)) {
              patch.titleFilter = {
                ...curConfig.titleFilter,
                positive: extractedTitles,
              };
            }
          }
        }
      } catch {
        // Ignore resume keyword fetch failure
      }

      await setConfig(patch);

      return {
        ok: true,
        serverUrl: extracted.serverUrl,
        apiKey: extracted.apiKey,
        email: extracted.email,
        name: extracted.name,
      };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

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
              const clean = (t) =>
                (t || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
              const getCanon = () =>
                document.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
                window.location.href;

              const url = getCanon();
              const host = window.location.hostname.toLowerCase();

              const decodeEntities = (str) => {
                if (typeof str !== 'string' || !str) return '';
                const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
                return str
                  .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED[name] || m)
                  .replace(/&#([0-9]+);/g, (m, d) => {
                    const cp = Number(d);
                    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
                  })
                  .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
                    const cp = parseInt(h, 16);
                    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
                  });
              };

              const jdHtmlToText = (html) => {
                if (typeof html !== 'string' || !html) return '';
                const BLOCK_END = /<\/(p|div|ul|ol|h[1-6]|tr|section|article|blockquote)\s*>/gi;
                const stripped = decodeEntities(html)
                  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
                  .replace(/<br\s*\/?>/gi, '\n')
                  .replace(/<li[^>]*>/gi, '\n- ')
                  .replace(BLOCK_END, '\n')
                  .replace(/<[^>]+>/g, ' ');
                return decodeEntities(stripped)
                  .replace(/[ \t\u00a0]+/g, ' ')
                  .replace(/ *\n */g, '\n')
                  .replace(/\n{3,}/g, '\n\n')
                  .trim();
              };

              // Tier 1: JSON-LD Schema.org JobPosting
              const scripts = document.querySelectorAll('script[type="application/ld+json"]');
              for (const script of scripts) {
                try {
                  const content = script.textContent?.trim();
                  if (!content) continue;
                  const data = JSON.parse(content);
                  const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
                  for (const item of items) {
                    if (!item || typeof item !== 'object') continue;
                    const type = String(item['@type'] || '');
                    if (type === 'JobPosting' || type.includes('JobPosting')) {
                      const title = clean(item.title || item.name);
                      let company = '';
                      if (typeof item.hiringOrganization === 'string') company = clean(item.hiringOrganization);
                      else if (item.hiringOrganization && typeof item.hiringOrganization === 'object') {
                        company = clean(item.hiringOrganization.name || item.hiringOrganization.legalName);
                      }
                      let location = null;
                      if (typeof item.jobLocation === 'string') location = clean(item.jobLocation);
                      else if (item.jobLocation?.address) {
                        const a = item.jobLocation.address;
                        location = typeof a === 'string' ? clean(a) : clean([a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', '));
                      }
                      const description = item.description ? jdHtmlToText(item.description) : '';
                      if (title && description) {
                        return [
                          {
                            title,
                            company: company || 'Company',
                            location: location || null,
                            description,
                            url,
                            source: host.includes('linkedin.com') ? 'linkedin' : host.includes('indeed.') ? 'indeed' : 'web',
                            postedAt: item.datePosted ? Date.parse(item.datePosted) || null : null,
                          },
                        ];
                      }
                    }
                  }
                } catch {}
              }

              // Tier 2: Platform-Specific Selectors
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
                  document.querySelector('.jobs-description__content') ||
                  document.querySelector('.jobs-box__html-content') ||
                  document.querySelector('.show-more-less-html__markup') ||
                  document.querySelector('article');
                const description = descEl ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '') : '';
                if (title) {
                  return [{ title, company, location, description, url, source: 'linkedin', postedAt: null }];
                }
              }

              if (host.includes('indeed.')) {
                const titleEl =
                  document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
                  document.querySelector('.jobsearch-JobInfoHeader-title') ||
                  document.querySelector('h1');
                const title = clean(titleEl?.textContent);
                const companyEl =
                  document.querySelector('[data-testid="inlineHeader-companyName"]') ||
                  document.querySelector('.jobsearch-CompanyInfoContainer a') ||
                  document.querySelector('[data-testid="company-name"]');
                const company = clean(companyEl?.textContent) || 'Indeed Company';
                const locEl =
                  document.querySelector('[data-testid="inlineHeader-companyLocation"]') ||
                  document.querySelector('[data-testid="job-location"]');
                const location = clean(locEl?.textContent) || null;
                const descEl =
                  document.querySelector('#jobDescriptionText') ||
                  document.querySelector('.jobsearch-JobComponent-description');
                const description = descEl ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '') : '';
                if (title) {
                  return [{ title, company, location, description, url, source: 'indeed', postedAt: null }];
                }
              }

              if (host.includes('greenhouse.io')) {
                const titleEl = document.querySelector('h1.app-title, h1.heading, .job-name, h1');
                const title = clean(titleEl?.textContent);
                const companyEl = document.querySelector('.company-name, meta[property="og:site_name"], .header__logo-text');
                const company = clean(companyEl?.textContent || companyEl?.getAttribute?.('content')) || 'Greenhouse Company';
                const locEl = document.querySelector('.location, .body--secondary');
                const location = clean(locEl?.textContent) || null;
                const descEl = document.querySelector('#content, #app_body, .job-description, article');
                const description = descEl ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '') : '';
                if (title) {
                  return [{ title, company, location, description, url, source: 'greenhouse', postedAt: null }];
                }
              }

              // Tier 3: Semantic Main-Text Extraction (career-ops readDom)
              const titleEl = document.querySelector('h1') || document.querySelector('h2');
              const title = clean(titleEl?.textContent);
              const root = document.querySelector('main, [role="main"], article, #content, #job-description, .job-description, .job-details') || document.body;
              let description = '';
              if (root) {
                const clone = root.cloneNode(true);
                clone.querySelectorAll('script, style, nav, header, footer, noscript, svg, button, form, iframe').forEach((el) => el.remove());
                description = jdHtmlToText(clone.innerHTML || clone.innerText || clone.textContent || '');
              }
              const company = clean(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || document.title?.split(/[-|–—]/)[0]) || 'Company';

              if (title && description.length > 50) {
                return [{ title, company, location: null, description, url, source: 'web', postedAt: null }];
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
