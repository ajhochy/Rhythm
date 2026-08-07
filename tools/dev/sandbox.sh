#!/usr/bin/env bash
# Isolated local api_server + opencode engine. Never manages live ports/processes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_DIR="$ROOT/apps/api_server"
# Overridable so harnesses can reuse an already-built fork binary from a
# sibling worktree with an identical fork tree instead of rebuilding (~10 min).
ENGINE_DIR="${RHYTHM_SANDBOX_ENGINE_DIR:-$ROOT/apps/opencode_fork/packages/opencode}"
SB="${RHYTHM_SANDBOX_DIR:-${TMPDIR:-/tmp}/rhythm-dev-sandbox}"
API_PORT="${RHYTHM_SANDBOX_API_PORT:-4098}"
ENGINE_PORT="${RHYTHM_SANDBOX_ENGINE_PORT:-4097}"
GATEWAY_PORT="${RHYTHM_SANDBOX_GATEWAY_PORT:-4099}"
PID_FILE="$SB/api_server.pid"
ENGINE_PID_FILE="$SB/opencode_engine.pid"
LOG_FILE="$SB/api_server.log"
SHUTDOWN_FILE="$SB/shutdown.requested"
FOREGROUND_PID_FILE="$SB/foreground_holder.pid"
SHUTDOWN_ACK_FILE="$SB/shutdown.acknowledged"
ENGINE_BIN="$ENGINE_DIR/dist/opencode-darwin-arm64/bin/opencode"
LIVE_DB="${RHYTHM_LIVE_DB_PATH:-$HOME/Library/Application Support/Rhythm/rhythm.db}"

