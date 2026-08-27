#!/usr/bin/env bash
# Unit tests for tools/dev/sandbox.sh's copied-data preflight guard
# (validate_copied_data_inputs / issue-c6 item 6).
#
# Every fixture here is a disposable temp file/dir this script creates and
# removes under $TMPDIR — NEVER a real production path. This intentionally
# does not run `sandbox.sh up` itself (no fork build, no process launch,
# no real fixture/config was supplied for that this dispatch) — it exercises
# only the preflight guard function in isolation via `source`.
#
# Run: bash tools/dev/sandbox_guard_test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX_SH="$ROOT/tools/dev/sandbox.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail_count=0

# Runs validate_copied_data_inputs in a fresh, isolated child bash process
# with exactly the given env vars set (env -i clears everything else, so a
# real ambient RHYTHM_LIVE_DB_PATH etc. in the caller's shell can never leak
# into a test case). Asserts the expected outcome.
assert_case() {
  local desc="$1" expect="$2" expected_msg="$3"
  shift 3
  local out status
  out="$(env -i PATH="$PATH" HOME="$HOME" "$@" bash -c "source '$SANDBOX_SH'; validate_copied_data_inputs" 2>&1)"
  status=$?
  if [[ "$expect" == "ok" ]]; then
    if [[ "$status" -eq 0 ]]; then
      pass=$((pass + 1))
    else
      fail_count=$((fail_count + 1))
      printf 'FAIL (%s): expected success, got exit %s:\n%s\n' "$desc" "$status" "$out" >&2
    fi
  else
    if [[ "$status" -ne 0 && "$out" == *"$expected_msg"* ]]; then
      pass=$((pass + 1))
    else
      fail_count=$((fail_count + 1))
      printf 'FAIL (%s): expected failure containing %q, got exit %s:\n%s\n' \
        "$desc" "$expected_msg" "$status" "$out" >&2
    fi
  fi
}

# ── Safe fixtures (never a real production path) ───────────────────────────
FIXTURE_ROOT="$WORK/fixture-root"
mkdir -p "$FIXTURE_ROOT"

DB="$FIXTURE_ROOT/rhythm.db"
: >"$DB"
chmod 400 "$DB"

CONFIG_DIR="$FIXTURE_ROOT/opencode-config"
mkdir -p "$CONFIG_DIR"
cat >"$CONFIG_DIR/opencode.json" <<'JSON'
{"mcp": {"rhythm": {"type": "local"}}}
JSON
chmod 400 "$CONFIG_DIR/opencode.json"

SANDBOX_DIR="$WORK/sandbox"

BASE_ENV=(
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT"
  "RHYTHM_LIVE_DB_PATH=$DB"
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR"
  "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"
)

# ── 1. The safe fixture must be accepted ────────────────────────────────────
assert_case 'safe fixture accepted' ok '' "${BASE_ENV[@]}"

# ── 2. Each required var missing is rejected ────────────────────────────────
assert_case 'missing RHYTHM_APPROVED_FIXTURE_ROOT' fail 'must be set explicitly' \
  "RHYTHM_LIVE_DB_PATH=$DB" "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"
assert_case 'missing RHYTHM_LIVE_DB_PATH' fail 'must be set explicitly' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"
assert_case 'missing RHYTHM_SANDBOX_OPENCODE_CONFIG' fail 'must be set explicitly' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_LIVE_DB_PATH=$DB" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"
assert_case 'missing RHYTHM_SANDBOX_DIR' fail 'must be set explicitly' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_LIVE_DB_PATH=$DB" "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR"

# ── 3. Exact prohibited live paths are rejected even if they happen to exist ─
PROHIBITED_DIR="$WORK/prohibited-home/Library/Application Support/Rhythm"
mkdir -p "$PROHIBITED_DIR"
PROHIBITED_DB="$PROHIBITED_DIR/rhythm.db"
: >"$PROHIBITED_DB"
chmod 400 "$PROHIBITED_DB"
assert_case 'prohibited live db path rejected' fail 'prohibited live path' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$WORK/prohibited-home" \
  "RHYTHM_LIVE_DB_PATH=$PROHIBITED_DB" \
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR" \
  "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR" \
  "HOME=$WORK/prohibited-home"

