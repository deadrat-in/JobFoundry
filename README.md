# JobFoundry

[![CI](https://github.com/deadrat-in/JobFoundry/actions/workflows/ci.yml/badge.svg)](https://github.com/deadrat-in/JobFoundry/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/deadrat-in/JobFoundry/actions/workflows/pages.yml/badge.svg)](https://github.com/deadrat-in/JobFoundry/actions/workflows/pages.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Privacy: Local-First](https://img.shields.io/badge/Privacy-Local--First-emerald.svg)](docs/privacy.html)

JobFoundry is an open-source, local-first platform designed to simplify job discovery, fit assessment, and resume tailoring. It pairs a privacy-respecting browser extension with a lightweight local server and web dashboard, keeping your data entirely under your control.

📚 **[Documentation & Guides](docs/index.html)** &bull; 🚀 **[Quickstart Guide](docs/welcome.html)** &bull; 🛠️ **[Development Guide](DEVELOPMENT.md)** &bull; 🤝 **[Contributing](CONTRIBUTING.md)** &bull; 🔒 **[Privacy & Security](SECURITY.md)**

---

## Architectural Invariant

> **Architectural invariant (non-negotiable):**
> The JobFoundry server never performs outbound job-board scraping. All scraping and job-board HTTP requests originate from the user's browser extension.
>
> Corollary: anything that makes an outbound job-board request (providers, liveness checks) lives in the extension. The server only receives already-scraped jobs, and its only outbound calls are to LLM providers (fit scoring / tailoring) and the local resume-ops API.

---

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

---

## Repository Layout

```
docs/             Documentation portal & GitHub Pages static website
extension/        Browser extension (Chrome MV3 / Firefox MV3 & MV2)
server/
  ingest/         Node/ESM ingest API, SQLite storage, auth, SimHash dedup
  scorer/         Python fit screener & worker daemon polling SQLite queue
  tailor/         Python resume-ops engine (LangGraph + resumed / Puppeteer PDF & ATS)
  web/            Vite + React 19 web dashboard (Kanban board, feed, resume manager)
Dockerfile        Multi-stage All-in-One container build
compose.yaml      Docker Compose single-service configuration
supervisord.conf  Process supervisor configuration
install.sh        Single-command curl installer script
scripts/          Healthcheck and repository verification utilities
test/             End-to-end multi-service test suite
```

---

## Quickstart (Single-Command Install)

To install and launch the complete JobFoundry stack with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/Rat-S/JobFoundry/main/install.sh | bash
```

This script:

1. Validates Docker & Docker Compose prerequisites.
2. Clones or updates the JobFoundry stack.
3. Automatically creates `.env` with a secure generated API key.
4. Pulls or builds the **All-in-One container** and launches it in the background.
5. Verifies service health via `./scripts/healthcheck.sh`.

---

## Getting Started (Manual)

### 1. Prerequisites

- **Docker & Docker Compose** (recommended for containerized run)
- Or for bare-metal development:
  - **Node.js**: v22+
  - **Python**: 3.12+ (or [uv](https://docs.astral.sh/uv/))

### 2. Configure Environment

```bash
cp .env.example .env
```

Review `.env` to configure your preferred LLM provider (OpenRouter, OpenAI, Anthropic, or local Ollama) and secret keys.

### 3. Running with Docker / Docker Compose

Run with Docker Compose:

```bash
docker compose up -d
```

Or run directly with Docker (no Compose needed):

```bash
docker run -d -p 8080:8080 -v jobfoundry-data:/data --env-file .env ghcr.io/rat-s/jobfoundry:latest
```

Verify service health:

```bash
./scripts/healthcheck.sh
```

- **Web Dashboard & Ingest API**: [http://localhost:8080](http://localhost:8080)
- **Browser Extension Guide**: [https://deadrat-in.github.io/JobFoundry/extension.html](https://deadrat-in.github.io/JobFoundry/extension.html)

### 4. Running Locally for Development

```bash
# Install root & workspace dependencies
npm install

# Start Ingest Server
npm --workspace=server/ingest run dev

# Start Scorer Service
cd server/scorer && uv run uvicorn src.app:app --port 8001 --reload

# Start Tailor Service (resume-ops)
cd server/tailor && uv run python -m resume_ops_api

# Start Web Dashboard
npm --workspace=server/web run dev
```

---

## Browser Extension Setup

### Build from Source

```bash
# Build for Chromium browsers (Chrome, Edge, Brave)
npm --workspace=extension run build

# Build for Firefox
npm --workspace=extension run build:firefox

# Or start live development with hot-reloading
npm --workspace=extension run dev
```

### Installation

- **Chrome / Edge / Brave**:
  1. Navigate to `chrome://extensions/` and enable **Developer mode**.
  2. Click **Load unpacked** and select `extension/.output/chrome-mv3/`.
- **Firefox**:
  1. Navigate to `about:debugging#/runtime/this-firefox`.
  2. Click **Load Temporary Add-on...** and select `extension/.output/firefox-mv3/manifest.json`.

---

## Workflow Overview

1. **User Profile & Master Resume**: Upload your master [JSON Resume](https://jsonresume.org/) in the **Resume Manager** on the web dashboard.
2. **Capture Listings**: Browse job portals as usual; the extension extracts listings passively or via 84+ portal adapters and sends them to your local ingest API.
3. **Fit Evaluation & Tailoring**: Background workers evaluate qualifications against your master resume, generate a match score, and produce tailored PDF and ATS-friendly plaintext resumes.
4. **Track Applications**: Manage the pipeline via the interactive Kanban board.

---

## Testing & Quality Assurance

```bash
# Run unit, workspace, and E2E integration test suite
npm test

# Run Python scorer and tailoring test suite
cd server/scorer && uv run pytest

# Run Web dashboard unit tests
npm --workspace=server/web test

# Run Extension unit tests
npm --workspace=extension test

# Code quality checks
npm run lint
npm run format:check
```

---

## Attributions & Acknowledgements

JobFoundry incorporates and builds upon ideas and components from open-source projects including [`career-ops`](https://github.com/career-ops) and [`jobs-auto-apply`](https://github.com/jobs-auto-apply). We are grateful to the open-source community for their foundational work.

---

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
