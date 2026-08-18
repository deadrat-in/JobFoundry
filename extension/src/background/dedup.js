/**
 * dedup.js — first-pass dedup for extension scans.
 *
 * Two layers:
 *   1. In-batch dedup: two providers (or two pages) surface the same role in
 *      one scan. Fingerprints equal → the later job is dropped from the batch
 *      being sent.
 *   2. Cross-batch dedup via browser.storage.session: a recent fingerprint
 *      (within DEDUP_WINDOW_HOURS, default 24) is not re-sent on a later scan.
 *      The session store lives in browser memory, so it costs nothing to keep
 *      and resets with the browser — a job re-sent after a restart is the
 *      correct trade-off against dropping a live posting.
 *
 * Fingerprints are exact-match only (16-hex-char SimHash, as in
 * fingerprint.js). Near-miss similarity is intentionally out of scope for the
 * extension's first-pass dedup: a false drop costs the user a real job, and
 * fuzzy cross-listing is the server's job (Phase 01 fingerprint-core).
 *
 * The dedup cache is a dependency-injected storage adapter so the same module
 * runs under Node tests (browser-mock storage.session) and in the extension.
 */

export const DEDUP_WINDOW_HOURS = 24;

export const STORAGE_KEY = 'jobfoundry_recent_fingerprints';

function makeFallbackCache() {
  const seen = new Map();
  return {
    async getAll() {
      return new Map(seen);
    },
    async setAll(map) {
      seen.clear();
      for (const [k, v] of map) seen.set(k, v);
    },
  };
}

function timestampMs(raw) {
  if (typeof raw === 'number') return raw;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Drop jobs whose fingerprint already appeared (in this batch or in the
 * recent session cache), and refresh the cache. Pure given the adapter.
 *
 * @param {Array<object>} jobs - normalized jobs (each may carry `fingerprint`).
 * @param {{getAll: Function, setAll: Function}} cache - session storage adapter.
 * @param {{now?: number, windowHours?: number, onDedup?: Function}} [opts]
 * @returns {Promise<Array<object>>} survivors, in input order.
 */
export async function dedupJobs(
  jobs,
  cache,
  { now = Date.now(), windowHours = DEDUP_WINDOW_HOURS, onDedup } = {}
) {
  const current = typeof now === 'function' ? now() : now;
  const cutoff = current - windowHours * 3600000;
  const stored = await cache.getAll();
  const recent = new Map();
  const seenThisBatch = new Set();

  for (const [fp, tsRaw] of stored) {
    const ts = timestampMs(tsRaw);
    if (ts === null || ts >= cutoff) recent.set(fp, ts);
  }

  const survivors = [];
  for (const job of jobs) {
    const fp =
      typeof job?.fingerprint === 'string' && job.fingerprint !== '' ? job.fingerprint : null;
    if (fp !== null) {
      if (recent.has(fp) || seenThisBatch.has(fp)) {
        onDedup?.(job, fp);
        continue;
      }
      seenThisBatch.add(fp);
      recent.set(fp, current);
    }
    survivors.push(job);
  }

  await cache.setAll(recent);
  return survivors;
}

/** Storage.session-backed cache adapter for the extension runtime. */
export function createSessionCache({ browser } = {}) {
  const api = browser ?? globalThis.browser ?? globalThis.chrome;
  if (!api?.storage?.session) return makeFallbackCache();
  return {
    async getAll() {
      const stored = await api.storage.session.get(STORAGE_KEY);
      const raw = stored?.[STORAGE_KEY];
      const out = new Map();
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) out.set(k, v);
      }
      return out;
    },
    async setAll(map) {
      const obj = {};
      for (const [k, v] of map) obj[k] = v;
      await api.storage.session.set({ [STORAGE_KEY]: obj });
    },
  };
}
