#!/usr/bin/env bash
# Contract: deletion must be opt-out at every teardown call site; PID guards stay closed.
# All fixtures/evidence are retained. rm/kill/network/process inspection are stand-ins.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sandbox.sh"
[[ "$HOME" == "${TMPDIR%/tmp}/home" && "$TMPDIR" == /private/tmp/*/tmp ]] || {
  printf 'Use isolated HOME=$SB/home TMPDIR=$SB/tmp under /private/tmp\n' >&2; exit 1;
}
CASES="$(mktemp -d "$TMPDIR/preserve-contract.XXXXXX")"
failures=0
check() { [[ "$1" == "$2" ]] || { printf 'FAIL: %s (got %q expected %q)\n' "$3" "$1" "$2" >&2; exit 1; }; }
run_case() (
  local name="$1" flag="$2"
  export RHYTHM_SANDBOX_DIR="$CASES/$name"
  if [[ "$flag" == unset ]]; then unset RHYTHM_SANDBOX_PRESERVE_FILES
  else export RHYTHM_SANDBOX_PRESERVE_FILES="$flag"; fi
  source "$SCRIPT"
  mkdir -p "$SB/home" "$SB/tmp" "$SB/relay"
  export HOME="$SB/home" TMPDIR="$SB/tmp"
  printf '101\n' >"$PID_FILE"
  printf '102\n' >"$ENGINE_PID_FILE"
  printf '103\n' >"$RELAY_PID_FILE"
  printf '104\n' >"$FOREGROUND_PID_FILE"
  printf 'evidence\n' >"$SHUTDOWN_FILE"
  printf 'evidence\n' >"$SHUTDOWN_ACK_FILE"
  printf 'synthetic diagnostic\n' >"$LOG_FILE"
  : >"$SB/removals"
  rm() { printf '%s\n' "$*" >>"$SB/removals"; }
  kill() { [[ "$1" == -0 ]] || { printf 'unexpected signal\n' >&2; exit 99; }; return 1; }
  lsof() { :; }
  ps() { printf 'unexpected process inspection\n' >&2; exit 99; }
  curl() { printf 'synthetic health\n'; }
  sleep() { :; }
  case "$name" in
    down*)
      output="$(down)"
      if [[ "$flag" == 1 ]]; then
        check "$(<"$SB/removals")" '' 'preserve down must never invoke rm'
        check "$output" "Sandbox stopped; files preserved: $SB" 'accurate preserve message'
        check "$(<"$ENGINE_PID_FILE")" 102 'engine metadata retained'
        check "$(<"$SHUTDOWN_FILE")" evidence 'shutdown marker retained'
      else
        check "$(wc -l <"$SB/removals" | tr -d ' ')" 2 'default marker + directory removals'
        check "$output" "Sandbox removed: $SB" 'default message'
      fi
      [[ -f "$PID_FILE" && -f "$RELAY_PID_FILE" && -f "$FOREGROUND_PID_FILE" && -f "$SHUTDOWN_ACK_FILE" ]]
      local evidence=("$SB".evidence.*)
      check "$(<"${evidence[0]}/api_server.log")" 'synthetic diagnostic' 'diagnostics retained'
      ;;
    failed*)
      set +e
      (trap cleanup_failed_up EXIT; exit 7)
      local status=$?
      set -e
      check "$status" 7 'failed-up exit preserved'
      if [[ "$flag" == 1 ]]; then check "$(<"$SB/removals")" '' 'failed-up preserve no rm'
      else check "$(wc -l <"$SB/removals" | tr -d ' ')" 1 'failed-up default marker removal'; fi
      ;;
    restart*)
      ENGINE_BIN=/usr/bin/true
      require_owned_api() { printf '101\n'; }
      launch_engine() { printf '202\n' >"$ENGINE_PID_FILE"; }
      kill() { [[ "$1" == -0 && "$2" == 101 ]]; }
      restart_engine
      check "$(<"$ENGINE_PID_FILE")" 202 'replacement metadata consumed'
      if [[ "$flag" == 1 ]]; then
        check "$(<"$SB/removals")" '' 'restart preserve no rm'
        local backups=("$ENGINE_PID_FILE".preserved.*)
        [[ -f "${backups[0]}" ]]
        check "$(<"${backups[0]}")" 102 'old engine metadata backed up'
      else check "$(wc -l <"$SB/removals" | tr -d ' ')" 1 'restart default removal'; fi
      ;;
    guard*)
      lsof() { [[ "$*" == *"TCP:$API_PORT"* ]] && printf '999\n'; return 0; }
      if (down); then exit 1; fi
      check "$(<"$SB/removals")" '' 'ownership refusal before removal'
      ;;
    reuse)
      validate_node() { :; }
      validate_copied_data_inputs() { :; }
      if (up); then exit 1; fi
      check "$(<"$SB/removals")" '' 'existing directory blocks up'
      ;;
  esac
)
for spec in down-unset:unset down-default:0 down-preserve:1 failed-default:0 failed-preserve:1 restart-default:0 restart-preserve:1 guard-default:0 guard-preserve:1 reuse:1; do
  set +e
  (set -e; run_case "${spec%:*}" "${spec#*:}")
  status=$?
  set -e
  if [[ "$status" == 0 ]]; then printf 'PASS %s\n' "$spec"
  else failures=$((failures + 1)); fi
done
# Reject invalid flags before any lifecycle dispatch, including an explicitly empty value.
for value in '' 2 true; do
  if (export RHYTHM_SANDBOX_PRESERVE_FILES="$value"; source "$SCRIPT"); then
    printf 'FAIL invalid flag %q accepted\n' "$value"; failures=$((failures + 1))
  else printf 'PASS invalid flag %q rejected\n' "$value"; fi
done
printf 'Retained contract fixtures: %s; failures: %s\n' "$CASES" "$failures"
[[ "$failures" == 0 ]]
