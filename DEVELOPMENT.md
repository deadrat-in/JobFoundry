# Development Guide

This document provides technical details for developing and debugging JobFoundry locally.

---

## Monorepo Architecture

JobFoundry is structured as an npm multi-workspace repository:

```
JobFoundry/
├── extension/          # WXT-based Browser Extension (MV3 / Firefox)
├── server/
│   ├── ingest/         # Fastify REST API, SQLite DB, multi-tenant auth, SimHash dedup
│   ├── scorer/         # FastAPI fit screener, LiteLLM integration, tailor worker daemon
│   └── web/            # Vite + React 19 SPA (Kanban board, job feed, resume manager)
├── docs/               # GitHub Pages documentation portal
├── compose.yaml        # Local full-stack container orchestration
├── scripts/            # Repo utilities (healthchecks, metadata validation)
└── test/               # Multi-service end-to-end integration test suite
```

---

## Prerequisites

- **Node.js**: v22 or newer
- **Python**: 3.12 or newer
- **uv**: Modern fast Python package manager ([installation instructions](https://docs.astral.sh/uv/))
- **Docker & Docker Compose**: Optional, for running containerized services

---

## Local Setup & Running Services

### 1. Ingest Server (`server/ingest`)

The ingest server handles job listing ingestion, deduplication with SimHash/fingerprinting, multi-user authentication, and serves static tailored artifacts (PDFs/plaintext).

```bash
cd server/ingest
npm install
npm run dev
```

- Runs by default on `http://localhost:8080`
- Database file is stored at `data/jobfoundry.db` (or in-memory when testing)

### 2. Scorer & Worker Service (`server/scorer`)

The scorer service evaluates job descriptions against user master resumes, computes fit scores, identifies missing skills, and calls the resume-ops tailoring bridge.

```bash
cd server/scorer
uv sync --dev
uv run uvicorn src.app:app --port 8001 --reload
```

To run the background worker daemon standalone:

```bash
uv run python -m src.worker
```

### 3. Web Dashboard (`server/web`)

The web UI is a React 19 Single Page Application built with Vite and Tailwind/Vanilla CSS.

```bash
cd server/web
npm install
npm run dev
```

- Accessible at `http://localhost:5173`

### 4. Browser Extension (`extension`)

Built using the [WXT](https://wxt.dev/) framework for Manifest V3.

```bash
cd extension
npm install

# Live development with hot reloading:
npm run dev

# Production build for Chrome:
npm run build

# Production build for Firefox:
npm run build:firefox
```

---

## Running Tests

JobFoundry has comprehensive unit, workspace, and end-to-end integration tests:

```bash
# 1. Monorepo E2E tests + metadata assertions
npm test

# 2. Extension unit & content extractor tests
npm --workspace=extension test

# 3. Ingest server API & database migration tests
npm --workspace=server/ingest test

# 4. Web UI component and unit tests
npm --workspace=server/web test

# 5. Scorer Python pytest suite
cd server/scorer && uv run pytest
```

---

## Code Quality & Pre-Commit Checks

Always run these commands before submitting changes:

```bash
# Lint all JavaScript/TypeScript files
npm run lint

# Check Prettier formatting
npm run format:check

# Auto-format files
npm run format
```
