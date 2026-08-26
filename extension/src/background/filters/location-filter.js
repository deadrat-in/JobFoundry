/**
 * location-filter.js — Location matching engine for JobFoundry extension.
 * Ported from career-ops/scan.mjs (MIT).
 */

export const REMOTE_TITLE_RE = /(?<![a-z])remote(?=$|\s*[^a-z\s]|\s+in\b)/;

function compileLocationKeyword(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startsWord = /[a-z0-9]/.test(keyword[0]);
  const endsWord = /[a-z0-9]/.test(keyword[keyword.length - 1]);
  const prefix = startsWord ? '(?<![a-z0-9])' : '';
  const suffix = endsWord ? '(?![a-z0-9])' : '';
  const re = new RegExp(`${prefix}${escaped}${suffix}`, 'i');
  return (text) => re.test(text);
}

/**
 * Build location filter predicate from configuration:
 * `{ allow?: string[], block?: string[] }`
 *
 * Rules:
 * - Empty / missing location on job → passes (don't penalize missing data).
 * - If `block` matches → rejects.
 * - If `allow` is empty → passes.
 * - If `allow` is non-empty → must match `allow` OR job title must explicitly signal "Remote".
 *
 * @param {{ allow?: string[], block?: string[] }} [locationFilter]
 * @returns {(job: { location?: string, title?: string }) => boolean}
 */
export function buildLocationFilter(locationFilter) {
  if (!locationFilter || typeof locationFilter !== 'object') {
    return () => true;
  }

  const allowRaw = Array.isArray(locationFilter.allow) ? locationFilter.allow : [];
  const blockRaw = Array.isArray(locationFilter.block) ? locationFilter.block : [];

  const allowMatchers = allowRaw
    .filter((k) => typeof k === 'string' && k.trim().length > 0)
    .map((k) => compileLocationKeyword(k.trim().toLowerCase()));

  const blockMatchers = blockRaw
    .filter((k) => typeof k === 'string' && k.trim().length > 0)
    .map((k) => compileLocationKeyword(k.trim().toLowerCase()));

  return function matchesLocation(job) {
    const loc = (job?.location || '').trim();
    const title = (job?.title || '').trim();

    // Missing location passes (conservative)
    if (!loc) return true;

    // Check block list
    for (const matchBlock of blockMatchers) {
      if (matchBlock(loc)) {
        return false;
      }
    }

    // If allow list is empty, any non-blocked location passes
    if (allowMatchers.length === 0) {
      return true;
    }

    // Check allow list
    for (const matchAllow of allowMatchers) {
      if (matchAllow(loc)) {
        return true;
      }
    }

    // Title remote fallback (e.g. "Software Engineer - Remote")
    if (REMOTE_TITLE_RE.test(title.toLowerCase())) {
      return true;
    }

    return false;
  };
}
