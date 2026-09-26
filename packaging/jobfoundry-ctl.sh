#!/usr/bin/env bash
# ==============================================================================
# JobFoundry - User-facing control CLI (bundled in the AppImage)
# Usage: jobfoundry-ctl.sh {start|stop|status|restart|logs [service]|open}
# ==============================================================================

set -uo pipefail

# ------------------------------------------------------------------------------
# 0. OS portability layer (Linux + macOS)
# ------------------------------------------------------------------------------
_OS="$(uname -s)"
_IS_MAC=0
[ "$_OS" = "Darwin" ] && _IS_MAC=1

# Portable canonical path (macOS BSD readlink has no -f).
_realpath() {
  local p="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$p" 2>/dev/null || echo "$p"
  elif readlink -f "$p" >/dev/null 2>&1; then
    readlink -f "$p"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$p"
  else
    echo "$p"
  fi
}

# Portable "is TCP port open on localhost?" check.
_port_open() {
  local port="$1"
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    exec 3>&- 2>/dev/null || true
    exec 3<&- 2>/dev/null || true
    return 0
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" 2>/dev/null && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket,sys; s=socket.socket(); s.settimeout(2); s.connect(('127.0.0.1', int(sys.argv[1])))" "$port" 2>/dev/null && return 0
  fi
  return 1
}

# Portable process start time for PID-recycling protection.
# Linux: field 22 of /proc/<pid>/stat. macOS: BSD ps start time
# (lstart is stable for a given process invocation).
_proc_starttime() {
  local pid="$1"
  if [ -r "/proc/$pid/stat" ]; then
    awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true
    return 0
  fi
  if [ "$_IS_MAC" -eq 1 ]; then
    ps -p "$pid" -o lstart= 2>/dev/null | tr -d '[:space:]' || true
    return 0
  fi
  echo ""
}

# Portable full command line of a process.
_proc_argv() {
  # Prints NUL-separated argv when /proc is available, newline-joined
  # fallback via ps otherwise. Caller must handle both.
  local pid="$1"
  if [ -r "/proc/$pid/cmdline" ]; then
    cat "/proc/$pid/cmdline" 2>/dev/null
    return 0
  fi
  ps -p "$pid" -o args= 2>/dev/null || true
}

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
  local content pid starttime
  content="$(cat "$file" 2>/dev/null || true)"
  pid="$(awk '{print $1}' <<< "$content")"
  # Starttime may be a Linux jiffy counter or a macOS lstart string;
  # everything after the first whitespace-separated field belongs to it.
  starttime="$(awk '{$1=""; sub(/^ /, ""); print}' <<< "$content")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [ -n "$starttime" ] || return 1
  if [ "$_IS_MAC" -eq 0 ]; then
    [[ "$starttime" =~ ^[0-9]+$ ]] || return 1
    [ "$starttime" -gt 0 ] || return 1
  fi
  echo "$pid $starttime"
}

_record_pid() {
  local pid="$1" file="$2"
  local starttime=""
  starttime="$(_proc_starttime "$pid")"
  if [ "$_IS_MAC" -eq 0 ]; then
    if [ -z "$starttime" ] || [ "$starttime" = "0" ]; then
      echo "[jobfoundry] ERROR: could not determine process starttime for PID $pid" >&2
      return 1
    fi
  else
    # macOS: lstart strings contain spaces; keep them verbatim. Fall back
    # to 0 only if ps gave nothing (process already gone).
    [ -n "$starttime" ] || starttime="0"
  fi
  echo "$pid $starttime" > "$file"
  chmod 600 "$file"
}

_proc_cmdline() {
  local pid="$1"
  _proc_argv "$pid" | tr '\0' ' ' 2>/dev/null || true
}

_proc_owned_by_me() {
  local pid="$1"
  if [ -e "/proc/$pid" ]; then
    [ -O "/proc/$pid" ]
  else
    local proc_uid my_uid
    proc_uid="$(ps -p "$pid" -o uid= 2>/dev/null | tr -d ' ')"
    my_uid="${UID:-$(id -u)}"
    [ "$proc_uid" = "$my_uid" ]
  fi
}

