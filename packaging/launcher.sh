#!/usr/bin/env bash
# ==============================================================================
# JobFoundry - Native Package Launcher
# Starts all services (tailor, scorer, ingest) as background processes.
# Usage: Called by AppRun (AppImage) — not meant to be invoked directly.
#        Use jobfoundry-ctl.sh for user-facing commands.
#
# NOTE: The tailor and scorer services call the configured LLM provider directly.
# Set your provider
# API keys (e.g. OPENROUTER_API_KEY) in "$DATA_DIR/.env".
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# 1. Locate the package root (works inside a mounted AppImage)
# ------------------------------------------------------------------------------
# When running inside an AppImage, $APPDIR is set by the runtime.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="${APPDIR:-$SCRIPT_DIR}"

# Bundled runtime locations
NODE_BIN="$PKG_ROOT/usr/lib/node/bin/node"
PYTHON_BIN="$PKG_ROOT/usr/lib/python/bin/python3"
CHROME_HEADLESS_BIN="$PKG_ROOT/usr/lib/chrome-headless-shell/chrome-headless-shell"
CHROME_LIB_DIR="$PKG_ROOT/usr/lib/chrome-headless-shell/lib"

APP_SRC="$PKG_ROOT/usr/share/jobfoundry"
NODE_TOOLS_BIN="$APP_SRC/node-tools/node_modules/.bin"

# ------------------------------------------------------------------------------
# 2. XDG-compliant data directory
# ------------------------------------------------------------------------------
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/jobfoundry"
LOGS_DIR="$DATA_DIR/logs"

# Fallback runtime directory: use $XDG_RUNTIME_DIR/jobfoundry if available,
# valid, and owned by the current user. Otherwise fall back to $DATA_DIR/run
# (inside user's private data dir) rather than a shared, world-writable /tmp.
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "$XDG_RUNTIME_DIR" ] && [ -O "$XDG_RUNTIME_DIR" ] && [ ! -L "$XDG_RUNTIME_DIR" ]; then
  RUNTIME_DIR="$XDG_RUNTIME_DIR/jobfoundry"
else
  RUNTIME_DIR="$DATA_DIR/run"
fi

if [ -e "$RUNTIME_DIR" ] && { [ -L "$RUNTIME_DIR" ] || [ ! -O "$RUNTIME_DIR" ]; }; then
  echo "[jobfoundry] ERROR: runtime directory $RUNTIME_DIR is insecure or not owned by user" >&2
  exit 1
fi

mkdir -p \
  "$DATA_DIR/artifacts" \
  "$DATA_DIR/themes/node_modules" \
  "$LOGS_DIR" \
  "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

export DATA_DIR
DB_PATH="$DATA_DIR/jobfoundry.db"
MASTER_RESUME_PATH="$DATA_DIR/master-resume.json"
ARTIFACTS_DIR="$DATA_DIR/artifacts"

# ------------------------------------------------------------------------------
# 3. Verify bundled binaries exist
# ------------------------------------------------------------------------------
for bin in "$NODE_BIN" "$PYTHON_BIN" "$CHROME_HEADLESS_BIN"; do
  if [ ! -x "$bin" ]; then
    echo "[jobfoundry] ERROR: Required binary not found or not executable: $bin" >&2
    exit 1
  fi
done

# Sanity-check the bundled runtimes before starting anything.
"$NODE_BIN" --version >/dev/null
"$PYTHON_BIN" -c "import sys; assert sys.version_info >= (3, 12)" \
  || { echo "[jobfoundry] ERROR: Bundled Python is older than 3.12" >&2; exit 1; }

# Resolve the standalone Python's site-packages dynamically (no hardcoded version).
PYTHON_SITE="$("$PYTHON_BIN" -c "import sysconfig; print(sysconfig.get_path('purelib'))")"