# ── 4. Source DB outside the approved fixture root is rejected ─────────────
OUTSIDE_DB="$WORK/outside/rhythm.db"
mkdir -p "$WORK/outside"
: >"$OUTSIDE_DB"
chmod 400 "$OUTSIDE_DB"
assert_case 'db outside fixture root rejected' fail 'must be under RHYTHM_APPROVED_FIXTURE_ROOT' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_LIVE_DB_PATH=$OUTSIDE_DB" \
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"

# ── 5. A writable (not read-only) source DB is rejected ────────────────────
WRITABLE_DB="$FIXTURE_ROOT/writable.db"
: >"$WRITABLE_DB"
chmod 600 "$WRITABLE_DB"
assert_case 'writable source db rejected' fail 'must be read-only' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_LIVE_DB_PATH=$WRITABLE_DB" \
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"

# ── 6. A sandbox dir outside /private/tmp or /var/folders is rejected ──────
assert_case 'sandbox dir outside temp roots rejected' fail 'RHYTHM_SANDBOX_DIR must resolve under /tmp, /private/tmp, or /var/folders' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_LIVE_DB_PATH=$DB" \
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR" "RHYTHM_SANDBOX_DIR=$HOME/not-a-temp-dir"

# ── 7. A source nested inside the sandbox dir is rejected ──────────────────
NESTED_ROOT="$SANDBOX_DIR/fixture-root"
mkdir -p "$NESTED_ROOT"
NESTED_DB="$NESTED_ROOT/rhythm.db"
: >"$NESTED_DB"
chmod 400 "$NESTED_DB"
NESTED_CONFIG_DIR="$NESTED_ROOT/opencode-config"
mkdir -p "$NESTED_CONFIG_DIR"
cp "$CONFIG_DIR/opencode.json" "$NESTED_CONFIG_DIR/opencode.json"
chmod 400 "$NESTED_CONFIG_DIR/opencode.json"
assert_case 'source nested inside sandbox dir rejected' fail 'must not be inside RHYTHM_SANDBOX_DIR' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$NESTED_ROOT" "RHYTHM_LIVE_DB_PATH=$NESTED_DB" \
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$NESTED_CONFIG_DIR" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"

# ── 8. DB_CLIENT=postgres is rejected (copied-data mode is sqlite-only) ────
assert_case 'DB_CLIENT=postgres rejected' fail "requires DB_CLIENT=sqlite" \
  "DB_CLIENT=postgres" "${BASE_ENV[@]}"

# ── 9. An empty MCP map is rejected ─────────────────────────────────────────
EMPTY_MCP_DIR="$FIXTURE_ROOT/empty-mcp-config"
mkdir -p "$EMPTY_MCP_DIR"
cat >"$EMPTY_MCP_DIR/opencode.json" <<'JSON'
{"mcp": {}}
JSON
chmod 400 "$EMPTY_MCP_DIR/opencode.json"
assert_case 'empty MCP map rejected' fail 'empty MCP map' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_LIVE_DB_PATH=$DB" \
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$EMPTY_MCP_DIR" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"

# ── 10. A non-shadow Rhythm optimizer mode is rejected ──────────────────────
assert_case 'non-shadow optimizer mode rejected' fail 'RHYTHM_OPTIMIZER_MODE=shadow' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_LIVE_DB_PATH=$DB" \
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR" \
  "RHYTHM_OPTIMIZER_MODE=acting"

# ── 11. A schema-valid config with no Rhythm-only keys is accepted ──────────
NO_OPTIMIZER_DIR="$FIXTURE_ROOT/no-optimizer-config"
mkdir -p "$NO_OPTIMIZER_DIR"
cat >"$NO_OPTIMIZER_DIR/opencode.json" <<'JSON'
{"mcp": {"rhythm": {"type": "local"}}}
JSON
chmod 400 "$NO_OPTIMIZER_DIR/opencode.json"
assert_case 'schema-valid OpenCode config accepted' ok '' \
  "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" "RHYTHM_LIVE_DB_PATH=$DB" \
  "RHYTHM_SANDBOX_OPENCODE_CONFIG=$NO_OPTIMIZER_DIR" "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"

