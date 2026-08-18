# scripts/ports/

Browser-adapted versions of the vendored career-ops provider layer (MIT;
source of truth under `../../Scratch/career-ops`). `scripts/vendor.mjs` copies
the upstream files verbatim and then overwrites the entries here, so the
vendored tree under `src/background/providers/` is byte-identical to these
ports for the files that cannot run in a browser as copied.

Every port keeps the original MIT header/attribution and documents its
deviations in-file. Current ports:

| File | Why it is ported |
| ---- | ---------------- |
| `_http.mjs` | Upstream imports `_dns-cache.mjs` (patches `node:dns`) and relies on undici's `redirect:'error'` TypeError shape. Port removes the DNS cache (browser owns DNS) and pins `redirect:'manual'` + a 3xx/opaqueredirect guard that throws the same pinned non-retryable shape (SSRF trust guard). |
| `_registry.mjs` | Upstream loads providers via `fs.readdirSync` + dynamic import. Port wraps the build-time static index (`providers/index.js`); `resolveProvider()` unchanged. |
| `_profile-keywords.mjs` | Upstream reads `config/profile.yml` from disk (fs + js-yaml). Port keeps pure `profileTargetKeywords()`, and `resolveProfileKeywords()` is a documented no-op returning `[]` (no filesystem in the browser). |
| `local-parser.mjs` | Upstream spawns a configured local parser via `child_process`. A browser cannot exec local commands; the port keeps the `local-parser` id in the registry but `detect()` returns null and `fetch()` throws a clear error. |
| `alibaba.mjs` | Upstream imports `randomUUID` from `node:crypto`. Port mints the CSRF token from WebCrypto (`globalThis.crypto.randomUUID`) with a Math.random fallback. |

`tests/` mirrors the lifted provider tests that had to change:

| Test | Why it is ported |
| ---- | ---------------- |
| `workday.test.mjs` | Strips the unused `warn, run` imports (kept for eslint cleanliness). |
| `_profile-keywords.test.mjs` | Replaces the fs/file-reading assertions with the browser no-op contract. |
| `vdab.test.mjs` | Replaces the config/profile.yml tmp-cwd fallback assertions with the browser throw-on-empty-keywords contract. |