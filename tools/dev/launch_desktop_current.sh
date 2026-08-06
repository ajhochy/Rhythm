#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT/apps/desktop_flutter"
APP_BUNDLE="$APP_DIR/build/macos/Build/Products/Debug/Rhythm.app"
OPENCODE_PACKAGE="$ROOT/apps/opencode_fork/packages/opencode"
BUILT_ENGINE="$OPENCODE_PACKAGE/dist/opencode-darwin-arm64/bin/opencode"
STAGED_ENGINE="$ROOT/apps/api_server/opencode_bin/opencode"
# In the PACKAGED bundle, opencode_bin is a SIBLING of api_server, so
# opencode_client_service resolves it three levels up from dist/services. Run
# from source (tsx src/server.ts) that same three-up walk lands on
# apps/opencode_bin — not the path above. Staging only one of them leaves a
# stale binary shadowing the fresh build on :4096 (#1305), which is invisible
# because both report the same branch in --version. Stage both.
DEV_SHADOW_ENGINE="$ROOT/apps/opencode_bin/opencode"
HEALTH_URL="http://localhost:4001/opencode/health"
CAPABILITIES_URL="http://localhost:4001/agents/capabilities"
STALE_SYSTEM_VERSION="1.14.40"

fail() {
  printf 'Engine smoke launcher failed: %s\n' "$*" >&2
  exit 1
}

canonical_path() {
  local path="$1"
  local directory
  directory="$(cd "$(dirname "$path")" && pwd -P)"
  printf '%s/%s\n' "$directory" "$(basename "$path")"
}

install_engine() {
  local source_engine="$1"
  local dest="$2"

  mkdir -p "$(dirname "$dest")"
  cp "$source_engine" "$dest"
  chmod +x "$dest"
  xattr -dr com.apple.provenance "$dest" >/dev/null 2>&1 || true

  # Re-sign ad-hoc after copy. `cp` rewrites the file such that the embedded
  # Mach-O signature no longer validates against its on-disk bytes, and Apple
  # Silicon AMFI SIGKILLs (rc=137) any arm64 binary whose signature is invalid.
  # Without this the next `--version` read dies and staging fails.
  codesign --force --sign - "$dest" >/dev/null 2>&1 ||
    fail "could not ad-hoc re-sign staged opencode binary at $dest"
}

stage_engine() {
  local source_engine="${RHYTHM_OPENCODE_SOURCE:-}"

  if [[ -z "$source_engine" ]]; then
    printf 'Building forked opencode engine...\n'
    (cd "$OPENCODE_PACKAGE" && bun run build --single)
    source_engine="$BUILT_ENGINE"
  fi

  [[ -f "$source_engine" ]] ||
    fail "forked opencode binary not found at $source_engine"
  [[ -x "$source_engine" ]] ||
    fail "forked opencode binary is not executable: $source_engine"

  install_engine "$source_engine" "$STAGED_ENGINE"
  install_engine "$source_engine" "$DEV_SHADOW_ENGINE"

  local staged_version
  staged_version="$("$STAGED_ENGINE" --version)" ||
    fail "could not read staged opencode version"
  [[ -n "$staged_version" ]] || fail "staged opencode version is empty"
  [[ "$staged_version" != "$STALE_SYSTEM_VERSION" ]] ||
    fail "staged opencode is stale system version $STALE_SYSTEM_VERSION"

  if [[ -n "${RHYTHM_EXPECTED_OPENCODE_VERSION:-}" ]]; then
    [[ "$staged_version" == "$RHYTHM_EXPECTED_OPENCODE_VERSION" ]] ||
      fail "staged opencode version '$staged_version' does not match expected '$RHYTHM_EXPECTED_OPENCODE_VERSION'"
  fi

  STAGED_VERSION="$staged_version"
  printf 'Staged opencode fork: %s (%s)\n' "$STAGED_ENGINE" "$STAGED_VERSION"
}

