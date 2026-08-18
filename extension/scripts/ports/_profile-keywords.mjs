// _profile-keywords.mjs — shared fallback for keyword-required providers
// (browser port). Currently used by vdab.mjs. Files prefixed with _ are never
// loaded as providers by the registry (see _registry.mjs).
//
// Browser port of career-ops providers/_profile-keywords.mjs (MIT, vendored;
// see scripts/vendor.mjs). Deviations from upstream:
//   - Upstream read config/profile.yml from disk (fs + js-yaml) when a
//     provider's portals.yml entry had no `keywords:`. A browser extension has
//     no profile.yml and no filesystem, so the fallback is a documented no-op:
//     resolveProfileKeywords() returns [] (fails open) and providers behave
//     exactly as they do upstream when the file is missing. Providers that
//     require keywords will throw their "no keywords" error, which forces the
//     user to set keywords in the extension's portal config — the intended
//     configuration surface here.
//   - profileTargetKeywords() is pure and copied unchanged.

function cleanKeywords(value) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(
    arr
      .filter(k => typeof k === 'string')
      .map(k => k.trim())
      .filter(Boolean),
  )];
}

/**
 * Extracts candidate search keywords from a parsed profile.yml's
 * `target_roles` block: `primary[]` plus `archetypes[].name`.
 * @param {any} profile
 * @returns {string[]}
 */
export function profileTargetKeywords(profile) {
  const roles = profile && profile.target_roles;
  if (!roles || typeof roles !== 'object') return [];
  return cleanKeywords([
    ...(Array.isArray(roles.primary) ? roles.primary : []),
    ...(Array.isArray(roles.archetypes) ? roles.archetypes.map(a => a && a.name) : []),
  ]);
}

/**
 * Profile-keyword fallback in the browser: always fails open with [] — there
 * is no config/profile.yml on disk (see header note). The `profilePath`
 * argument is accepted for API compatibility and ignored.
 * @param {string} [profilePath]
 * @returns {string[]}
 */
export function resolveProfileKeywords(profilePath) {
  return [];
}