# ── 12. Missing live-data parent directories do not weaken or break preflight ─
FRESH_HOME="$FIXTURE_ROOT/fresh-home"
mkdir -p "$FRESH_HOME"
assert_case 'safe fixture accepted when live-data parents do not exist' ok '' \
  "HOME=$FRESH_HOME" "RHYTHM_APPROVED_FIXTURE_ROOT=$FIXTURE_ROOT" \
  "RHYTHM_LIVE_DB_PATH=$DB" "RHYTHM_SANDBOX_OPENCODE_CONFIG=$CONFIG_DIR" \
  "RHYTHM_SANDBOX_DIR=$SANDBOX_DIR"

# ── 13. restart-engine refuses an engine not owned by this sandbox ──────────
RESTART_SB="$WORK/restart-refusal"
FAKE_ENGINE_DIR="$WORK/fake-engine"
mkdir -p "$RESTART_SB/home" "$FAKE_ENGINE_DIR/dist/opencode-darwin-arm64/bin"
FAKE_ENGINE_BIN="$FAKE_ENGINE_DIR/dist/opencode-darwin-arm64/bin/opencode"
cat >"$FAKE_ENGINE_BIN" <<'SH'
#!/usr/bin/env bash
exit 99
SH
chmod +x "$FAKE_ENGINE_BIN"
out="$(env RHYTHM_SANDBOX_DIR="$RESTART_SB" RHYTHM_SANDBOX_ENGINE_DIR="$FAKE_ENGINE_DIR" \
  bash -c '
    source "$1"
    printf "4242\n" >"$PID_FILE"
    trap "[[ -f $SB/fake-listener.pid ]] && builtin kill \$(< $SB/fake-listener.pid) 2>/dev/null || true" EXIT
    printf "5252\n" >"$ENGINE_PID_FILE"
    kill() { [[ "$1" == "-0" ]]; }
    ps() { printf "node server.js --rhythm-sandbox=%s\n" "$SB"; }
    listener() { [[ "$1" == "$ENGINE_PORT" ]] && printf "5252\n"; }
    process_executable() { printf "/not-this-sandbox/opencode\n"; }
    restart_engine
  ' bash "$SANDBOX_SH" 2>&1)"
status=$?
if [[ "$status" -ne 0 && "$out" == *"no longer uses this sandbox"* ]]; then
  pass=$((pass + 1))
else
  fail_count=$((fail_count + 1))
  printf 'FAIL (restart-engine ownership refusal): exit %s:\n%s\n' "$status" "$out" >&2
fi

