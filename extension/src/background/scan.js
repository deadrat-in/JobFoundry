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

  // Registry: injected Map<id, provider> (tests) or the static build index.
  const registry = providers ?? new Map(Object.entries(providerMap));

  const enabled = [];
  for (const [name, entry] of Object.entries(portalEntries)) {
    if (entry === false || entry === null || entry === undefined) continue;
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

  // Phase 2 — liveness → normalize → fingerprint → dedup → send, exactly once.
  const dedupCache = cache ?? createSessionCache();
  const survivors = [];
  for (const raw of pooled) {
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

  return deduped;
}
