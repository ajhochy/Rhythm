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
assert_case 'sandbox dir outside temp roots rejected' fail 'must resolve under /private/tmp or /var/folders' \
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

printf '\nsandbox_guard_test: %d passed, %d failed\n' "$pass" "$fail_count"
[[ "$fail_count" -eq 0 ]]
