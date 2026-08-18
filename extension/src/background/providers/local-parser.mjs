// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// local-parser.mjs — local command provider (browser port).
//
// Browser port of career-ops providers/local-parser.mjs (MIT, vendored; see
// scripts/vendor.mjs). Upstream executes a user-configured parser command via
// child_process.execFile after a whitelist/path-escape validation chain — a
// genuinely Node-only capability. A browser extension cannot spawn local
// processes, and the Phase 03 scope is ATS/board providers over HTTP, so this
// port keeps the provider's identity in the registry but refuses to run:
// detect() never claims an entry and fetch() throws a clear error.
//
// The id stays registered ('local-parser') so the static registry's id space
// matches upstream and any config that explicitly routes to it fails loudly
// instead of silently scanning nothing.

/** @type {Provider} */
export default {
  id: 'local-parser',

  detect(entry) {
    return null; // local command execution is unavailable in the browser extension
  },

  async fetch(entry, ctx) {
    throw new Error(
      'local-parser: not supported in the browser extension — it executes a local parser ' +
      `command (${entry?.parser?.command ?? '<none>'}) which requires Node. ` +
      'Remove this portal from config.portals or use an HTTP provider.'
    );
  },
};