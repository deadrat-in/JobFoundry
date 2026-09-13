# Architecture

This document describes how JobFoundry fits together: the pipeline stages,
the components, the data flow, and the design principles that constrain every
contribution. For setup instructions see [DEVELOPMENT.md](DEVELOPMENT.md);
for the user-facing story see [README.md](README.md).

## The pipeline in one picture

```
                        ┌────────────────────────────────────────────────┐
                        │               Browser Extension                │
                        │  (87 Providers + Passive/Active DOM Extract)   │
                        └──────────────────────┬─────────────────────────┘
                                               │ POST /api/v1/jobs/ingest
                                               ▼
┌───────────────────────────────┐              ┌────────────────────────────────┐
│         Web Dashboard         │◄────────────►│         Ingest Server          │
│     (Vite + React 19 SPA)     │   REST API   │   (Fastify + SQLite + Dedup)   │
└───────────────────────────────┘              └──────────────┬─────────────────┘
                                                               │
                                                               ▼
                                                ┌────────────────────────────────┐
                                                │   Fit Scorer & Tailor Worker   │
                                                │   (FastAPI + LiteLLM + Bridge) │
                                                └──────────────┬─────────────────┘
                                                               │
                                                               ▼
                                                ┌────────────────────────────────┐
                                                │    Resume tailoring engine     │
                                                │ (LangGraph + folio-export PDF) │
                                                └────────────────────────────────┘
```

Five stages, each independently understandable and replaceable:

1. **Browser ingestion** (`extension/`) — capture listings inside the user's
   own browser session.
2. **Ingest + dedup** (`server/ingest/`, `:8080`) — receive, normalize,
   SimHash-deduplicate, store in SQLite.
3. **Fit scoring** (`server/scorer/`, `:8001` internal) — score each JD
   0–100 against the master resume via the configured LLM provider.
4. **Resume tailoring** (`server/tailor/`, `:8081` internal) — truthfully
   tailor the master resume per job; render PDF + ATS plaintext.
5. **Dashboard** (`server/web/`) — Kanban pipeline, feed, filters, resume
   manager, diff view, application tracking.

## Components

| Component         | Stack                                            | Listens            | Responsibility                                                                      |
| ----------------- | ------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------- |
| Ingest API + SPA  | Fastify 5, better-sqlite3, React 19 SPA (static) | `:8080` (public)   | Job ingest, SimHash dedup, auth, relay queue, settings, artifact hosting, dashboard |
| Fit scorer        | FastAPI, LiteLLM, instructor, Pydantic           | `:8001` (loopback) | Poll SQLite queue, score JD vs resume, structured JSON verdict                      |
| Tailor engine     | FastAPI, LangGraph, LiteLLM, folio-export        | `:8081` (loopback) | Section-by-section tailoring, schema validation, PDF/ATS render                     |
| Browser extension | WXT MV3 (Chrome + Firefox)                       | —                  | Capture, liveness, relay leasing, passive/active extraction                         |
| Docs site         | Astro (static)                                   | GitHub Pages       | `site/` source → `site/dist/` build, deployed as a Pages artifact                   |

In containers and packaged builds, `supervisord` runs ingest (`:8080`),
scorer (`:8001`), and tailor (`:8081`) behind the single public ingress
port. Internal services bind loopback-only.

## Design principles

### 1. The server never scrapes (non-negotiable invariant)

> The JobFoundry server never performs outbound job-board scraping. All
> scraping and job-board HTTP requests originate from the user's browser
> extension.

Anything that touches a job board — providers, liveness checks, page
fetches — lives in `extension/`. The server only receives already-captured
jobs; its only outbound calls are to LLM providers and the local tailor
engine. If a backend service needs page content, it enqueues a typed task
(`FETCH_JOB_PAGE`, `CHECK_LIVENESS`) into the SQLite `relay_tasks` queue,
which extension instances lease and execute (`server/ingest/src/relay/` +
`extension/src/background/relay.js`, atomic `lease_token` handoff).

**Why.** This is a reliability decision first, a privacy decision second:

- _Reliability:_ server scrapers die against Cloudflare, CAPTCHAs, login
  walls, and IP blocks. Capture inside the user's authenticated browser
  session succeeds where datacenter IPs fail. The author can use a terminal
  and still chose the browser — because it works more often.
- _Privacy:_ browsing cookies and session headers never leave the machine;
  no server IP is ever at risk of being flagged.

