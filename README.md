# JobFoundry

A unified, AGPL-licensed pipeline for job search → fit scoring → resume tailoring → PDF/ATS export, with a modern web dashboard. Built from scratch; MIT-licensed components lifted from `career-ops` and `jobs-auto-apply` where compatible.

> **Architectural invariant (non-negotiable):**
> The JobFoundry server never performs outbound job-board scraping. All scraping and job-board HTTP requests originate from the user's browser extension.
>
> Corollary: anything that makes an outbound job-board request (providers, liveness checks) lives in the extension. The server only receives already-scraped jobs, and its only outbound calls are to LLM providers (fit scoring / tailoring) and the local resume-ops API.

## Architecture

```
                               ┌────────────────────────────────────────────────┐
                               │               Browser Extension                │
                               │  (84 Providers + Passive/Active DOM Extract)   │
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
                                               │      Local resume-ops API      │
                                               │   (Multi-Theme PDF & ATS Gen)  │
                                               └────────────────────────────────┘
```

## Repo layout

```
extension/        Browser extension (Chrome MV3 / Firefox MV2 / Android)
server/
  ingest/         Node/ESM ingest API + SQLite + authoritative SimHash dedup
  scorer/         Python fit screener + resume-ops tailoring bridge
  web/            Vite + React dashboard with real-time job feed & kanban
compose.yaml      Docker Compose orchestration
scripts/          Healthcheck and repository validation utilities
test/             End-to-end integration test suite
```

## Quickstart

### 1. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` to set your API keys and optional LLM provider configuration.

### 2. Start the Stack with Docker Compose

```bash
docker compose up --build -d
```

Verify all services are up and healthy:

```bash
./scripts/healthcheck.sh
```

- **Web Dashboard**: http://localhost:5173
- **Ingest API**: http://localhost:8080
- **Scorer Service**: http://localhost:8001

### 3. Build & Install Browser Extension

Build release packages for Chrome and Firefox:

```bash
npm --workspace=extension run build:release
```

#### Chrome / Chromium:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `extension/dist/chrome/`.

#### Firefox (Desktop & Android):

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...** and select `extension/dist/firefox/manifest.json` (or install `extension/dist/firefox.xpi`).
3. Click the JobFoundry extension icon to configure server URL (`http://localhost:8080`) or auto-pair.

---

## Testing & Verification

Run the entire monorepo test suite:

```bash
# Run unit, workspace, and E2E integration tests
npm test

# Run Python scorer and tailoring test suite
cd server/scorer && uv run pytest

# Run Web dashboard unit tests
npm --workspace=server/web test

# Run Extension unit tests
npm --workspace=extension test
```

## Execution plan

Every phase of this project is planned atomically (test-first, with acceptance criteria) in [`Scratch/plan/`](Scratch/plan/README.md). Read [`Scratch/plan/README.md`](Scratch/plan/README.md) for the phase index and dependency graph, and [`Scratch/plan/TESTING.md`](Scratch/plan/TESTING.md) for test conventions.

## License

[GNU Affero General Public License v3.0](LICENSE)
