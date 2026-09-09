# AI Agent Guidelines (`AGENTS.md`)

This document defines behavioral constraints, critical invariants, and internal subsystem mechanics for AI agents working in this repository. For general setup and developer guides, refer to [DEVELOPMENT.md](DEVELOPMENT.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [README.md](README.md).

---

## 1. Prime Directives for AI Agents

1. **Strict Invariant: No Backend Scraping**
   - Never implement outbound job-board scraping, fetching, or liveness checks inside `server/`.
   - If a backend service requires page content or liveness info, it must enqueue a typed task (`FETCH_JOB_PAGE`, `CHECK_LIVENESS`) into the SQLite `relay_tasks` queue for the browser extension to lease and execute.

2. **Zero-Token ATS Extraction**
   - All job board connectors (`extension/src/background/providers/` and `extension/src/content/extractors/`) must adhere to zero-token extraction: extract structured data via public ATS JSON endpoints, JSON-LD schemas, or DOM parsing. Never introduce LLM calls to parse job listings.

3. **Truthful Resume Tailoring**
   - The LangGraph tailoring pipeline (`server/tailor`) must only re-rank, highlight, or truthfully rephrase genuine candidate experiences from `master-resume.json`. Never hallucinate skills, metrics, dates, or qualifications not present in the candidate profile.

4. **Preserve Vendored Provider Hashes**
   - Files in `extension/src/background/providers/` are lifted from upstream toolkits. Do not reformat or modify them unnecessarily to maintain synchronization integrity.

---

## 2. Internal Subsystems & Gotchas

### 2.1 Process Coordination & Port Mapping

Within containers and production deployments, `supervisord` coordinates services behind the public ingress port (`8080`):

- **Ingest API & SPA** (`:8080`, managed by Supervisor): Serves the React SPA, SQLite DB, auth, SimHash dedup, and the task relay queue.
- **Fit Scorer** (`:8001`, internal only): Evaluates JDs against candidate resumes.
- **Resume Tailor** (`:8081`, internal only): LangGraph section-by-section tailoring engine (`resume_ops_api`).
- **Gatepass Proxy** (`:8318`, internal only): Go reverse proxy with token-bucket rate limiting (20 RPM) and SQLite prompt auditing (`/data/gatepass.db`). All backend LLM requests must route through `:8318`.

### 2.2 Companion Task Relay & SSRF Guardrails

When modifying the task relay (`server/ingest/src/relay/` or `extension/src/background/relay.js`):

- Tasks are leased atomically using `lease_token` and `lease_expires_at` to prevent race conditions across multi-tab instances.
- **SSRF Invariant**: In `extension/src/background/safe-url.js`, `assertSafeDestination()` blocks loopback, private IPv4/IPv6 ranges (including IPv4-mapped IPv6 `::ffff:127.0.0.1` and CGNAT `100.64.0.0/10`), link-local, and `.internal`/`.local` TLDs.
- Never use native automatic redirect following (`fetch` with default `redirect: 'follow'`). Always use `fetchWithSafeRedirects()`, which validates destination safety on every single redirect hop.

### 2.3 PDF Toolchain & Headless Rendering

- Resume PDFs are compiled via `folio-export` (CLI of `jsonresume-theme-folio` powered by Puppeteer).
- The print layout engine uses CSS rules (`break-after: avoid` on section headings, `break-inside: avoid` on experience entries) to eliminate orphaned headers.
- Always verify generated output by checking for the `%PDF-` magic byte header before persisting artifacts.

---

## 3. Pre-Commit Verification

Before committing changes, ensure that all tests and lint checks pass across the repository:

```bash
# Run root integration suite and metadata checks
npm test

# Run extension & companion relay tests
npm --workspace=extension test

# Run ingest server tests
npm --workspace=server/ingest test

# Run web frontend tests
npm --workspace=server/web test

# Run Python test suites
(cd server/scorer && uv run pytest)
(cd server/tailor && uv run pytest)

# Verify styling & linting
npm run format:check
npm run lint
```