### 2. Zero-token extraction (our philosophy)

Reading a public job posting must never cost an LLM call. Providers pull
structured data from public ATS JSON endpoints, JSON-LD schemas, RSS feeds,
or DOM parsing — no model involved. LLM spend is reserved for what actually
needs judgment: fit scoring and resume tailoring, run later against jobs
already captured. This keeps discovery fast, free, and private, and it
keeps the tool usable without any AI subscription.

A subset of the provider layer is adapted from the MIT-licensed career-ops
provider collection (headers preserved; browser-incompatible modules are
ported, never edited in place — see
`extension/scripts/ports/README.md`). The philosophy itself is ours; the
attribution covers only the lifted files.

### 3. Truthful tailoring

The LangGraph tailoring pipeline re-ranks, highlights, and truthfully
rephrases genuine candidate experience from `master-resume.json`. It never
invents skills, metrics, dates, or qualifications. Protected fields
(contact details, titles, companies, dates, degrees) are immutable; output
is schema-validated before a PDF is rendered. A tailored resume that
fabricates is worse than no resume — it fails background checks and burns
the candidate's credibility.

### 4. Local-first storage

Resumes, job records, scores, and artifacts live in a local SQLite file
(`data/jobfoundry.db`) or a self-hosted database. No accounts, no telemetry,
no cloud sync that compromises ownership. API keys stay on the backend and
are never exposed to the extension. Git history of the repo is the
versioning system for code; your data directory is yours to back up, move,
or delete.

### 5. Human-in-the-loop

JobFoundry prepares and prioritizes; the human reviews and clicks. It never
auto-submits applications. Scoring thresholds and recommendations are
advisory — the candidate decides what to pursue.

## Extension internals

- `src/background/` — service worker: `scan.js` pipeline (providers →
  liveness → normalize → first-pass dedup → ingest client), `relay.js`
  task leasing, `safe-url.js` SSRF guard (`assertSafeDestination`,
  `fetchWithSafeRedirects` — loopback, private ranges, CGNAT, link-local,
  and `.internal`/`.local` blocked; redirects validated per hop, never
  followed blindly), `providers/` (87 adapters + shared helpers).
- `src/content/` — in-page extractors: `passive.js` / `active.js` plus
  targeted `extractors/` (ATS generics, Glassdoor, Indeed, LinkedIn,
  Naukri) for session-gated boards providers can't reach.
- `src/entrypoints/` — popup, options, sidepanel, dashboard, background,
  content registrations.
- `src/shared/` — config, ingest client, cross-context messaging.

## Data flow (happy path)

1. User browses normally; the extension captures a posting (provider fetch
   or DOM extraction) and `POST`s it to `/api/v1/jobs/ingest` with the
   local API key.
2. Ingest normalizes, fingerprints (64-bit SimHash), and dedups (Hamming
   distance ≤ threshold → canonical record kept, source breadcrumb added).
3. The scorer worker polls the queue, calls the configured LLM endpoint
   (OpenRouter / OpenAI / Anthropic / local Ollama / vLLM), and stores a
   structured verdict: `fitScore` 0–100, `matchGrade`, `keyStrengths`,
   `gapAnalysis`, `recommendation`.
4. On request (or automatically above a threshold), the tailor engine runs
   the LangGraph pipeline — strategy node, parallel section nodes, merge
   node with schema validation — then renders PDF via `folio-export`
   (Puppeteer + `jsonresume-theme-folio`) and an ATS plaintext variant.
5. The dashboard shows scored jobs on the Kanban board; the candidate
   reviews, downloads artifacts, and tracks applications.

## Repository map

```
extension/        Browser extension (WXT MV3, Chrome + Firefox)
server/ingest/    Fastify API, SQLite, auth, SimHash dedup, relay queue
server/scorer/    FastAPI fit screener + worker daemon (LiteLLM)
server/tailor/    LangGraph resume engine + folio-export PDF bridge
server/web/       React 19 dashboard (Kanban, feed, resume manager)
site/             Astro docs site source (builds to docs/ for Pages)
docs/             Built static site — do not edit by hand
scripts/          healthcheck, metadata checks, career-ops import
test/             Multi-service E2E + metadata assertions
packaging/        AppImage (Linux), MSIX (Windows) builders
```

For AI-agent-specific constraints (port map, SSRF rules, PDF toolchain
gotchas, pre-commit commands), see [.agents/AGENTS.md](.agents/AGENTS.md).
