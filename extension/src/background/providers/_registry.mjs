// _registry.mjs — provider registry for the browser extension (browser port).
//
// Browser port of career-ops providers/_registry.mjs (MIT, vendored; see
// scripts/vendor.mjs). Upstream loads provider modules off the filesystem with
// fs.readdirSync + dynamic import; a browser bundle cannot do that, so the
// registry is the static, build-time generated index (providers/index.js,
// produced by scripts/gen-provider-index.mjs) and `loadProviders()` just wraps
// it in a Map. resolveProvider() is the same deterministic routing used by
// scan.mjs and is copied unchanged.
//
// Files prefixed with _ are never loaded as providers by the registry.

import { providerMap } from './index.js';

/**
 * Every provider plugin, keyed by provider id. The static index imports each
 * provider module at build time, so the bundle carries the full registry with
 * no runtime fs access.
 *
 * The `dir` argument is accepted for API compatibility with the upstream
 * loader; it is ignored (the registry is fixed at build time).
 *
 * @returns {Promise<Map<string, object>>}
 */
export async function loadProviders(dir) {
  return new Map(Object.entries(providerMap));
}

/**
 * Resolve which provider handles a tracked_companies entry.
 *   1. Explicit `provider:` field wins (skips detect()).
 *   2. local-parser when parser.command + script are configured (before API detect).
 *   3. Otherwise each provider's detect() runs in load order; first hit wins.
 *
 * @param {object} entry - tracked_companies entry.
 * @param {Map<string, object>} providers - id→provider Map from loadProviders().
 * @param {{skipIds?: string[]}} [opts] - Provider ids to skip.
 * @returns {{provider: object}|{error: string}|null}
 */
export function resolveProvider(entry, providers, { skipIds = [] } = {}) {
  if (entry.provider) {
    const p = providers.get(entry.provider);
    if (!p) return { error: `unknown provider: ${entry.provider}` };
    return { provider: p };
  }

  const localParser = providers.get('local-parser');
  if (localParser && !skipIds.includes('local-parser')) {
    try {
      const hit = localParser.detect?.(entry);
      if (hit) return { provider: localParser };
    } catch (err) {
      console.error(`⚠️  local-parser: detect() threw for "${entry.name}" — ${err.message}`);
    }
  }

  for (const p of providers.values()) {
    if (skipIds.includes(p.id)) continue;
    let hit;
    try {
      hit = p.detect?.(entry);
    } catch (err) {
      console.error(`⚠️  ${p.id}: detect() threw for "${entry.name}" — ${err.message}`);
      continue;
    }
    if (hit) return { provider: p };
  }
  return null;
}