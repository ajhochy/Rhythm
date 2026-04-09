#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT/apps/desktop_flutter"
SERVER_DIR="$ROOT/apps/api_server"
APP_BUNDLE="$APP_DIR/build/macos/Build/Products/Debug/Rhythm.app"
FRESH_BUNDLE="/private/tmp/Rhythm Current.app"
SERVER_LOG="/tmp/rhythm-current-server.log"
SERVER_PID_FILE="/tmp/rhythm-current-server.pid"
DB_PATH="${RHYTHM_RUNTIME_DB_PATH:-$HOME/Library/Application Support/Rhythm/rhythm.db}"

find_node() {
  local candidates=(
    "/usr/local/bin/node"
    "/opt/homebrew/bin/node"
    "/usr/bin/node"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  return 1
}

ensure_server() {
  if curl -sf "http://localhost:4000/health" >/dev/null 2>&1; then
    printf 'Reusing existing Rhythm API on :4000.\n'
    return 0
  fi

  local node_bin
  node_bin="$(find_node)" || {
    printf 'Could not find node. Install Node.js and try again.\n' >&2
    exit 1
  }

  mkdir -p "$(dirname "$DB_PATH")"

  if [[ ! -f "$SERVER_DIR/dist/server.js" ]]; then
    printf 'Building API server...\n'
    (cd "$SERVER_DIR" && npm run build)
  fi

  printf 'Starting Rhythm API with DB %s\n' "$DB_PATH"
  (
    cd "$SERVER_DIR"
    DB_PATH="$DB_PATH" "$node_bin" dist/server.js >"$SERVER_LOG" 2>&1 &
    echo $! >"$SERVER_PID_FILE"
  )

  for _ in {1..40}; do
    if curl -sf "http://localhost:4000/health" >/dev/null 2>&1; then
      printf 'Rhythm API ready on :4000.\n'
      return 0
    fi
    sleep 0.2
  done

  printf 'Rhythm API did not become ready. See %s\n' "$SERVER_LOG" >&2
  exit 1
}

build_app() {
  printf 'Building desktop app...\n'
  (cd "$APP_DIR" && flutter build macos --debug)
}

launch_app() {
  pkill -f '/private/tmp/Rhythm Current.app/Contents/MacOS/Rhythm' >/dev/null 2>&1 || true
  pkill -f '/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app/Contents/MacOS/Rhythm' >/dev/null 2>&1 || true

  rm -rf "$FRESH_BUNDLE"
  cp -R "$APP_BUNDLE" "$FRESH_BUNDLE"
  open -na "$FRESH_BUNDLE"
  printf 'Launched %s\n' "$FRESH_BUNDLE"
}

main() {
  ensure_server
  build_app
  launch_app
}

main "$@"
