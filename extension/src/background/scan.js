/**
 * scan.js — runScan pipeline for the extension.
 *
 * Order (project invariant): providers → liveness (drop expired) → normalize
 * → first-pass dedup → ingest client → Phase 01 server. Liveness runs in the
 * extension, never server-side.
 *
 * Each configured portal in config.portals is scanned with its resolved
 * provider (resolveProvider routing: explicit `provider:`, else detect()).
 * All providers run, then the results are pooled and processed once:
 *   - jobs with liveness 'expired' are dropped (conservative by design —
 *     only a definitive 404/410 expires; 'unknown' keeps the job);
 *   - each survivor is normalized to the Phase 01 canonical shape with
 *     source = provider id and a content fingerprint;
 *   - first-pass dedup (exact fingerprint match, within-batch + 24h session
 *     cache) drops re-sends;
 *   - the surviving batch is sent to the ingest server exactly once (sendJobs
 *     is skipped entirely when nothing survives).
 *
 * Returns the survivors (array) so the background event page can report the
 * scan result. All I/O is dependency-injected so tests can mock providers,
 * liveness, dedup cache, and the ingest client.
 */

import { resolveProvider } from './providers/_registry.mjs';
import { providerMap } from './providers/index.js';
import { makeHttpCtx } from './providers/_http.mjs';
import { checkLiveness } from './liveness/index.js';
import { normalizeJob, withFingerprint } from './normalize.js';
import { fingerprintText } from './fingerprint.js';
import { dedupJobs, createSessionCache } from './dedup.js';
import { buildTitleFilter } from './filters/title-keywords.js';
import { buildLocationFilter } from './filters/location-filter.js';
import { buildDateFilter } from './filters/date-filter.js';
import { jdHtmlToText, decantHtml } from '../content/extractors/helpers.js';