_is_expected_proc() {
  local pid_info="$1" svc="$2"
  local pid expected_starttime
  pid="$(awk '{print $1}' <<< "$pid_info")"
  expected_starttime="$(awk '{$1=""; sub(/^ /, ""); print}' <<< "$pid_info")"
  _alive "$pid" || return 1
  _proc_owned_by_me "$pid" || return 1

  # Protect against PID recycling.
  # Linux: strictly require matching non-zero /proc starttime.
  # macOS: compare BSD lstart strings when available; a recorded "0"
  # (process table raced at start) degrades to argv matching below.
  if [ "$_IS_MAC" -eq 0 ]; then
    [ -n "$expected_starttime" ] && [[ "$expected_starttime" =~ ^[0-9]+$ ]] && [ "$expected_starttime" -gt 0 ] || return 1
    [ -r "/proc/$pid/stat" ] || return 1
    local current_starttime
    current_starttime="$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true)"
    [ -n "$current_starttime" ] && [ "$current_starttime" = "$expected_starttime" ] || return 1
  else
    if [ -n "$expected_starttime" ] && [ "$expected_starttime" != "0" ]; then
      local current_starttime
      current_starttime="$(_proc_starttime "$pid")"
      [ -n "$current_starttime" ] && [ "$current_starttime" = "$expected_starttime" ] || return 1
    fi
  fi

  # Read argv for strict executable/argument verification.
  # Linux: parse NUL-separated /proc cmdline. macOS: fall back to the
  # `ps args=` string and match on basename + key arguments.
  local argv=()
  local cmdline_text=""
  if [ -r "/proc/$pid/cmdline" ]; then
    while IFS= read -r -d '' arg; do
      argv+=("$arg")
    done < "/proc/$pid/cmdline"
  else
    cmdline_text="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    [ -n "$cmdline_text" ] || return 1
    # shellcheck disable=SC2206
    argv=($cmdline_text)
  fi

  [ "${#argv[@]}" -gt 0 ] || return 1
  local a0
  a0="$(basename -- "${argv[0]:-}")"
  local full_cmd
  full_cmd="${cmdline_text:-$(_proc_cmdline "$pid")}"

  case "$svc" in
    launcher)
      # Must match the exact canonical launcher path
      local canon_launcher canon_script
      canon_launcher="$(_realpath "$LAUNCHER")"
      if [ -r "/proc/$pid/cmdline" ]; then
        canon_script="$(_realpath "${argv[0]}" 2>/dev/null || true)"
        if [ "$canon_script" = "$canon_launcher" ]; then
          return 0
        fi
        if [[ "$a0" =~ ^(bash|sh)$ ]] && [ "${#argv[@]}" -gt 1 ]; then
          canon_script="$(_realpath "${argv[1]}" 2>/dev/null || true)"
          if [ "$canon_script" = "$canon_launcher" ]; then
            return 0
          fi
        fi
        return 1
      else
        # macOS ps fallback: substring match on the launcher path.
        [[ "$full_cmd" == *"$LAUNCHER"* ]] && return 0
        [[ "$full_cmd" == *"jobfoundry-launcher"* ]] && return 0
        return 1
      fi
      ;;
    tailor)
      if [ -r "/proc/$pid/cmdline" ]; then
        [[ "$a0" =~ ^python[0-9.]*$ ]] && [ "${argv[1]:-}" = "-m" ] && [ "${argv[2]:-}" = "resume_ops_api" ]
      else
        [[ "$full_cmd" == *"resume_ops_api"* ]]
      fi
      ;;
    scorer)
      if [ -r "/proc/$pid/cmdline" ]; then
        [[ "$a0" =~ ^python[0-9.]*$ ]] && [ "${argv[1]:-}" = "-m" ] && [ "${argv[2]:-}" = "src.main" ]
      else
        [[ "$full_cmd" == *"src.main"* ]]
      fi
      ;;
    ingest)
      if [ -r "/proc/$pid/cmdline" ]; then
        [[ "$a0" =~ ^node$ ]] && [[ "${argv[1]:-}" == *"ingest"* ]]
      else
        [[ "$full_cmd" == *"ingest"* ]]
      fi
      ;;
    *)
      return 1
      ;;
  esac
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
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "
import http.client, sys
try:
    c = http.client.HTTPConnection('127.0.0.1', int(sys.argv[1]), timeout=5)
    c.request('GET', '/health')
    sys.exit(0 if c.getresponse().status == 200 else 1)
