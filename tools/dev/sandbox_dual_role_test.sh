#!/usr/bin/env bash
# Contract for the opt-in local + relay sandbox lifecycle.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX_SH="$ROOT/tools/dev/sandbox.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail_count=0

check() {
  local description="$1"
  shift
  if "$@"; then
    pass=$((pass + 1))
  else
    fail_count=$((fail_count + 1))
    printf 'FAIL: %s\n' "$description" >&2
  fi
}

# Regression caught: opting nothing in must retain the established three-port,
# one-process sandbox contract.
check 'default topology remains unchanged' env -i PATH="$PATH" HOME="$HOME" \
  RHYTHM_SANDBOX_DIR="$WORK/default" bash -c '
    source "$1"
    [[ "$API_PORT" == 4098 && "$ENGINE_PORT" == 4097 && "$GATEWAY_PORT" == 4099 ]]
    [[ "$RELAY_ENABLED" == 0 ]]
    [[ ! " ${runtime_env[*]} " =~ RHYTHM_RELAY_URLS= ]]
  ' bash "$SANDBOX_SH"

# Regression caught: relay mode forgets one of its independently-owned runtime
# paths or listeners, allowing the two roles to share mutable state.
check 'relay topology models isolated port, PID, log, HOME, DB, and storage' env -i \
  PATH="$PATH" HOME="$HOME" RHYTHM_SANDBOX_DIR="$WORK/relay" \
  RHYTHM_SANDBOX_RELAY=1 RHYTHM_SANDBOX_RELAY_PORT=4200 bash -c '
    source "$1"
    [[ "$RELAY_ENABLED" == 1 && "$RELAY_PORT" == 4200 ]]
    [[ "$RELAY_PID_FILE" == "$SB/relay/api_server.pid" ]]
    [[ "$RELAY_LOG_FILE" == "$SB/relay/api_server.log" ]]
    [[ " ${relay_runtime_env[*]} " =~ HOME=$SB/relay/home ]]
    [[ " ${relay_runtime_env[*]} " =~ DB_PATH=$SB/relay/rhythm.db ]]
    [[ " ${relay_runtime_env[*]} " =~ LIVE_ARTIFACT_STORAGE_DIR=$SB/relay/live-artifacts ]]
    [[ " ${runtime_env[*]} " =~ RHYTHM_RELAY_URLS=ws://127.0.0.1:4200/relay/uplink ]]
  ' bash "$SANDBOX_SH"

# Regression caught: a relay port collision is accepted and startup can touch
# an unrelated listener.
out="$(env -i PATH="$PATH" HOME="$HOME" RHYTHM_SANDBOX_DIR="$WORK/collision" \
  RHYTHM_SANDBOX_RELAY=1 RHYTHM_SANDBOX_RELAY_PORT=4098 \
  bash -c 'source "$1"; safe_sandbox_path' bash "$SANDBOX_SH" 2>&1)"
status=$?
check 'relay port collision fails closed' bash -c \
  '[[ "$1" -ne 0 && "$2" == *"relay port must differ"* ]]' bash "$status" "$out"

# Regression caught: dual-role startup or teardown is added ad hoc without
# owned readiness, shutdown, and failure-cleanup hooks.
check 'dual-role lifecycle hooks are present' env SANDBOX_SH="$SANDBOX_SH" bash -c '
  source "$SANDBOX_SH"
  declare -F launch_relay >/dev/null &&
    declare -F wait_for_relay_ready >/dev/null &&
    declare -F stop_recorded_relay_if_needed >/dev/null &&
    declare -F cleanup_failed_up >/dev/null
  '

# Regression caught: a readiness/build failure after one process starts leaves
# a sandbox-owned listener behind.
FAILURE_SB="$WORK/failure-cleanup"
mkdir -p "$FAILURE_SB"
env -i PATH="$PATH" HOME="$HOME" RHYTHM_SANDBOX_DIR="$FAILURE_SB" \
  RHYTHM_SANDBOX_RELAY=1 bash -c '
    source "$1"
    stop() { : >"$SB/cleanup.called"; }
    trap cleanup_failed_up EXIT
    exit 23
  ' bash "$SANDBOX_SH" >/dev/null 2>&1
status=$?
check 'failed startup invokes owned cleanup and preserves failure status' bash -c \
  '[[ "$1" -eq 23 && -f "$2/cleanup.called" ]]' bash "$status" "$FAILURE_SB"

printf '\nsandbox_dual_role_test: %d passed, %d failed\n' "$pass" "$fail_count"
[[ "$fail_count" -eq 0 ]]