export async function runScanPipeline({
  getConfig,
  sendJobs,
  portals = null,
  providers = null,
  liveness = checkLiveness,
  fingerprint = fingerprintText,
  cache = null,
  logger = console,
  now = Date.now,
} = {}) {
  const config = portals !== null ? { portals } : getConfig ? await getConfig() : { portals: {} };
  const portalEntries = config.portals ?? {};
  const trackedCompanies = Array.isArray(config.trackedCompanies) ? config.trackedCompanies : [];

  // Registry: injected Map<id, provider> (tests) or the static build index.
  const registry = providers ?? new Map(Object.entries(providerMap));

  const enabled = [];

  // 1. Resolve standard portal / aggregator entries
  for (const [name, rawEntry] of Object.entries(portalEntries)) {
    if (rawEntry === false || rawEntry === null || rawEntry === undefined) continue;
    const entry =
      typeof rawEntry === 'object' && rawEntry !== null
        ? rawEntry
        : {
            name,
            provider:
              typeof rawEntry === 'string' && !rawEntry.startsWith('http') ? rawEntry : name,
            careers_url:
              typeof rawEntry === 'string' && rawEntry.startsWith('http') ? rawEntry : undefined,
          };
    const resolved = resolveProvider(entry, registry, { skipIds: ['local-parser'] });
    if (resolved?.error) {
      logger.warn?.(`[scan] ${name}: ${resolved.error} — skipping portal`);
      continue;
    }
    if (!resolved?.provider) {
      logger.warn?.(`[scan] ${name}: no provider detected — skipping portal`);
      continue;
    }
    enabled.push({ name, entry, provider: resolved.provider });
  }

  // 2. Resolve custom tracked companies
  for (const company of trackedCompanies) {
    if (!company || company.enabled === false || !company.careers_url) continue;
    const entry = {
      name: company.name || company.careers_url,
      careers_url: company.careers_url,
    };
    const resolved = resolveProvider(entry, registry, { skipIds: ['local-parser'] });
    if (resolved?.provider) {
      enabled.push({
        name: company.name || company.careers_url,
        entry,
        provider: resolved.provider,
      });
    }
  }

  // Phase 1 — fetch from every enabled portal (independent, run in parallel).
  const httpCtx = makeHttpCtx();
  const pooled = [];
  await Promise.all(
    enabled.map(async ({ name, entry, provider }) => {
      try {
        const jobs = await provider.fetch(entry, httpCtx);
        pooled.push(
          ...(Array.isArray(jobs) ? jobs.map((j) => ({ ...j, _provider: provider.id })) : [])
        );
      } catch (err) {
        logger.warn?.(`[scan] ${name} (${provider.id}): fetch failed — ${err?.message ?? err}`);
      }
    })
  );

  // Phase 2 — Apply Filter Pipeline: Date -> Title Keywords -> Location
  const matchDate = buildDateFilter(config.maxPostingAgeDays, now);
  const matchTitle = buildTitleFilter(config.titleFilter);
  const matchLocation = buildLocationFilter(config.locationFilter);

  const filtered = pooled.filter((job) => {
    if (!matchDate(job)) return false;
    if (!matchTitle(job?.title)) return false;
    if (!matchLocation(job)) return false;
    return true;
  });

  // Phase 2.5 — Auto-Enrich Missing Job Descriptions (Universal Decanter)
  for (const raw of filtered) {
    if (
      (!raw.description || raw.description.length < 50) &&
      raw.url &&
      /^https?:\/\//i.test(raw.url)
    ) {
      try {
        let html = '';
        try {
          const fetchFn = globalThis.fetch;
          const res = await fetchFn(raw.url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
          if (res.ok) {
            html = await res.text();
          }
        } catch {
          html = await httpCtx.fetchText(raw.url).catch(() => '');
        }

        if (html) {
          // Tier 1: Schema.org JobPosting JSON-LD
          const jsonLdMatch = html.match(
            /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
          );
          let foundDesc = '';
          if (jsonLdMatch) {
            for (const scriptTag of jsonLdMatch) {
              try {
                const inner = scriptTag.replace(/^<script\b[^>]*>|<\/script>$/gi, '').trim();
                const data = JSON.parse(inner);
                const items = Array.isArray(data) ? data : data['@graph'] || [data];
                for (const it of items) {
                  if (
                    (it['@type'] === 'JobPosting' ||
                      String(it['@type'] || '').includes('JobPosting')) &&
                    it.description
                  ) {
                    foundDesc = jdHtmlToText(it.description);
                    break;
                  }
                }
              } catch {}
              if (foundDesc) break;
            }
          }

          // Tier 2: Semantic job description containers
          if (!foundDesc) {
            const articleMatch =
              html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
              html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
              html.match(
                /<div\b[^>]*class=["'][^"']*(?:job-description|jobDescription|jobDetails|description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
              );
            if (articleMatch) {
              foundDesc = jdHtmlToText(articleMatch[1]);
            }
          }

          // Tier 3: Universal DOM Decanter fallback (strip chrome, nav, footer, scripts, etc.)
          if (!foundDesc) {
            const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
            const contentHtml = bodyMatch ? bodyMatch[1] : html;
            const decanted = decantHtml(contentHtml);
            if (decanted && decanted.length > 50) {
              foundDesc = decanted;
            }
          }

          if (foundDesc && foundDesc.length > 50) {
            raw.description = foundDesc;
          }
        }
      } catch {
        // Fail-open: continue with summary row
      }
    }
  }

  // Phase 3 — liveness → normalize → fingerprint → dedup → send
  const dedupCache = cache ?? createSessionCache();
  const survivors = [];
  for (const raw of filtered) {
    const livenessResult = await liveness(raw, httpCtx);
    if (livenessResult === 'expired') continue;
    const normalized = normalizeJob(raw, raw._provider);
    const withFp = await withFingerprint(normalized, fingerprint);
    survivors.push(withFp);
  }

  const deduped = await dedupJobs(survivors, dedupCache, { now: now() });

  if (deduped.length > 0 && sendJobs) {
    await sendJobs({ jobs: deduped });
  }

  // Record scan history run
  try {
    const api = globalThis.browser ?? globalThis.chrome;
    const storageArea = api?.storage?.local;
    if (storageArea) {
      const existing =
        (await storageArea.get('jobfoundry-scan-history'))?.['jobfoundry-scan-history'] || [];
      const updated = [
        {
          timestamp: now(),
          totalFetched: pooled.length,
          passedFilters: filtered.length,
          deduped: deduped.length,
          ingested: deduped.length,
        },
        ...existing,
      ].slice(0, 30);
      await storageArea.set({ 'jobfoundry-scan-history': updated });
    }
  } catch {
    // Ignore storage log error
  }

  return deduped;
}
