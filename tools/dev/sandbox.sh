#!/usr/bin/env bash
# Isolated local api_server + opencode engine. Never manages live ports/processes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_DIR="$ROOT/apps/api_server"
ENGINE_DIR="$ROOT/apps/opencode_fork/packages/opencode"
SB="${RHYTHM_SANDBOX_DIR:-${TMPDIR:-/tmp}/rhythm-dev-sandbox}"
API_PORT="${RHYTHM_SANDBOX_API_PORT:-4098}"
ENGINE_PORT="${RHYTHM_SANDBOX_ENGINE_PORT:-4097}"
PID_FILE="$SB/api_server.pid"
LOG_FILE="$SB/api_server.log"
LIVE_DB="${RHYTHM_LIVE_DB_PATH:-$HOME/Library/Application Support/Rhythm/rhythm.db}"

fail() { printf 'sandbox: %s\n' "$*" >&2; exit 1; }
listener() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; }
require_free_port() { [[ -z "$(listener "$1")" ]] || fail "port :$1 is occupied; refusing to touch it"; }

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
  [[ "$API_PORT" != "$ENGINE_PORT" ]] || fail "sandbox API and engine ports must be different"
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

up() {
  safe_sandbox_path
  [[ ! -e "$PID_FILE" ]] || fail "sandbox already has $PID_FILE; run '$0 status' or '$0 down'"
  require_free_port "$API_PORT"
  require_free_port "$ENGINE_PORT"
  command -v sqlite3 >/dev/null || fail 'sqlite3 is required'
  [[ -f "$LIVE_DB" ]] || fail "live SQLite DB not found: $LIVE_DB"

  mkdir -p "$SB"
  copy_runtime_files
  sqlite3 "$LIVE_DB" ".backup '$SB/rhythm.db'"
  sqlite3 "$SB/rhythm.db" 'UPDATE agent_scheduled_tasks SET enabled=0;'

  (cd "$ENGINE_DIR" && bun run build --single)
  (cd "$API_DIR" && npm run build)

  HOME="$SB/home" \
  PORT="$API_PORT" \
  DB_PATH="$SB/rhythm.db" \
  MEMORY_VAULT_PATH="$SB/vault" \
  RHYTHM_MANAGED_SKILLS_DIR="$SB/home/.config/opencode/skills" \
  RHYTHM_OPENCODE_ENGINE_PORT="$ENGINE_PORT" \
  RHYTHM_OPENCODE_BIN_DIR="$ENGINE_DIR/dist/opencode-darwin-arm64/bin" \
  MAX_CONCURRENT_AGENT_RUNS=2 \
  AGENT_LOCAL=true \
  nohup node "$API_DIR/dist/server.js" --parent-pid=1 --rhythm-sandbox="$SB" >"$LOG_FILE" 2>&1 &
  printf '%s\n' "$!" >"$PID_FILE"

  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null &&
      curl -fsS "http://127.0.0.1:$API_PORT/opencode/health" >/dev/null; then
      printf 'Sandbox ready: http://127.0.0.1:%s (engine :%s)\n' "$API_PORT" "$ENGINE_PORT"
      return 0
    fi
    sleep 1
  done
  fail "sandbox did not become healthy; see $LOG_FILE"
}

down() {
  safe_sandbox_path
  if [[ -f "$PID_FILE" ]]; then
    local pid command
    pid="$(<"$PID_FILE")"
    command="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    if [[ -n "$command" ]]; then
      [[ "$command" == *"$SB"* ]] || fail "PID $pid no longer belongs to this sandbox; refusing to kill it"
      kill "$pid" 2>/dev/null || true
      for _ in {1..10}; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    fi
  fi
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

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *) printf 'Usage: %s {up|down|status}\n' "$0" >&2; exit 2 ;;
esac