# ── 14. restart-engine preserves API, isolates env, rewrites PID, and cleans ─
RESTART_SB="$WORK/restart-success"
mkdir -p "$RESTART_SB/home" "$RESTART_SB/vault" "$RESTART_SB/live-artifacts"
printf 'prior-log-line\n' >"$RESTART_SB/api_server.log"
cat >"$FAKE_ENGINE_BIN" <<'SH'
#!/usr/bin/env bash
sb="$(dirname "$HOME")"
printf '%s\n' "$$" >"$sb/fake-listener.pid"
printf '%s\n' "$HOME|$OPENCODE_DB|$RHYTHM_API_BASE|${OPENCODE_CONFIG_CONTENT-unset}|$OPENCODE_DISABLE_EXTERNAL_SKILLS|$PWD" >"$sb/engine.env"
printf '%s\n' "$*" >"$sb/engine.args"
exec sleep 300
SH
chmod +x "$FAKE_ENGINE_BIN"
out="$(env RHYTHM_SANDBOX_DIR="$RESTART_SB" RHYTHM_SANDBOX_ENGINE_DIR="$FAKE_ENGINE_DIR" \
  bash -c '
    source "$1"
    : >"$SB/api.alive"
    printf "4242\n" >"$PID_FILE"
    sleep 300 & old_engine=$!
    trap "builtin kill $old_engine 2>/dev/null || true; [[ -f $SB/fake-listener.pid ]] && builtin kill \$(< $SB/fake-listener.pid) 2>/dev/null || true" EXIT
    printf "%s\n" "$old_engine" >"$SB/fake-listener.pid"
    printf "%s\n" "$old_engine" >"$ENGINE_PID_FILE"
    kill() {
      if [[ "$1" == "-0" && "$2" == "4242" ]]; then [[ -e "$SB/api.alive" ]]; return; fi
      if [[ "$1" == "4242" ]]; then rm -f "$SB/api.alive"; printf "api\n" >>"$SB/kills"; return; fi
      builtin kill "$@"
    }
    ps() { printf "node server.js --rhythm-sandbox=%s\n" "$SB"; }
    listener() {
      [[ "$1" == "$ENGINE_PORT" && -f "$SB/fake-listener.pid" ]] || return 0
      local pid="$(<"$SB/fake-listener.pid")"
      builtin kill -0 "$pid" 2>/dev/null && printf "%s\n" "$pid"
    }
    process_executable() { printf "%s\n" "$ENGINE_BIN"; }
    curl() { [[ -n "$(listener "$ENGINE_PORT")" ]]; }
    restart_engine
    new_engine="$(<"$ENGINE_PID_FILE")"
    [[ "$(<"$PID_FILE")" == "4242" && "$new_engine" != "$old_engine" ]]
    [[ "$(<"$SB/engine.env")" == "$SB/home|opencode-rhythm-sandbox.db|http://127.0.0.1:4098|unset|1|$ROOT" ]]
    [[ "$(<"$SB/engine.args")" == "serve --hostname 127.0.0.1 --port 4097 --cors http://127.0.0.1:4175" ]]
    [[ "$(<"$LOG_FILE")" == "prior-log-line" ]]
    down
    [[ ! -e "$SB" ]]
    ! builtin kill -0 "$new_engine" 2>/dev/null
  ' bash "$SANDBOX_SH" 2>&1)"
status=$?
if [[ "$status" -eq 0 ]]; then
  pass=$((pass + 1))
else
  fail_count=$((fail_count + 1))
  printf 'FAIL (restart-engine lifecycle): exit %s:\n%s\n' "$status" "$out" >&2
fi

# ── 15. failed replacement readiness remains owned and cleanable ────────────
RESTART_SB="$WORK/restart-timeout"
mkdir -p "$RESTART_SB/home" "$RESTART_SB/live-artifacts"
out="$(env RHYTHM_SANDBOX_DIR="$RESTART_SB" RHYTHM_SANDBOX_ENGINE_DIR="$FAKE_ENGINE_DIR" \
  bash -c '
    source "$1"
    printf "4242\n" >"$PID_FILE"
    kill() {
      if [[ "$1" == "-0" && "$2" == "4242" ]]; then return 0; fi
      builtin kill "$@"
    }
    ps() { printf "node server.js --rhythm-sandbox=%s\n" "$SB"; }
    listener() {
      [[ "$1" == "$ENGINE_PORT" && -f "$SB/fake-listener.pid" ]] || return 0
      local pid="$(<"$SB/fake-listener.pid")"
      builtin kill -0 "$pid" 2>/dev/null && printf "%s\n" "$pid"
    }
    process_executable() { printf "%s\n" "$ENGINE_BIN"; }
    wait_for_engine_ready() { return 1; }
    launch_engine || true
    [[ -f "$ENGINE_PID_FILE" ]] || exit 91
    down
    [[ ! -e "$SB" ]]
  ' bash "$SANDBOX_SH" 2>&1)"
status=$?
if [[ "$status" -eq 0 ]]; then
  pass=$((pass + 1))
else
  fail_count=$((fail_count + 1))
  printf 'FAIL (restart-engine readiness timeout cleanup): exit %s:\n%s\n' "$status" "$out" >&2
fi

printf '\nsandbox_guard_test: %d passed, %d failed\n' "$pass" "$fail_count"
[[ "$fail_count" -eq 0 ]]
