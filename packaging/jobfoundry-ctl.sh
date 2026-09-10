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

LAUNCHER_PIDFILE="$RUNTIME_DIR/launcher.pid"

INGEST_PORT=8080
DASHBOARD_URL="http://localhost:$INGEST_PORT"

mkdir -p "$LOGS_DIR" "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

_alive() {
  kill -0 "$1" 2>/dev/null
}

_read_pid() {
  local file="$1"
  [ -f "$file" ] || return 1
  [ ! -L "$file" ] || return 1
  [ -O "$file" ] || return 1
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  echo "$pid"
}

_proc_cmdline() {
  local pid="$1"
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true
  else
    ps -p "$pid" -o args= 2>/dev/null || true
  fi
}

_proc_owned_by_me() {
  local pid="$1"
  if [ -e "/proc/$pid" ]; then
    [ -O "/proc/$pid" ]
  else
    local proc_uid
    proc_uid="$(ps -p "$pid" -o uid= 2>/dev/null | tr -d ' ')"
    [ "$proc_uid" = "$UID" ]
  fi
}

_is_expected_proc() {
  local pid="$1" svc="$2"
  _alive "$pid" || return 1
  _proc_owned_by_me "$pid" || return 1
  local cmd
  cmd="$(_proc_cmdline "$pid")"
  case "$svc" in
    launcher)
      [[ "$cmd" == *"jobfoundry-launcher"* || "$cmd" == *"launcher.sh"* ]]
      ;;
    tailor)
      [[ "$cmd" == *"resume_ops_api"* ]]
      ;;
    scorer)
      [[ "$cmd" == *"src.main"* ]]
      ;;
    ingest)
      [[ "$cmd" == *"ingest"* ]]
      ;;
    *)
      return 1
      ;;
  esac
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
  local pid
  pid="$(_read_pid "$LAUNCHER_PIDFILE" || true)"
  [ -n "$pid" ] && _is_expected_proc "$pid" "launcher"
}

cmd_start() {
  if _launcher_running; then
    echo "[jobfoundry] Already running (pid $(_read_pid "$LAUNCHER_PIDFILE"))."
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
  chmod 600 "$LAUNCHER_PIDFILE"
  local elapsed=0
  while ! _health_ok; do
    sleep 2
    elapsed=$(( elapsed + 2 ))
    if ! _launcher_running; then
      echo "[jobfoundry] ERROR: launcher exited during startup. See $LOGS_DIR/launcher.log" >&2
      return 1
    fi
    if [ "$elapsed" -ge 180 ]; then
      echo "[jobfoundry] ERROR: ingest unhealthy after 180s. Check logs in $LOGS_DIR" >&2
      cmd_stop >/dev/null 2>&1 || true
      return 1
    fi
  done
  echo "[jobfoundry] All services running."
  echo "[jobfoundry] Dashboard: $DASHBOARD_URL"
}

cmd_stop() {
  local stopped=0
  local pid
  pid="$(_read_pid "$LAUNCHER_PIDFILE" || true)"
  if [ -n "$pid" ]; then
    if _is_expected_proc "$pid" "launcher"; then
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
    else
      echo "[jobfoundry] WARN: pid $pid in launcher.pid does not match launcher process; ignoring" >&2
    fi
    rm -f "$LAUNCHER_PIDFILE"
  fi
  # Belt and braces: kill any leftover service processes from pidfiles.
  for svc in tailor scorer ingest; do
    local f="$RUNTIME_DIR/$svc.pid"
    local svc_pid
    svc_pid="$(_read_pid "$f" || true)"
    if [ -n "$svc_pid" ]; then
      if _is_expected_proc "$svc_pid" "$svc"; then
        kill -KILL "$svc_pid" 2>/dev/null || true
        stopped=1
      else
        echo "[jobfoundry] WARN: pid $svc_pid in $svc.pid does not match service $svc; ignoring" >&2
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
    echo "[jobfoundry] launcher: running (pid $(_read_pid "$LAUNCHER_PIDFILE"))"
  else
    echo "[jobfoundry] launcher: not running"
  fi
  local svc port pidfile pid state
  for svc in tailor:8081 scorer:8001 ingest:8080; do
    port="${svc##*:}"
    svc="${svc%%:*}"
    pidfile="$RUNTIME_DIR/$svc.pid"
    state="stopped"
    pid="$(_read_pid "$pidfile" || true)"
    if [ -n "$pid" ] && _is_expected_proc "$pid" "$svc"; then
      if _port_open "$port"; then
        state="running (pid $pid, port $port)"
      else
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
