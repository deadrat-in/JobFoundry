# providers/

Job-source provider modules for JobFoundry's zero-token browser extraction layer.

## Purpose

Each non-helper `*.mjs` file in this directory maps one public, no-auth job
source (ATS API, RSS/XML feed, or server-rendered HTML page) to the
extension's normalized `Job` shape. Providers are zero-token by design: they
hit public endpoints directly, with no LLM calls and no login. Captured jobs
are sent to the local JobFoundry ingest API (`POST /api/v1/jobs/ingest`).
The user-facing catalog of supported sources lives in the
[providers directory on the docs site](../../../../site/src/pages/docs/providers.astro).

A subset of this provider layer is adapted from the MIT-licensed
[career-ops](https://github.com/career-ops) provider collection. Those files
keep their original MIT headers and attribution; browser-incompatible modules
are ported (never rewritten in place) — see
[`scripts/ports/README.md`](../../../scripts/ports/README.md) for the port
table and deviation notes. `scripts/vendor.mjs` + `scripts/sync-providers.mjs`
own the sync process.

## Our philosophy: zero-token extraction

JobFoundry's position is simple: reading a public job posting should never
cost an LLM call. Structured data comes from public ATS JSON endpoints,
JSON-LD schemas, RSS feeds, or DOM parsing. Anything that needs a model
(fit scoring, resume tailoring) happens later, on the local server, against
jobs already captured. This keeps discovery fast, free, and private.

## Adding a provider

[**ADDING_A_PROVIDER.md**](ADDING_A_PROVIDER.md) is the full guide — the
module contract, the mandatory guards (SSRF hardening, defensive parsing, the
shared HTML-entity decoder, the absolute page ceiling), the test
requirements, and the pre-PR checklist. Start there.

Core providers must be zero-auth against public endpoints and must run in a
browser content/background context (no Node APIs, no filesystem, no child
processes). Sources that need login or interactive sessions belong in the
in-page DOM extractors (`src/content/extractors/`) instead.

## Loading and routing

There is no hand-maintained index — discovery is convention-based:

1. `scripts/gen-provider-index.mjs` generates `providers/index.js` at build
   time from every `providers/*.mjs` file NOT starting with `_`, in
   alphabetical order (so `detect()` priority is deterministic).
2. For each scan target, routing precedence is: explicit provider match
   first (bypasses detect), then each provider's `detect()` in load order —
   first non-null hit wins.

Underscore-prefixed files are shared helpers, never loaded as providers:
`_http.mjs` (safe HTTP transport with SSRF guards), `_registry.mjs`
(loader/router), `_html-entities.mjs`, `_html-to-text.mjs` (description HTML
→ plain text), `_config-utils.mjs`, `_ip-guard.mjs`, `_trust-validator.mjs`,
`_profile-keywords.mjs`.