except Exception:
    sys.exit(1)
" "$INGEST_PORT" 2>/dev/null
    return $?
  fi
  # Last resort: no python3 and curl already failed (or is missing) — the
  # port is open but HTTP status is unverified. Treat a listening ingest
  # port as healthy only when no HTTP client exists at all.
  command -v curl >/dev/null 2>&1 && return 1
  return 0
}

_launcher_running() {
  local pid_info
  pid_info="$(_read_pid "$LAUNCHER_PIDFILE" || true)"
  [ -n "$pid_info" ] && _is_expected_proc "$pid_info" "launcher"
}

cmd_start() {
  if _launcher_running; then
    local lpid
    lpid="$(awk '{print $1}' <<< "$(_read_pid "$LAUNCHER_PIDFILE")")"
    echo "[jobfoundry] Already running (pid $lpid)."
    echo "[jobfoundry] Dashboard: $DASHBOARD_URL"
    return 0
  fi
  if [ ! -x "$LAUNCHER" ]; then
    echo "[jobfoundry] ERROR: launcher not found at $LAUNCHER" >&2
    return 1
  fi
  echo "[jobfoundry] Starting services in the background..."
  # Detach from the terminal; output goes to launcher.log.
  # setsid exists on Linux but not macOS — fall back to plain nohup there.
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup "$LAUNCHER" >> "$LOGS_DIR/launcher.log" 2>&1 < /dev/null &
  else
    nohup "$LAUNCHER" >> "$LOGS_DIR/launcher.log" 2>&1 < /dev/null &
  fi
  _record_pid "$!" "$LAUNCHER_PIDFILE"
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
  local pid_info pid
  pid_info="$(_read_pid "$LAUNCHER_PIDFILE" || true)"
  if [ -n "$pid_info" ]; then
    pid="$(awk '{print $1}' <<< "$pid_info")"
    if _is_expected_proc "$pid_info" "launcher"; then
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
    local svc_pid_info svc_pid
    svc_pid_info="$(_read_pid "$f" || true)"
    if [ -n "$svc_pid_info" ]; then
      svc_pid="$(awk '{print $1}' <<< "$svc_pid_info")"
      if _is_expected_proc "$svc_pid_info" "$svc"; then
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
    local lpid
    lpid="$(awk '{print $1}' <<< "$(_read_pid "$LAUNCHER_PIDFILE")")"
    echo "[jobfoundry] launcher: running (pid $lpid)"
  else
    echo "[jobfoundry] launcher: not running"
  fi
  local svc port pidfile pid_info pid state
  for svc in tailor:8081 scorer:8001 ingest:8080; do
    port="${svc##*:}"
    svc="${svc%%:*}"
    pidfile="$RUNTIME_DIR/$svc.pid"
    state="stopped"
    pid_info="$(_read_pid "$pidfile" || true)"
    if [ -n "$pid_info" ] && _is_expected_proc "$pid_info" "$svc"; then
      pid="$(awk '{print $1}' <<< "$pid_info")"
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
  if [ "$_IS_MAC" -eq 1 ] && command -v open >/dev/null 2>&1; then
    open "$DASHBOARD_URL" 2>/dev/null || echo "$DASHBOARD_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
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
