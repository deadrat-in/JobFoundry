#!/usr/bin/env bash
# ==============================================================================
# JobFoundry - User-facing control CLI (bundled in the AppImage)
# Usage: jobfoundry-ctl.sh {start|stop|status|restart|logs [service]|open}
# ==============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="${APPDIR:-$SCRIPT_DIR}"
# In the bundle the launcher sits next to this script; in a source checkout
# fall back to the sibling launcher.sh.
LAUNCHER="$PKG_ROOT/usr/bin/jobfoundry-launcher"
[ -x "$LAUNCHER" ] || LAUNCHER="$SCRIPT_DIR/launcher.sh"

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/jobfoundry"
LOGS_DIR="$DATA_DIR/logs"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}/jobfoundry-$UID"
LAUNCHER_PIDFILE="$RUNTIME_DIR/launcher.pid"

INGEST_PORT=8080
DASHBOARD_URL="http://localhost:$INGEST_PORT"

mkdir -p "$LOGS_DIR" "$RUNTIME_DIR"

_alive() {
  kill -0 "$1" 2>/dev/null
}

_port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# Returns 0 when GET /health on ingest answers 200 OK.
_health_ok() {
  if command -v curl >/dev/null 2>&1; then
    if curl -fs -o /dev/null --max-time 3 "$DASHBOARD_URL/health" 2>/dev/null; then
      return 0
    fi
    # Fall through to a direct TCP check: curl can fail for environmental
    # reasons (e.g. http_proxy set without a localhost no_proxy exception)
    # while the service itself is healthy.
  fi
  if ! _port_open "$INGEST_PORT"; then
    return 1
  fi
  local line
  exec 3<>"/dev/tcp/127.0.0.1/$INGEST_PORT" 2>/dev/null || return 1
  printf 'GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3
  IFS= read -r -t 5 line <&3 || { exec 3>&-; return 1; }
  exec 3>&-
  [[ "$line" == *" 200 "* ]]
}

_launcher_running() {
  [ -f "$LAUNCHER_PIDFILE" ] && _alive "$(cat "$LAUNCHER_PIDFILE")"
}

cmd_start() {
  if _launcher_running; then
    echo "[jobfoundry] Already running (pid $(cat "$LAUNCHER_PIDFILE"))."
    echo "[jobfoundry] Dashboard: $DASHBOARD_URL"
    return 0
  fi
  if [ ! -x "$LAUNCHER" ]; then
    echo "[jobfoundry] ERROR: launcher not found at $LAUNCHER" >&2
    return 1
  fi
  echo "[jobfoundry] Starting services in the background..."
  # setsid detaches from the terminal; output goes to launcher.log.
  setsid nohup "$LAUNCHER" >> "$LOGS_DIR/launcher.log" 2>&1 < /dev/null &
  echo "$!" > "$LAUNCHER_PIDFILE"
  local elapsed=0
  while ! _health_ok; do
    sleep 2
    elapsed=$(( elapsed + 2 ))
    if ! _launcher_running; then
      echo "[jobfoundry] ERROR: launcher exited during startup. See $LOGS_DIR/launcher.log" >&2
      return 1
    fi
    if [ "$elapsed" -ge 120 ]; then
      echo "[jobfoundry] ERROR: ingest unhealthy after 120s. Check logs in $LOGS_DIR" >&2
      return 1
    fi
  done
  echo "[jobfoundry] All services running."
  echo "[jobfoundry] Dashboard: $DASHBOARD_URL"
}

cmd_stop() {
  local stopped=0
  if [ -f "$LAUNCHER_PIDFILE" ]; then
    local pid
    pid="$(cat "$LAUNCHER_PIDFILE")"
    if _alive "$pid"; then
      echo "[jobfoundry] Stopping launcher (pid $pid)..."
      kill -TERM "$pid" 2>/dev/null || true
      local elapsed=0
      while _alive "$pid" && [ "$elapsed" -lt 15 ]; do
        sleep 1
        elapsed=$(( elapsed + 1 ))
      done
      if _alive "$pid"; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
      stopped=1
    fi
    rm -f "$LAUNCHER_PIDFILE"
  fi
  # Belt and braces: kill any leftover service processes from pidfiles.
  for svc in tailor scorer ingest; do
    local f="$RUNTIME_DIR/$svc.pid"
    if [ -f "$f" ]; then
      local pid
      pid="$(cat "$f")"
      if _alive "$pid"; then
        kill -KILL "$pid" 2>/dev/null || true
        stopped=1
      fi
      rm -f "$f"
    fi
  done
  if [ "$stopped" -eq 1 ]; then
    echo "[jobfoundry] All services stopped."
  else
    echo "[jobfoundry] Not running."
  fi
}

cmd_status() {
  if _launcher_running; then
    echo "[jobfoundry] launcher: running (pid $(cat "$LAUNCHER_PIDFILE"))"
  else
    echo "[jobfoundry] launcher: not running"
  fi
  local svc port pidfile pid state
  for svc in tailor:8081 scorer:8001 ingest:8080; do
    port="${svc##*:}"
    svc="${svc%%:*}"
    pidfile="$RUNTIME_DIR/$svc.pid"
    state="stopped"
    if [ -f "$pidfile" ]; then
      pid="$(cat "$pidfile")"
      if _alive "$pid" && _port_open "$port"; then
        state="running (pid $pid, port $port)"
      elif _alive "$pid"; then
        state="starting... (pid $pid, port $port not ready)"
      fi
    elif _port_open "$port"; then
      state="running (external process, port $port)"
    fi
    echo "[jobfoundry] $svc: $state"
  done
  if _health_ok; then
    echo "[jobfoundry] dashboard: healthy at $DASHBOARD_URL"
  else
    echo "[jobfoundry] dashboard: not responding"
  fi
}

cmd_logs() {
  local target="${1:-}"
  if [ -n "$target" ]; then
    local f="$LOGS_DIR/$target.log"
    if [ ! -f "$f" ]; then
      echo "[jobfoundry] ERROR: no such log: $target (choose: tailor, scorer, ingest, launcher)" >&2
      return 1
    fi
    exec tail -n 100 -F "$f"
  fi
  exec tail -n 50 -F "$LOGS_DIR"/*.log
}

cmd_open() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DASHBOARD_URL" 2>/dev/null || echo "$DASHBOARD_URL"
  else
    echo "$DASHBOARD_URL"
  fi
}

case "${1:-status}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  restart) cmd_stop; sleep 2; cmd_start ;;
  logs) cmd_logs "${2:-}" ;;
  open) cmd_open ;;
  *)
    echo "Usage: $(basename "$0") {start|stop|status|restart|logs [service]|open}" >&2
    exit 1
    ;;
esac