# ------------------------------------------------------------------------------
# 4. Environment setup
# ------------------------------------------------------------------------------
export PATH="$PKG_ROOT/usr/lib/node/bin:$NODE_TOOLS_BIN:$PKG_ROOT/usr/bin:$PATH"
export PYTHONPATH="$APP_SRC/server/scorer:$PYTHON_SITE"
export NODE_PATH="$DATA_DIR/themes/node_modules:$APP_SRC/node_modules:$APP_SRC/node-tools/node_modules"
export LD_LIBRARY_PATH="$CHROME_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export XDG_DATA_DIRS="$PKG_ROOT/usr/share${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"

# PDF renderer — use bundled chrome-headless-shell (folio-export picks this up).
export PUPPETEER_EXECUTABLE_PATH="$CHROME_HEADLESS_BIN"
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Ports (internals, bound on localhost except ingest — see README).
TAILOR_PORT=8081
SCORER_PORT=8001
INGEST_PORT=8080

# Load user .env if it exists (API keys, model overrides, custom base URLs).
ENV_FILE="$DATA_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

# Defaults for required env vars if not set.
export SCORER_MODEL="${SCORER_MODEL:-openrouter/google/gemini-2.0-flash-exp:free}"
export SCORER_PROVIDER="${SCORER_PROVIDER:-openrouter}"
export SCORER_THRESHOLD="${SCORER_THRESHOLD:-75}"
export TAILOR_MODEL="${TAILOR_MODEL:-openrouter/google/gemini-2.0-flash-exp:free}"
export TAILOR_TIMEOUT_SECONDS="${TAILOR_TIMEOUT_SECONDS:-900}"
export TAILOR_TIMEOUT_MS="${TAILOR_TIMEOUT_MS:-1800000}"
export LLM_RATE_LIMIT_REQUESTS="${LLM_RATE_LIMIT_REQUESTS:-20}"
export LLM_RATE_LIMIT_PERIOD="${LLM_RATE_LIMIT_PERIOD:-60}"
export LLM_MAX_RETRIES="${LLM_MAX_RETRIES:-25}"
export LLM_RETRY_MIN_WAIT_SECONDS="${LLM_RETRY_MIN_WAIT_SECONDS:-5}"
export LLM_RETRY_MAX_WAIT_SECONDS="${LLM_RETRY_MAX_WAIT_SECONDS:-120}"
export LLM_RETRY_MULTIPLIER="${LLM_RETRY_MULTIPLIER:-3}"
export LLM_REQUEST_TIMEOUT="${LLM_REQUEST_TIMEOUT:-600}"
export API_KEYS="${API_KEYS:-}"
export HOST="${HOST:-127.0.0.1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
export MASTER_RESUME_PATH

# Custom LLM base URLs are optional. Unset them when empty so the services fall
# back to direct provider defaults instead of sending empty-string URLs.
for _base_var in OPENROUTER_API_BASE OPENAI_API_BASE OPENAI_BASE_URL SCORER_API_BASE; do
  if [ -z "${!_base_var:-}" ]; then
    unset "$_base_var"
  else
    export "${_base_var?}"
  fi
done

# ------------------------------------------------------------------------------
# 5. PID tracking and signal handling
# ------------------------------------------------------------------------------
PIDS=()

_record_pid() {
  local pid="$1" file="$2"
  local starttime=""
  if [ -r "/proc/$pid/stat" ]; then
    starttime="$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true)"
  fi
  if [ -z "$starttime" ] || [ "$starttime" = "0" ]; then
    echo "[jobfoundry] ERROR: could not determine process starttime for PID $pid" >&2
    return 1
  fi
  echo "$pid $starttime" > "$file"
  chmod 600 "$file"
}

_cleanup() {
  echo "[jobfoundry] Shutting down services..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  # Give processes up to 5s to exit gracefully.
  local deadline=$(( $(date +%s) + 5 ))
  for pid in "${PIDS[@]}"; do
    while kill -0 "$pid" 2>/dev/null && [ "$(date +%s)" -lt "$deadline" ]; do
      sleep 0.2
    done
    kill -KILL "$pid" 2>/dev/null || true
  done
  rm -f "$RUNTIME_DIR/tailor.pid" "$RUNTIME_DIR/scorer.pid" "$RUNTIME_DIR/ingest.pid" 2>/dev/null || true
  echo "[jobfoundry] All services stopped."
}

trap _cleanup EXIT TERM INT

# ------------------------------------------------------------------------------
# 6. Readiness check helper
# ------------------------------------------------------------------------------
_wait_for_port() {
  local name="$1"
  local port="$2"
  local max_wait="${3:-30}"
  local elapsed=0
  echo "[jobfoundry] Waiting for $name on port $port..."
  while ! (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do
    sleep 1
    elapsed=$(( elapsed + 1 ))
    if [ "$elapsed" -ge "$max_wait" ]; then
      echo "[jobfoundry] ERROR: $name failed to start within ${max_wait}s" >&2
      echo "[jobfoundry] See logs in $LOGS_DIR" >&2
      exit 1
    fi
  done
  exec 3>&- 2>/dev/null || true
  echo "[jobfoundry] $name ready"
}

# ------------------------------------------------------------------------------
# 7. Start services in dependency order
# ------------------------------------------------------------------------------
echo "[jobfoundry] Starting services..."

# --- 7a. Tailor (resume ops API, port 8081) ---
PORT="$TAILOR_PORT" \
MASTER_RESUME_PATH="$MASTER_RESUME_PATH" \
DEFAULT_MODEL="$TAILOR_MODEL" \
LLM_MAX_CONCURRENCY=1 \
  "$PYTHON_BIN" -m resume_ops_api \
  >> "$LOGS_DIR/tailor.log" 2>&1 &
PIDS+=($!)
_record_pid "$!" "$RUNTIME_DIR/tailor.pid"
_wait_for_port "tailor" "$TAILOR_PORT" 60

# --- 7b. Scorer (fit scoring, port 8001) ---
PORT="$SCORER_PORT" \
HOST="$HOST" \
DB_PATH="$DB_PATH" \
ARTIFACTS_DIR="$ARTIFACTS_DIR" \
SCORER_MODEL="$SCORER_MODEL" \
SCORER_PROVIDER="$SCORER_PROVIDER" \
SCORER_THRESHOLD="$SCORER_THRESHOLD" \
RESUME_OPS_URL="http://127.0.0.1:$TAILOR_PORT" \
TAILOR_TIMEOUT_SECONDS="$TAILOR_TIMEOUT_SECONDS" \
  "$PYTHON_BIN" -m src.main \
  >> "$LOGS_DIR/scorer.log" 2>&1 &
PIDS+=($!)
_record_pid "$!" "$RUNTIME_DIR/scorer.pid"
_wait_for_port "scorer" "$SCORER_PORT" 60

# --- 7c. Ingest (Fastify API + SPA, port 8080) ---
PORT="$INGEST_PORT" \
DB_PATH="$DB_PATH" \
ARTIFACTS_DIR="$ARTIFACTS_DIR" \
STATIC_DIR="$APP_SRC/web/dist" \
API_KEYS="$API_KEYS" \
RESUME_OPS_URL="http://127.0.0.1:$TAILOR_PORT" \
TAILOR_TIMEOUT_MS="$TAILOR_TIMEOUT_MS" \
  "$NODE_BIN" "$APP_SRC/server/ingest/src/index.mjs" \
  >> "$LOGS_DIR/ingest.log" 2>&1 &
PIDS+=($!)
_record_pid "$!" "$RUNTIME_DIR/ingest.pid"
_wait_for_port "ingest" "$INGEST_PORT" 30

# ------------------------------------------------------------------------------
# 8. Open browser and wait
# ------------------------------------------------------------------------------
echo ""
echo "[jobfoundry] All services running."
echo "[jobfoundry]   Dashboard: http://localhost:$INGEST_PORT"
echo "[jobfoundry]   Logs:      $LOGS_DIR"
echo ""

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:$INGEST_PORT" 2>/dev/null || \
    echo "[jobfoundry] Open your browser at: http://localhost:$INGEST_PORT"
else
  echo "[jobfoundry] Open your browser at: http://localhost:$INGEST_PORT"
fi

# Wait for any child to exit (unexpected crash), then trigger cleanup.
wait -n "${PIDS[@]}" 2>/dev/null || true
echo "[jobfoundry] A service exited unexpectedly. Shutting down."