clear_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0

  printf 'Stopping existing listener(s) on :%s: %s\n' "$port" "$pids"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill "$pid" >/dev/null 2>&1 || true
  done <<<"$pids"
  sleep 0.5

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill -9 "$pid" >/dev/null 2>&1 || true
  done <<<"$pids"

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$pids" ]] || fail "port :$port is still occupied by $pids"
}

prepare_runtime() {
  pkill -f "$APP_BUNDLE/Contents/MacOS/Rhythm" >/dev/null 2>&1 || true
  for port in 4000 4001 4096; do
    clear_port "$port"
  done
}

build_app() {
  printf 'Building desktop app...\n'
  (cd "$APP_DIR" && flutter build macos --debug)
}

launch_app() {
  open -na "$APP_BUNDLE"
  printf 'Launched %s\n' "$APP_BUNDLE"
}

wait_for_engine_health() {
  local response=""
  for _ in {1..60}; do
    if response="$(curl -fsS "$HEALTH_URL" 2>/dev/null)" &&
      printf '%s' "$response" |
        grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
      printf 'Agent server ready on :4001.\n'
      return 0
    fi
    sleep 0.5
  done
  fail "$HEALTH_URL did not report ready"
}

verify_running_engine() {
  local engine_pid
  local engine_path
  local expected_path
  local running_version

  engine_pid="$(lsof -tiTCP:4096 -sTCP:LISTEN 2>/dev/null | head -1)"
  [[ -n "$engine_pid" ]] || fail "no opencode engine is listening on :4096"

  engine_path="$(lsof -p "$engine_pid" 2>/dev/null |
    awk '$4 == "txt" { print $9; exit }')"
  [[ -n "$engine_path" ]] ||
    fail "could not resolve executable for :4096 PID $engine_pid"

  # Either staged path is legitimate — which one is used depends on whether the
  # server runs from source or from the packaged bundle. Both are written from
  # the same source_engine, so the authoritative check is the CONTENT hash, not
  # the path: two builds differing only by timestamp report an identical
  # --version, so a version match alone never proves the fresh binary is live.
  expected_path="$(canonical_path "$STAGED_ENGINE")"
  engine_path="$(canonical_path "$engine_path")"
  [[ "$engine_path" == "$expected_path" ||
    "$engine_path" == "$(canonical_path "$DEV_SHADOW_ENGINE")" ]] ||
    fail ":4096 is running $engine_path, expected $expected_path or $DEV_SHADOW_ENGINE"

  local running_sha staged_sha
  running_sha="$(shasum -a 256 "$engine_path" | awk '{print $1}')"
  staged_sha="$(shasum -a 256 "$STAGED_ENGINE" | awk '{print $1}')"
  [[ "$running_sha" == "$staged_sha" ]] ||
    fail ":4096 engine at $engine_path is not the freshly staged build (sha256 ${running_sha:0:12} != ${staged_sha:0:12})"

  running_version="$("$engine_path" --version)" ||
    fail "could not read running opencode version"
  [[ "$running_version" == "$STAGED_VERSION" ]] ||
    fail "running opencode version '$running_version' does not match staged '$STAGED_VERSION'"

  printf 'Verified :4096 engine: %s (%s)\n' "$engine_path" "$running_version"
}

verify_capabilities() {
  local response
  response="$(curl -fsS "$CAPABILITIES_URL" 2>/dev/null)" ||
    fail "could not read $CAPABILITIES_URL"
  printf '%s' "$response" |
    grep -Eq '"opencode"[[:space:]]*:[[:space:]]*true' ||
    fail "$CAPABILITIES_URL did not report opencode=true"
  printf 'Verified agent capability: opencode=true.\n'
}

main() {
  stage_engine
  prepare_runtime
  build_app
  launch_app
  wait_for_engine_health
  verify_running_engine
  verify_capabilities
  printf 'Rhythm is ready for an engine-change smoke test.\n'
}

main "$@"
