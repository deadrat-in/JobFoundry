# Adding a provider

A provider is a module `providers/{name}.mjs` that maps one public, no-auth
job source (an ATS API, an RSS/JSON feed, or a server-rendered HTML page) to
the extension's normalized `Job` shape. Providers run inside the browser
extension's background service worker and are discovered automatically —
dropping the file in `providers/` plus regenerating the static index is
enough (section 6).

Where a provider sits in the pipeline (`extension/src/background/scan.js`):

```
providers → liveness → normalize → first-pass dedup → ingest API
```

`scan.js` resolves each configured scan target to a provider
(`resolveProvider`: an explicit `provider:` id wins, otherwise the first
matching `detect()`), calls `fetch(entry, ctx)`, drops expired listings via
the extension-side liveness check, normalizes and dedups, and ships the
survivors to your local ingest API (`POST /api/v1/jobs/ingest`). Targets are
configured in the extension (dashboard scan list / options) — there is no
server-side portal file, because the server never scrapes (architectural
invariant).

> **Attribution.** A subset of this provider layer is adapted from the
> MIT-licensed [career-ops](https://github.com/career-ops) provider
> collection. Those files keep their original MIT headers. Browser-incompatible
> modules are ported (never edited in place) — see
> [`scripts/ports/README.md`](../../../scripts/ports/README.md). `README.md`
> (this directory) and this guide are JobFoundry-owned and are excluded from
> re-vendoring (see `PRESERVED_DOCS` in `scripts/vendor.mjs`).

## Before the code: is the source eligible?

JobFoundry's position is simple and non-negotiable: **reading a public job
posting must never cost an LLM call.** Providers extract structured data from
public ATS JSON endpoints, feeds, or markup. Anything that needs a model (fit
scoring, resume tailoring) happens later, on the local server, against jobs
already captured.

A source is eligible when **all** of these hold:

- **Public, no-auth.** Open API/feed or server-rendered page. No login, no
  session cookies, no paywall on listings or applications. A source that
  requires the user's authenticated session belongs in the in-page DOM
  extractors (`src/content/extractors/`, e.g. LinkedIn/Indeed/Glassdoor),
  not here.
- **Real, employer-attributed listings.** Postings resolve to identifiable
  employers a candidate can apply to directly.
- **One source per provider.** A provider reads its own source — not a
  meta-aggregator republishing other boards.

A **single-company ATS adapter** (a new Greenhouse/Workday/Ashby-class vendor,
or one company on its own careers API) clears this by construction. A **job
board, aggregator, or talent network** needs a second look: full inventory
traversal (not a promoted/default-filtered view), no paid placement. If
eligibility is borderline, open an issue with a sample posting URL before
writing code — a routing decision on a design doc is cheaper than one on a
finished PR.

## 1. The contract

A `providers/{name}.mjs` file (not starting with `_` — those are shared
helpers the index generator skips, as is the `helpers.mjs` test helper) has a
`default` export:

```js
export default {
  id: 'greenhouse',          // required, unique across all providers
  detect(entry) { ... },     // optional: claim a scan target
  async fetch(entry, ctx) { ... }, // required: return Job[]
};
```

- `detect(entry)` — optional; returns `{ url }` (or a truthy hit) to claim
  the target, `null` to pass. Three valid shapes: (1) URL-pattern match
  against `entry.careers_url`; (2) explicit-only — match `entry.provider`
  against your `id`, no URL needed (reachable only when a scan target names
  you); (3) omit `detect()` entirely — same reachability as (2).
  `detect()` must **never throw** on junk input — return `null`.
- `fetch(entry, ctx)` — required; returns an array of normalized jobs:
  `{ title, url, company, location, description, postedAt }`
  (`postedAt` as epoch ms; `description` as plain text — use `htmlToText`
  from `_html-to-text.mjs` for HTML descriptions). Rows missing a required field (`title`,
  `url`) are filtered out, never thrown.
- `entry` — the scan target: `{ name, careers_url?, api?, provider?,
  max_pages? }`. Treat every field as untrusted user input.
- `ctx` — built by `makeHttpCtx()` (`providers/_http.mjs`): `{ transport,
  fetchJson, fetchText, fetchResponse }`. Always go through `ctx` (or the
  retry wrappers below) — never raw `fetch()`. Retry, pacing, and text
  helpers are imported from their modules, not carried on `ctx`:
  `fetchJsonWithRetry` / `fetchTextWithRetry` / `sleep` from `_http.mjs`,
  `htmlToText` from `_html-to-text.mjs`.

Mirror an existing module of the same shape — see the table in section 5.

## 2. Mandatory guards

### SSRF hardening (MUST)

All outbound traffic goes through the shared transport (`_http.mjs` +
`../safe-url.js`). Two rules:

- **Never bypass the transport.** No raw `fetch()`, no redirect options of
  your own. The port pins `redirect: 'manual'` and refuses every 3xx /
  `opaqueredirect` itself — that refusal *is* the SSRF trust guard (a
  redirect to any host, trusted or not, is never followed). Do not pass
  `redirect:` in per-call options; do not implement redirect-following.
- **Allowlist before request when the URL is config-derived.** If the final
  URL is built from `entry.api` / `entry.careers_url`, validate the hostname
  against an allowlist **before** any network call: parse the URL (throws if
  malformed → treat as no-match), reject non-`https:`, reject a hostname not
  in the allowlist. Reference: `assertGreenhouseUrl` in
  `providers/greenhouse.mjs`. A test must prove the guard runs before
  `ctx.fetchJson` / `ctx.fetchText`. If the whole URL is assembled from a
  fixed literal host, no allowlist is needed.

### Defensive parsing

A `fetch()` that throws fails **that scan target** — other targets still run
(the pipeline fetches targets independently), but a whole employer lost to
one malformed row is a bug. So a malformed item is a `continue` / `null` +
`.filter`, never an exception:

- Empty or contentless body (`null`, `{}`, `[]`, `{jobs: null}`) — "endpoint
  alive, nothing matched" → return `[]`.
- A body whose structure is recognisably *not* what the endpoint documents
  (expected container absent or wrong-typed, keys entirely different) → a
  descriptive `throw` naming the keys you got is allowed and usually better:
  it surfaces a silent API change instead of a board quietly returning `0`
  forever. Reference: `parseIbmResponse` in `providers/ibm.mjs`.
- Dates: `Date.parse` can return `NaN`, and `Date.parse(s) || undefined`
  also nulls a valid epoch `0`. Use a NaN-safe helper:

  ```js
  function toEpochMs(value) {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  ```

### URL-encoding a host-controlled `id` / `slug`

When `job.url` is built from a response field (`id`, `slug`, `refnr`) inside
a loop, bare `encodeURIComponent` can throw `URIError` on a lone UTF-16
surrogate — and that throw leaves the loop and loses every posting parsed so
far on that page. Guard it: wrap the encode in try/catch (drop exactly the
bad posting on failure) or validate the segment against a slug charset
first. The mirror case on decode: `decodeURIComponent` on a scraped href
segment throws on malformed escapes (`%ZZ`) — wrap in try/catch with a
fallback to the raw segment (reference: `workday.mjs`, `successfactors.mjs`).

### HTML entities — use the shared decoder

If the provider parses HTML/XML (not a JSON API), decode entities (`&amp;`,
`&#252;`) through `providers/_html-entities.mjs`:

```js
import { decodeEntities } from './_html-entities.mjs';
```

Never write a local copy. Decode *before* any keyword matching — an encoded
`&amp;` must not drop a matching job.

### Absolute page ceiling (MUST)

For a paginating provider, the page count must **never** come from what the
source reports (`pagination.pageCount`, `total`) alone — untrusted
third-party data plus no per-provider timeout equals a potential unbounded
request loop. Define your own constant:

```js
const DEFAULT_MAX_PAGES = 100;  // when the entry sets no max_pages
const MAX_PAGES_CAP = 1500;     // hard ceiling even for a user override
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}
```

A source-reported value enters the formula only through `Math.min(...)`
with this ceiling, never on its own. Reference: `providers/workday.mjs`.
When the ceiling truncates the list, warn the user (raise `max_pages` on
this target) so a partial list is not mistaken for a complete one. A
source-reported `total` can also be silently clamped — a `total`-bounded
walk is not proof of completeness.

### Pacing and retry (paginating providers)

A full walk of a large board is 100+ sequential requests, and several
sources sit behind burst rate-limiting WAFs. Two mechanisms, both expected
once a provider paginates:

- **Inter-page delay.** A module constant applied only to pages past the
  first: `if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx)`. Import
  `sleep` from `_http.mjs` — don't hand-roll a copy. 150–250 ms is the
  norm; raise it only where throttling was actually observed or a published
  rate limit dictates it. Don't gold-plate a feed that never complained.
- **Bounded retry.** Wrap every page fetch in `fetchJsonWithRetry(ctx, url,
  opts, policy?)` / `fetchTextWithRetry(...)` (`_http.mjs`). They retry
  429, any 5xx, and transport errors with exponential backoff + jitter;
  never a non-429 4xx or a refused redirect. `Retry-After` is honoured but
  clamped. Default policy is `{ retries: 2, baseDelayMs: 500, maxDelayMs:
  8_000 }`; pass a 4th-argument `policy` for a different cadence
  (`workday.mjs`, `oraclecloud.mjs` use `{ retries: 3 }`, WAF-fronted).

**Exhaustion is your call.** The helper rethrows with `.attempts` set to
the real request count. Decide per provider: keep the pages collected and
warn (`workday.mjs`), or fail loud rather than hand back a silent partial
board (`a16z-speedrun-talent.mjs`). Either way, the "raise `max_pages`"
warning must **not** fire on a fetch-error stop — that message means the
ceiling truncated a healthy board, not that the board broke.

### Timeouts and User-Agent

Use `_http.mjs` — it already has the `AbortController` timeout (10 s
default; raise per-call with `timeoutMs` for a slow feed) and the shared
User-Agent; a non-2xx response throws carrying `.status`, `.body`, and
`.retryAfter`. If the source blocks the default UA through a WAF/CDN, use
`BROWSER_LIKE_USER_AGENT` from `../user-agent.mjs` — do not add your own
constant.

## 3. Browser constraints (this is not Node)

Providers execute in the extension service worker. The following are hard
errors at runtime — the ports in `scripts/ports/` exist precisely because
upstream modules tripped them:

- No `node:*` imports (`node:crypto`, `node:dns`, `node:fs`,
  `node:child_process`). Need randomness? `globalThis.crypto.randomUUID()`
  with a `Math.random` fallback (reference: the `alibaba.mjs` /
  `radancy.mjs` ports). Need to run a local command? Impossible — see
  `local-parser.mjs`, whose `detect()` returns `null` and whose `fetch()`
  throws a clear error by design.
- No top-level `Buffer` usage (`ReferenceError: Buffer is not defined` at
  evaluation time kills the whole provider registry import — reference: the
  `mokahr.mjs` port).
- No filesystem reads. Upstream's profile-keyword resolution from
  `config/profile.yml` is a documented no-op here (reference: the
  `_profile-keywords.mjs` port).

If your source truly cannot be read over plain HTTPS from a background
worker, stop and propose a content-script DOM extractor instead of bending
these rules.

## 4. Tests

One file: `providers/tests/{name}.test.mjs`, in the same plain-script
pass/fail style as the other lifted tests — `extension/test/providers.test.mjs`
spawns every file in that directory in its own process and counts `❌`
markers, so nothing needs registering. RSS/HTML providers should export
their pure parser function for direct unit testing.

Don't re-prove the shared helpers (`_html-entities.mjs`, `_http.mjs`) —
their own tests cover that. A provider test checks only that *this
provider's* output went through them. Must cover:

- The provider `id`, and `detect()`: positive cases plus untrusted host,
  non-HTTPS, malformed URL, `null` / non-string / missing `careers_url` →
  `null` (no throw). For explicit-only providers: an `entry.provider`
  match returns `{ url }` with no URL fields present; anything else →
  `null`.
- `fetch()`: normalization of the source's real response shape; rows
  missing a required field are filtered; the hostname allowlist (if any)
  throws **before** `fetchJson` / `fetchText` is called.
- Empty or contentless body → `[]`; a body whose shape isn't the
  documented one → a descriptive throw. Assert both branches.
- Pagination (if any): your own `DEFAULT_MAX_PAGES` stops the walk even
  when the source reports more pages.
- Pagination + transient failure (if any): a 429 / 5xx mid-walk either
  keeps collected pages and warns, or fails loud — whichever your provider
  chose — and the "raise `max_pages`" warning does *not* fire on that
  fetch-error stop.
- HTML parsing (if any): a fixture title with an entity comes out decoded
  *before* any keyword matching runs.

Fixture values that actually reach the call (`name` / `careers_url` /
`api`) are fictional (`Acme`, `ExampleCo`, `BigCo`) — never real companies.
A comment citing real observed data (e.g. why a page-limit constant was
chosen) is welcome — it documents that the number is not arbitrary.

Dev loop: `npm --workspace=extension test` (runs `node --test
test/*.test.mjs`, which includes the inventory check and every lifted
provider test). Before a PR, the full repo suite must be green
(`npm test` at the root plus the Python suites — see `CONTRIBUTING.md`).

## 5. Reference modules

| What you need | Example |
|---|---|
| Simple JSON API, no pagination | `providers/greenhouse.mjs` |
| Pagination with ceiling + retry override | `providers/workday.mjs` |
| HTML scraping with the shared `decodeEntities` | `providers/icims.mjs` |
| SSR JSON inside HTML (`__NEXT_DATA__`) | `providers/join.mjs` |
| RSS parsed in-process | `providers/larajobs.mjs` |
| Retry/backoff, default policy | `providers/a16z-speedrun-talent.mjs`, `providers/getro.mjs` |
| Retry/backoff, policy override (WAF-fronted) | `providers/workday.mjs`, `providers/oraclecloud.mjs` |
| Detecting a clamped `total`, recovering via query fan-out | `providers/workday.mjs` (facet split) |

`fetchJsonWithRetry` / `fetchTextWithRetry` (`providers/_http.mjs`) take
`(ctx, url, opts?, policy?)` — `policy: { retries, baseDelayMs,
maxDelayMs }` tunes a provider whose needs differ from the shared default
(`{ retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 }`).

## 6. Pre-PR checklist

- [ ] `id` unique; file does not start with `_`; default export carries the
      `id` (the index generator hard-errors otherwise).
- [ ] Regenerated the static index: `node extension/scripts/gen-provider-index.mjs`
      (also runs automatically as a pretest step — never commit a stale
      `providers/index.js`).
- [ ] Inventory counts bumped in `extension/test/providers.test.mjs`
      (currently 95 modules / 93 lifted tests / 87 registry ids) — CI
      asserts them exactly.
- [ ] `detect()` never throws on junk input; returns `null` instead.
- [ ] No raw `fetch()`, no `redirect:` options, no `node:*` imports, no
      top-level `Buffer`. Config-derived URLs pass an allowlist before the
      request.
- [ ] `fetch()` returns `[]` on an empty or contentless body; throws on a
      real API error or an undocumented envelope. A single bad row is
      skipped, not fatal to the target.
- [ ] Dates are NaN-safe (`toEpochMs` pattern).
- [ ] HTML/XML entities go through `providers/_html-entities.mjs`, not a
      local copy.
- [ ] URL segments built from host-controlled fields are encode-guarded
      (try/catch or charset check); scraped href segments passed to
      `decodeURIComponent` fall back to the raw segment.
- [ ] Pagination has its own `DEFAULT_MAX_PAGES` — the page count is never
      decided by the source alone.
- [ ] Paginating: inter-page delay via the shared `sleep` (pages past the
      first only); page fetches wrapped in the retry helpers; a stated
      exhaustion policy that doesn't misfire the "raise `max_pages`"
      warning.
- [ ] `providers/tests/{name}.test.mjs` covers everything in section 4.
- [ ] Full suite green: `npm --workspace=extension test` (plus root
      `npm test` before opening the PR).
- [ ] Docs site directory updated: a row in `providersList` in
      `site/src/components/ProvidersDirectory.astro` (alphabetical by
      board name within its category).
- [ ] **Editing an existing provider, not adding one?** The docs-site row
      above is "keep in sync on change". If the fix changes observable
      behavior (pagination, defaults, URL format, what counts as an error
      or an empty board), `grep` the repo for every prose description of
      that behavior — by provider name and by substance, not just function
      names — and fix them in the same PR.
