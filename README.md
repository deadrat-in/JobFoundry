# JobFoundry

[![CI](https://github.com/deadrat-in/JobFoundry/actions/workflows/ci.yml/badge.svg)](https://github.com/deadrat-in/JobFoundry/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/deadrat-in/JobFoundry/actions/workflows/pages.yml/badge.svg)](https://github.com/deadrat-in/JobFoundry/actions/workflows/pages.yml)
[![Release](https://img.shields.io/github/v/release/deadrat-in/JobFoundry)](https://github.com/deadrat-in/JobFoundry/releases)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Privacy: Local-First](https://img.shields.io/badge/Privacy-Local--First-emerald.svg)](https://jobfoundry.covai.org/docs/privacy/)

**Job search for people, not just engineers.** JobFoundry is an open-source,
local-first platform for job discovery, fit assessment, and resume tailoring.
If you can browse the web, you can use it — no AI coding assistant, no
terminal, no prompt skills required. Your data never leaves your machine.

📚 **[Documentation & Guides](https://jobfoundry.covai.org/docs/)** &bull; 🚀 **[Quickstart Guide](https://jobfoundry.covai.org/docs/getting-started/)** &bull; 🛠️ **[Development Guide](DEVELOPMENT.md)** &bull; 🤝 **[Contributing](CONTRIBUTING.md)** &bull; 🔒 **[Privacy & Security](SECURITY.md)** &bull; 💬 **[Support](SUPPORT.md)**

---

## What it does

| Stage           | What happens                                                                                               | Where             |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ----------------- |
| **Capture**     | 87 ATS/job-board providers extract listings inside your browser session — no logins, no LLM calls, no cost | Browser extension |
| **Deduplicate** | 64-bit SimHash fingerprints collapse cross-posted duplicates                                               | Ingest server     |
| **Score**       | Local LLM grades fit 0–100 with strengths + gap analysis                                                   | Scorer worker     |
| **Tailor**      | Your real experience, truthfully rephrased per job; PDF + ATS plaintext                                    | Tailor engine     |
| **Track**       | Kanban pipeline from Discovered to Offer                                                                   | Web dashboard     |

---

## Why JobFoundry

**Server scrapers lose. Your browser wins.** Datacenter IPs die against
Cloudflare, CAPTCHAs, login walls, and rate limits every day. Your
authenticated browser session walks straight through — so JobFoundry captures
listings inside the browser you already use, and the server never touches a
job board. The author can use a terminal and still chose the browser, because
it succeeds more often.

**Built for the jobless, not just the technical.** Job search is stressful
enough without new barriers. There is no CLI to learn, no prompts to
engineer, no subscription to buy. Install the app, add the extension, keep
browsing like always — capture, scoring, tailoring, and tracking happen
quietly in the background. See [MANIFESTO.md](MANIFESTO.md).

**Honest by construction.** The tailor re-ranks and rephrases _your genuine
experience_ under strict schema constraints. It never invents employers,
skills, dates, or metrics — a fabricated resume fails background checks and
burns your credibility. And JobFoundry never auto-submits: you review, you
click, you apply.

---

## Where it came from

JobFoundry began as **resume-ops**, a standalone resume-tailoring API built
to sit alongside job-search tools. It worked — but two things kept nagging:
scraping belonged in the browser (where it actually succeeds), and the whole
loop deserved to be usable by anyone, not just people comfortable with
terminals and AI CLIs. So the tailoring engine was absorbed into a full
local-first stack, and JobFoundry is the result. The engine lives on as
`server/tailor/`.

## Relationship to career-ops

[career-ops](https://github.com/career-ops) is an excellent AI-CLI-native
power tool for running your job search from inside coding assistants, with a
pioneering evaluation framework and provider collection. If you live in the
terminal and love agentic workflows, it is genuinely great — and JobFoundry
can import its discoveries (`node scripts/import-career-ops.mjs --from
/path/to/career-ops/data/pipeline.md`).

JobFoundry exists for a different audience and a different bet: people who
would rather drive everything from their familiar browser and a dashboard,
with capture riding their real session so it succeeds more often. The
overlap is deliberate and acknowledged — a subset of the browser provider
layer is adapted from career-ops' MIT-licensed provider collection (original
headers preserved; browser-incompatible modules are ported, never edited in
place — see `extension/scripts/ports/README.md`). That file-level reuse is
the full extent of it: the zero-token extraction philosophy, the
browser-first architecture, and the tailoring engine are JobFoundry's own.

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
                                               │      Local resume-ops API      │
                                               │   (Multi-Theme PDF & ATS Gen)  │
                                               └────────────────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design document.

---

## Repository Layout

```
docs/             Documentation portal & GitHub Pages static website
extension/        Browser extension (Chrome MV3 / Firefox MV3 & MV2)
server/
  ingest/         Node/ESM ingest API, SQLite storage, auth, SimHash dedup
  scorer/         Python fit screener & worker daemon polling SQLite queue
  tailor/         Resume tailoring engine (LangGraph + folio-export / Puppeteer PDF & ATS)
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
curl -fsSL https://raw.githubusercontent.com/deadrat-in/JobFoundry/main/install.sh | bash
```

This script:

1. Validates Docker & Docker Compose prerequisites.
2. Clones or updates the JobFoundry stack.
3. Automatically creates `.env` with a secure generated API key.
4. Pulls or builds the **All-in-One container** and launches it in the background.
5. Verifies service health via `./scripts/healthcheck.sh`.

Prefer no Docker and no terminal? Grab the **AppImage** (Linux) or **MSIX**
(Windows) from the [Releases page](https://github.com/deadrat-in/JobFoundry/releases)
— double-click / Start-menu launch, no command line involved.

---

## Run without Docker (Linux AppImage)

On Linux x86_64 you can run JobFoundry as a single portable file — no Docker,
no installation:

```bash
# Download JobFoundry-<version>-x86_64.AppImage from the GitHub Releases page,
# then:
chmod +x JobFoundry-*.AppImage
./JobFoundry-*.AppImage
```

This starts all services in the foreground and opens the dashboard at
[http://localhost:8080](http://localhost:8080). Stop with `Ctrl+C`.

Background control (start on login, check status, tail logs):

```bash
./JobFoundry-*.AppImage start    # launch in the background
./JobFoundry-*.AppImage status   # tailor / scorer / ingest health
./JobFoundry-*.AppImage logs     # follow all service logs (or: logs ingest)
./JobFoundry-*.AppImage open     # open the dashboard in your browser
./JobFoundry-*.AppImage stop     # shut everything down
```

Configuration and data live outside the AppImage, following XDG conventions:

- `~/.local/share/jobfoundry/` — SQLite DB, artifacts, logs, `master-resume.json`
- `~/.local/share/jobfoundry/.env` — API keys (`OPENROUTER_API_KEY`, …) and model
  overrides. The AppImage ships no keys; scoring and tailoring call your
  configured LLM provider directly.

Notes:

- The AppImage bundles its own Node.js 26, Python 3.12 and a headless Chromium
  for PDF export (~250–300 MB download).
  There is no local rate limiting or prompt audit log, and LLM traffic goes
  straight to your provider.
- The dashboard port (`8080`) listens on all interfaces, same as
  `docker run -p 8080:8080`. Bindings for the internal services are
  localhost-only.

---

## Run on Windows (MSIX)

On Windows 11 x64 (22000+), JobFoundry ships as a MSIX package for
[sideloading](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/develop-sideload-apps).

```powershell
# Download JobFoundry-<version>-x64.msix and JobFoundry.cer
# from the GitHub Releases page.
# 1) Trust the signing certificate ONCE (requires an elevated PowerShell):
Import-Certificate -FilePath .\JobFoundry.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
# 2) Install the package:
Add-AppxPackage -Path .\JobFoundry-<version>-x64.msix
```

The App Installer places the signing certificate in the **Local Computer →
Trusted People** store (App Installer checks the machine store, not the current
user store), so the import command above must run elevated. It is not a root CA,
so it belongs in Trusted People, never in Trusted Root Certification
Authorities.

Launch `JobFoundry` from the Start menu to run all services in the foreground
and open the dashboard at [http://localhost:8080](http://localhost:8080).
Because the sealed MSIX payload is read-only, shutdown is via the Windows
control CLI bundled with the app:

```powershell
# From any PowerShell prompt: jobfoundry start|status|logs|stop
jobfoundry status
jobfoundry stop
```

Configuration and data live outside the package, per app conventions:

- `%LOCALAPPDATA%\JobFoundry\` — SQLite DB, artifacts, logs, `master-resume.json`
- `%LOCALAPPDATA%\JobFoundry\.env` — API keys (`OPENROUTER_API_KEY`, …) and model
  overrides. The package ships no keys; scoring and tailoring call your
  configured LLM provider directly.

Notes:

- The release builds are self-signed for full-trust sideloading. If the release
  was built with the persistent signing certificate (uploaded as the
  `MSIX_SIGNING_PFX` repo secret), trusting `JobFoundry.cer` once covers all
  future releases; without it, every release signs with a fresh certificate and
  the new `.cer` must be imported again before updating. A Microsoft Store
  listing would use store certificates instead, removing the certificate step
  entirely.
- `jobfoundry start` runs the background services; `stop` shuts them down.
  Killing the console window of a foreground run can orphan the child services.
- The package bundles its own Node.js 26, Python 3.12 and a headless Chromium
  for PDF export (~300 MB download).

---

## Getting Started (Manual)

### 1. Prerequisites

- **Docker & Docker Compose** (recommended for containerized run)
- Or for bare-metal development:
  - **Node.js**: v26+
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
docker run -d -p 8080:8080 -v jobfoundry-data:/data --env-file .env ghcr.io/deadrat-in/jobfoundry:latest
```

Verify service health:

```bash
./scripts/healthcheck.sh
```

- **Web Dashboard & Ingest API**: [http://localhost:8080](http://localhost:8080)
- **Browser Extension Guide**: [https://jobfoundry.covai.org/docs/extension/](https://jobfoundry.covai.org/docs/extension/)

### 4. Running Locally for Development

```bash
# Install root & workspace dependencies
npm install

# Start Ingest Server
npm --workspace=server/ingest run dev

# Start Scorer Service
cd server/scorer && uv run uvicorn src.app:app --port 8001 --reload

# Start Tailor Service (resume-ops engine)
cd server/tailor && uv run python -m resume_ops_api

# Start Web Dashboard
npm --workspace=server/web run dev
```

---

## Browser Extension Setup

No terminal needed: download the prebuilt `.zip` for your browser from the
[Releases page](https://github.com/deadrat-in/JobFoundry/releases)
(`jobfoundry-extension-chrome.zip` / `jobfoundry-extension-firefox.zip`, also
mirrored in `dist-extension/`), then load it as below. Full walkthrough with
pictures: [Extension guide](https://jobfoundry.covai.org/docs/extension/).

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
2. **Capture Listings**: Browse job portals as usual; the extension extracts listings passively or via 87 portal adapters and sends them to your local ingest API.
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

## Documentation Map

| Document                                   | For                                 |
| ------------------------------------------ | ----------------------------------- |
| [MANIFESTO.md](MANIFESTO.md)               | Why this exists and who it is for   |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | How it fits together (design doc)   |
| [DEVELOPMENT.md](DEVELOPMENT.md)           | Local setup and service debugging   |
| [CONTRIBUTING.md](CONTRIBUTING.md)         | How to contribute (incl. providers) |
| [SUPPORT.md](SUPPORT.md)                   | Where to get help                   |
| [SECURITY.md](SECURITY.md)                 | Vulnerability reporting + privacy   |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)   | Community standards                 |
| [GOVERNANCE.md](GOVERNANCE.md)             | How the project is run              |
| [CHANGELOG.md](CHANGELOG.md)               | What changed per release            |
| [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) | No-warranty plain-language notes    |
| [TRADEMARK.md](TRADEMARK.md)               | Brand policy                        |
| [HIRED.md](HIRED.md)                       | Success wall (waiting for launch)   |
| [AGENTS.md](AGENTS.md)                     | Constraints for AI coding agents    |

---

## Attributions & Acknowledgements

A subset of the browser provider layer is adapted from the MIT-licensed
[career-ops](https://github.com/career-ops) provider collection — an
excellent AI-CLI-native job-search tool. Original MIT headers are preserved
in every lifted file; see [Relationship to career-ops](#relationship-to-career-ops)
above and `extension/scripts/ports/README.md` for the full picture. We are
grateful to its maintainers and to the open-source community generally.

---

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
