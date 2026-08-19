# JobFoundry

[![CI](https://github.com/anubra266/jobfoundry/actions/workflows/ci.yml/badge.svg)](https://github.com/anubra266/jobfoundry/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/anubra266/jobfoundry/actions/workflows/pages.yml/badge.svg)](https://github.com/anubra266/jobfoundry/actions/workflows/pages.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Local First](https://img.shields.io/badge/Privacy-100%25%20Local--First-emerald.svg)](docs/privacy.html)

A unified, AGPL-licensed pipeline for job search → fit scoring → resume tailoring → PDF/ATS export, with a modern web dashboard. Built from scratch; MIT-licensed components lifted from `career-ops` and `jobs-auto-apply` where compatible.

📚 **[Explore the Documentation & Guides](docs/index.html)** &bull; 🚀 **[Quickstart Onboarding Guide](docs/welcome.html)** &bull; 🔒 **[Privacy & Invariants](docs/privacy.html)**

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
docs/             Documentation portal & GitHub Pages static website
extension/        Browser extension (Chrome MV3 / Firefox MV2 / Android)
server/
  ingest/         Node/ESM ingest API + SQLite + multi-tenant auth + SimHash dedup
  scorer/         Python fit screener + resume-ops tailoring bridge + worker
  web/            Vite + React dashboard with real-time job feed & kanban tracker
compose.yaml      Docker Compose orchestration
scripts/          Healthcheck and repository validation utilities
test/             End-to-end integration test suite
```

## Quickstart

### 1. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` to set your API keys and optional LLM provider configuration (OpenAI, Anthropic, or local Ollama).

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
- **Documentation**: [`docs/index.html`](docs/index.html)

### 3. Build & Install Browser Extension (WXT MV3)

Build packages for Chrome and Firefox:

```bash
# Chrome / Edge / Brave (MV3)
npm --workspace=extension run build

# Firefox (MV3)
npm --workspace=extension run build:firefox

# Or live dev mode with automatic reloading
npm --workspace=extension run dev
```

#### Chrome / Chromium / Brave / Edge:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `extension/.output/chrome-mv3/`.

#### Firefox (Desktop & Android):

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...** and select `extension/.output/firefox-mv3/manifest.json`.
3. Click the JobFoundry extension icon to configure server URL (`http://localhost:8080`) and your user API key.

---

## Multi-User & Resume Workflow

1. **Register / Login**: Open the web dashboard and create your account. An isolated workspace and API key will be generated.
2. **Master Resume**: In the **Resume Manager** tab, upload or paste your master [JSON Resume](https://jsonresume.org/).
3. **Ingest Jobs**: View jobs on any job board; the extension captures listings passively or via 84+ active providers.
4. **Fit Scoring & Tailoring**: Inspect AI fit scores, missing requirements, and download your tailored multi-theme PDF or ATS-optimized plaintext resumes.

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

# Run linter and formatting checks
npm run lint
npm run format:check
```

## Execution plan

Every phase of this project is planned atomically (test-first, with acceptance criteria) in [`Scratch/plan/`](Scratch/plan/README.md). Read [`Scratch/plan/README.md`](Scratch/plan/README.md) for the phase index and dependency graph, and [`Scratch/plan/TESTING.md`](Scratch/plan/TESTING.md) for test conventions.

## License

[GNU Affero General Public License v3.0](LICENSE)