fail() { printf 'sandbox: %s\n' "$*" >&2; exit 1; }
listener() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; }
require_free_port() { [[ -z "$(listener "$1")" ]] || fail "port :$1 is occupied; refusing to touch it"; }
process_executable() {
  lsof -a -p "$1" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

validate_port() {
  local label="$1"
  local port="$2"
  [[ "$port" =~ ^[0-9]+$ ]] || fail "$label must be an integer TCP port"
  ((port >= 1024 && port <= 65535)) || fail "$label must be between 1024 and 65535"
}

safe_sandbox_path() {
  [[ "$SB" = /* && "$SB" != / && "$SB" != "$HOME" ]] || fail "RHYTHM_SANDBOX_DIR must be an absolute non-home path"
  validate_port RHYTHM_SANDBOX_API_PORT "$API_PORT"
  validate_port RHYTHM_SANDBOX_ENGINE_PORT "$ENGINE_PORT"
  validate_port RHYTHM_SANDBOX_GATEWAY_PORT "$GATEWAY_PORT"
  [[ "$API_PORT" != "$ENGINE_PORT" ]] || fail "sandbox API and engine ports must be different"
  [[ "$GATEWAY_PORT" != "$API_PORT" && "$GATEWAY_PORT" != "$ENGINE_PORT" ]] ||
    fail "sandbox gateway port must differ from the API and engine ports"
}

copy_runtime_files() {
  local sandbox_home="$SB/home"
  mkdir -p "$sandbox_home/.config/opencode" "$sandbox_home/.local/share/opencode" "$SB/vault"
  chmod 700 "$SB" "$sandbox_home"
  if [[ -f "$HOME/.local/share/opencode/auth.json" ]]; then
    cp "$HOME/.local/share/opencode/auth.json" "$sandbox_home/.local/share/opencode/auth.json"
  fi
  if [[ -d "$HOME/.config/opencode/skills" ]]; then
    cp -R "$HOME/.config/opencode/skills" "$sandbox_home/.config/opencode/"
  fi
}

record_engine_identity() {
  local pid executable
  for _ in {1..50}; do
    pid="$(listener "$ENGINE_PORT")"
    if [[ -z "$pid" ]]; then
      sleep 0.1
      continue
    fi
    [[ "$pid" =~ ^[0-9]+$ ]] ||
      fail "expected exactly one engine listener on :$ENGINE_PORT after readiness; refusing ambiguous ownership"
    executable="$(process_executable "$pid")"
    [[ "$executable" == "$ENGINE_BIN" ]] ||
      fail "engine listener PID $pid does not use this sandbox's built fork; refusing to record it"
    printf '%s\n' "$pid" >"$ENGINE_PID_FILE"
    return 0
  done
  fail "engine listener on :$ENGINE_PORT did not appear after API readiness"
}

wait_for_ready() {
  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null &&
      curl -fsS "http://127.0.0.1:$API_PORT/opencode/health" >/dev/null; then
      record_engine_identity
      printf 'Sandbox ready: http://127.0.0.1:%s (engine :%s)\n' "$API_PORT" "$ENGINE_PORT"
      return 0
    fi
    sleep 1
  done
  # `down` deletes $SB, so a copy that outlives teardown is the only way the
  # cause survives. Surface the tail inline too: the common failure is a port
  # bind (EADDRINUSE) that is otherwise invisible.
  local rescued="${TMPDIR:-/tmp}/rhythm-sandbox-failure-$(date +%Y%m%dT%H%M%S).log"
  if [[ -f "$LOG_FILE" ]]; then
    cp "$LOG_FILE" "$rescued" 2>/dev/null || true
    printf 'sandbox: last 20 log lines ------------------------------------\n' >&2
    tail -n 20 "$LOG_FILE" >&2 || true
    printf 'sandbox: ---------------------------------------------------------\n' >&2
    fail "sandbox did not become healthy; log copied to $rescued"
  fi
  fail "sandbox did not become healthy; no log at $LOG_FILE"
}

wait_in_foreground() {
  local pid="$1"
  local wait_status=0

  forward_signal() {
    local signal="$1"
    kill "-$signal" "$pid" 2>/dev/null || true
  }

  trap 'forward_signal TERM' TERM
  trap 'forward_signal INT' INT
  trap 'forward_signal HUP' HUP

  printf 'Sandbox foreground hold active (PID %s); run %q down from another shell to stop it.\n' \
    "$pid" "$0"
  wait "$pid" || wait_status="$?"

  trap - TERM INT HUP
  if [[ -e "$SHUTDOWN_FILE" ]]; then
    : >"$SHUTDOWN_ACK_FILE"
    return 0
  fi
  return "$wait_status"
}

up() {
  local mode="${1:-background}"
  local -a runtime_env=(
    "HOME=$SB/home"
    "PORT=$API_PORT"
    "DB_PATH=$SB/rhythm.db"
    "MEMORY_VAULT_PATH=$SB/vault"
    "RHYTHM_MANAGED_SKILLS_DIR=$SB/home/.config/opencode/skills"
    "RHYTHM_CREATIVE_RESOURCES_DIR=$API_DIR/resources"
    "RHYTHM_OPENCODE_ENGINE_PORT=$ENGINE_PORT"
    "RHYTHM_OPENCODE_BIN_DIR=${ENGINE_BIN%/opencode}"
    # #1332 — name the sandbox's engine session store EXPLICITLY.
    #
    # HOME above already redirects the engine's data dir, so this is belt-and-
    # braces rather than the sole isolation. It is worth stating anyway: the
    # engine used to get accidental per-branch stores because our build stamps
    # the channel with the git branch, and api_server now pins the stable
    # `opencode.db` so real work is never branch-scoped. A sandbox must not
    # inherit that pin and start writing live-looking session names — declare a
    # distinct file so the isolation is visible in the filename, not implied.
    # OPENCODE_DB is checked FIRST in the engine's storage/db.ts Path, so this
    # wins over the api_server default.
    "OPENCODE_DB=opencode-rhythm-sandbox.db"
    "MAX_CONCURRENT_AGENT_RUNS=2"
    "AGENT_LOCAL=true"
    # The gateway port is a THIRD listener and was previously unset, so the
    # sandbox bound the default 4002 — the port `tailscale serve` publishes to
    # the tailnet, while serving a fully-credentialed copy of the real DB.
    "RHYTHM_MOBILE_GATEWAY_PORT=$GATEWAY_PORT"
  )
  local api_pid

  safe_sandbox_path
  [[ ! -e "$PID_FILE" ]] || fail "sandbox already has $PID_FILE; run '$0 status' or '$0 down'"
  require_free_port "$API_PORT"
  require_free_port "$ENGINE_PORT"
  require_free_port "$GATEWAY_PORT"
  command -v sqlite3 >/dev/null || fail 'sqlite3 is required'
  [[ -f "$LIVE_DB" ]] || fail "live SQLite DB not found: $LIVE_DB"

  mkdir -p "$SB"
  copy_runtime_files
  sqlite3 "$LIVE_DB" ".backup '$SB/rhythm.db'"
  if [[ "$(sqlite3 "$SB/rhythm.db" "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_scheduled_tasks';")" == "1" ]]; then
    sqlite3 "$SB/rhythm.db" 'UPDATE agent_scheduled_tasks SET enabled=0;'
  fi

  (cd "$ENGINE_DIR" && bun run build --single)
  (cd "$API_DIR" && npm run build)

  if [[ "$mode" == foreground ]]; then
    env "${runtime_env[@]}" \
      node "$API_DIR/dist/server.js" --parent-pid=1 --rhythm-sandbox="$SB" >"$LOG_FILE" 2>&1 &
  else
    nohup env "${runtime_env[@]}" \
      node "$API_DIR/dist/server.js" --parent-pid=1 --rhythm-sandbox="$SB" >"$LOG_FILE" 2>&1 &
  fi
  api_pid="$!"
  printf '%s\n' "$api_pid" >"$PID_FILE"
  if [[ "$mode" == foreground ]]; then
    printf '%s\n' "$$" >"$FOREGROUND_PID_FILE"
  fi

  wait_for_ready
  if [[ "$mode" == foreground ]]; then
    wait_in_foreground "$api_pid"
  fi
}

stop_recorded_engine_if_needed() {
  local current_pid recorded_pid executable
  current_pid="$(listener "$ENGINE_PORT")"
  [[ -n "$current_pid" ]] || return 0
  [[ "$current_pid" =~ ^[0-9]+$ ]] ||
    fail "sandbox engine port :$ENGINE_PORT has multiple listeners; refusing to kill any process"
  [[ -f "$ENGINE_PID_FILE" ]] ||
    fail "sandbox engine port :$ENGINE_PORT is occupied without a recorded engine PID; refusing to kill it"
  recorded_pid="$(<"$ENGINE_PID_FILE")"
  [[ "$current_pid" == "$recorded_pid" ]] ||
    fail "sandbox engine port :$ENGINE_PORT is now PID $current_pid, not recorded PID $recorded_pid; refusing to kill it"
  executable="$(process_executable "$current_pid")"
  [[ "$executable" == "$ENGINE_BIN" ]] ||
    fail "recorded engine PID $current_pid no longer uses this sandbox's built fork; refusing to kill it"

  kill "$current_pid" 2>/dev/null || true
  for _ in {1..10}; do
    [[ -z "$(listener "$ENGINE_PORT")" ]] && return 0
    sleep 0.2
  done
  kill -KILL "$current_pid" 2>/dev/null || true
  for _ in {1..10}; do
    [[ -z "$(listener "$ENGINE_PORT")" ]] && return 0
    sleep 0.2
  done
  fail "recorded sandbox engine PID $current_pid did not release :$ENGINE_PORT"
}

down() {
  safe_sandbox_path
  if [[ -f "$PID_FILE" ]]; then
    local pid command
    pid="$(<"$PID_FILE")"
    command="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    if [[ -n "$command" ]]; then
      [[ "$command" == *"$SB"* ]] || fail "PID $pid no longer belongs to this sandbox; refusing to kill it"
      : >"$SHUTDOWN_FILE"
      kill "$pid" 2>/dev/null || true
      for _ in {1..10}; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    fi
  fi
  if [[ -f "$FOREGROUND_PID_FILE" ]]; then
    local holder_pid
    holder_pid="$(<"$FOREGROUND_PID_FILE")"
    for _ in {1..50}; do
      [[ -e "$SHUTDOWN_ACK_FILE" ]] && break
      kill -0 "$holder_pid" 2>/dev/null || break
      sleep 0.1
    done
  fi
  stop_recorded_engine_if_needed
  [[ -z "$(listener "$API_PORT")" ]] || fail "sandbox API port :$API_PORT is still occupied"
  [[ -z "$(listener "$ENGINE_PORT")" ]] || fail "sandbox engine port :$ENGINE_PORT is still occupied"
  rm -rf "$SB"
  printf 'Sandbox removed: %s\n' "$SB"
}

status() {
  safe_sandbox_path
  printf 'sandbox: %s\napi :%s listener: %s\nengine :%s listener: %s\n' \
    "$SB" "$API_PORT" "$(listener "$API_PORT" || true)" "$ENGINE_PORT" "$(listener "$ENGINE_PORT" || true)"
}

usage() {
  printf 'Usage: %s {up [--foreground]|down|status}\n' "$0" >&2
}

case "${1:-}" in
  up)
    case "${2:-}" in
      '') up background ;;
      --foreground)
        [[ "$#" -eq 2 ]] || { usage; exit 2; }
        up foreground
        ;;
      *) usage; exit 2 ;;
    esac
    ;;
  down) down ;;
  status) status ;;
  *) usage; exit 2 ;;
esac
