# ==============================================================================
# JobFoundry - All-in-One (AIO) Container
# Packages: React Web Dashboard + Fastify Ingest + Scorer Worker + Resume Tailor
# ==============================================================================

# --- Stage 1: Build React Web SPA ---
FROM node:22-slim AS web-builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/web/package.json ./server/web/
RUN npm ci --workspace=server/web

COPY server/web/ ./server/web/
ENV VITE_API_URL=""
RUN npm --workspace=server/web run build

# --- Stage 2: Install Node Ingest Dependencies ---
FROM node:22-bookworm-slim AS ingest-builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/ingest/package.json ./server/ingest/
RUN npm ci --omit=dev --workspace=server/ingest


# --- Stage 3: Final All-in-One Runtime ---
FROM python:3.12-slim

ARG NPM_THEMES="jsonresume-theme-folio@^1.3.1 jsonresume-theme-stackoverflow"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_PATH=/data/themes/node_modules:/usr/local/lib/node_modules:/app/node_modules \
    PORT=8080 \
    DATA_DIR=/data \
    DB_PATH=/data/jobfoundry.db \
    ARTIFACTS_DIR=/data/artifacts \
    MASTER_RESUME_PATH=/data/master-resume.json \
    SCORER_MODEL=openrouter/google/gemini-2.0-flash-exp:free \
    SCORER_PROVIDER=openrouter \
    SCORER_THRESHOLD=75 \
    TAILOR_MODEL=openrouter/google/gemini-2.0-flash-exp:free \
    ALLOWED_THEMES="jsonresume-theme-folio jsonresume-theme-stackoverflow" \
    API_KEYS=""

# 1. Install system utilities, Node.js 22 (NodeSource), Chromium, and Supervisor
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates supervisor \
        chromium chromium-sandbox \
        fonts-liberation fonts-noto-color-emoji \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g puppeteer ${NPM_THEMES} \
    && rm -rf /var/lib/apt/lists/*

# 2. Install uv for fast Python dependency installation
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# 3. Install Python dependencies for Scorer and Tailor
COPY server/scorer/pyproject.toml server/scorer/uv.lock ./server/scorer/
RUN cd server/scorer && uv pip install --system -r pyproject.toml

COPY server/tailor/pyproject.toml server/tailor/uv.lock server/tailor/README.md ./server/tailor/
COPY server/tailor/src ./server/tailor/src
RUN cd server/tailor && uv pip install --system -e .

# 4. Copy Ingest Server and node_modules, rebuild native modules for runtime Node version
COPY --from=ingest-builder /app/node_modules ./node_modules
COPY server/ingest/ ./server/ingest/
RUN npm rebuild --prefix /app


# 5. Copy Scorer Source
COPY server/scorer/src/ ./server/scorer/src/

# 6. Copy Pre-built Web SPA
COPY --from=web-builder /app/server/web/dist ./server/web/dist

# 7. Configure Supervisor & Data Directories
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN mkdir -p /data /data/artifacts /data/themes

VOLUME ["/data"]

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
