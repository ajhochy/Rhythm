#!/usr/bin/env bash
set -u

# Contract tests for the engine-change desktop smoke launcher.
#
# These tests execute the real launcher in a disposable repo-shaped fixture.
# Only true external boundaries (Flutter, macOS process tools, HTTP, and app
# launch) are faked. The launcher script itself is never mocked.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAUNCHER="$REPO_ROOT/tools/dev/launch_desktop_current.sh"
FRESH_VERSION="0.0.0-contract-fresh"

PASS_COUNT=0
FAIL_COUNT=0
FIXTURE=""
COMMAND_LOG=""
LAUNCHED_MARKER=""
APP_BUNDLE=""
STAGED_ENGINE=""
SOURCE_ENGINE=""
RUN_STATUS=0
RUN_OUTPUT=""

cleanup_fixture() {
  if [[ -n "$FIXTURE" && -d "$FIXTURE" ]]; then
    rm -rf "$FIXTURE"
  fi
}

trap cleanup_fixture EXIT

write_logged_noop() {
  local path="$1"
  cat >"$path" <<'EOF'
#!/usr/bin/env bash
printf '%s' "$(basename "$0")" >>"$COMMAND_LOG"
printf ' %q' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
exit 0
EOF
  chmod +x "$path"
}

setup_fixture() {
  cleanup_fixture
  FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/rhythm-launcher-contract.XXXXXX")"
  FIXTURE="$(cd "$FIXTURE" && pwd)"
  COMMAND_LOG="$FIXTURE/commands.log"
  LAUNCHED_MARKER="$FIXTURE/launched"

  mkdir -p \
    "$FIXTURE/tools/dev" \
    "$FIXTURE/apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app" \
    "$FIXTURE/apps/api_server/opencode_bin" \
    "$FIXTURE/fakebin"
  cp "$LAUNCHER" "$FIXTURE/tools/dev/launch_desktop_current.sh"
  chmod +x "$FIXTURE/tools/dev/launch_desktop_current.sh"

  APP_BUNDLE="$FIXTURE/apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app"
  STAGED_ENGINE="$FIXTURE/apps/api_server/opencode_bin/opencode"
  SOURCE_ENGINE="$FIXTURE/fresh-opencode"

  cat >"$SOURCE_ENGINE" <<EOF
#!/usr/bin/env bash
printf 'opencode-version %q\n' "\$*" >>"\$COMMAND_LOG"
if [[ -f "\$LAUNCHED_MARKER" ]]; then
  printf '%s\n' "\${CONTRACT_RUNTIME_VERSION:-$FRESH_VERSION}"
else
  printf '%s\n' "\${CONTRACT_SOURCE_VERSION:-$FRESH_VERSION}"
fi
EOF
  chmod +x "$SOURCE_ENGINE"

  cat >"$FIXTURE/wrong-opencode" <<'EOF'
#!/usr/bin/env bash
printf 'runtime-opencode-version %q\n' "$*" >>"$COMMAND_LOG"
printf '%s\n' "${CONTRACT_RUNTIME_VERSION:-0.0.0-wrong-runtime}"
EOF
  chmod +x "$FIXTURE/wrong-opencode"

  cat >"$FIXTURE/fakebin/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl' >>"$COMMAND_LOG"
printf ' %q' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
joined="$*"
case "$joined" in
  *localhost:4001/opencode/health*)
    if [[ "${CONTRACT_HEALTH_READY:-true}" == "true" ]]; then
      printf '%s\n' '{"status":"ready","message":"Opencode SDK ready"}'
      exit 0
    fi
    printf '%s\n' '{"status":"error","message":"engine unavailable"}'
    exit 22
    ;;
  *localhost:4001/agents/capabilities*)
    printf '{"opencode":%s}\n' "${CONTRACT_OPENCODE_CAPABILITY:-true}"
    exit 0
    ;;
  *localhost:4000*)
    printf '%s\n' '{"status":"ok"}'
    exit 0
    ;;
esac
exit 22
EOF

  cat >"$FIXTURE/fakebin/lsof" <<'EOF'
#!/usr/bin/env bash
printf 'lsof' >>"$COMMAND_LOG"
printf ' %q' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
if [[ ! -f "$LAUNCHED_MARKER" ]]; then
  exit 0
fi
joined="$*"
if [[ "$joined" == *"4096"* && "$joined" == *"-t"* ]]; then
  printf '%s\n' 4242
elif [[ "$joined" == *"-p 4242"* || "$joined" == *"-p4242"* ]]; then
  engine_path="${CONTRACT_ENGINE_PATH:-$STAGED_ENGINE}"
  printf 'opencode 4242 test txt REG 1,1 1 1 %s\n' "$engine_path"
fi
EOF

  cat >"$FIXTURE/fakebin/flutter" <<'EOF'
#!/usr/bin/env bash
printf 'flutter' >>"$COMMAND_LOG"
printf ' %q' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
exit 0
EOF

  cat >"$FIXTURE/fakebin/open" <<'EOF'
#!/usr/bin/env bash
printf 'open' >>"$COMMAND_LOG"
printf ' %q' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
touch "$LAUNCHED_MARKER"
exit 0
EOF

  cat >"$FIXTURE/fakebin/cp" <<'EOF'
#!/usr/bin/env bash
printf 'cp' >>"$COMMAND_LOG"
printf ' %q' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
if [[ "${*: -1}" == /private/tmp/* ]]; then
  exit 0
fi
exec /bin/cp "$@"
EOF

  cat >"$FIXTURE/fakebin/rm" <<'EOF'
#!/usr/bin/env bash
printf 'rm' >>"$COMMAND_LOG"
printf ' %q' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
if [[ "${*: -1}" == /private/tmp/* ]]; then
  exit 0
fi
exec /bin/rm "$@"
EOF

  cat >"$FIXTURE/fakebin/chmod" <<'EOF'
#!/usr/bin/env bash
printf 'chmod' >>"$COMMAND_LOG"
printf ' %q' "$@" >>"$COMMAND_LOG"
printf '\n' >>"$COMMAND_LOG"
exec /bin/chmod "$@"
EOF

  for command in pkill kill sleep xattr codesign spctl bun npm npx node; do
    write_logged_noop "$FIXTURE/fakebin/$command"
  done
  chmod +x "$FIXTURE/fakebin/"*
}

run_launcher() {
  local source_version="${1:-$FRESH_VERSION}"
  local health_ready="${2:-true}"
  local capability="${3:-true}"
  local engine_path="${4:-$STAGED_ENGINE}"
  local runtime_version="${5:-$FRESH_VERSION}"

  RUN_OUTPUT="$(
    COMMAND_LOG="$COMMAND_LOG" \
    LAUNCHED_MARKER="$LAUNCHED_MARKER" \
    STAGED_ENGINE="$STAGED_ENGINE" \
    CONTRACT_SOURCE_VERSION="$source_version" \
    CONTRACT_HEALTH_READY="$health_ready" \
    CONTRACT_OPENCODE_CAPABILITY="$capability" \
    CONTRACT_ENGINE_PATH="$engine_path" \
    CONTRACT_RUNTIME_VERSION="$runtime_version" \
    RHYTHM_OPENCODE_SOURCE="$SOURCE_ENGINE" \
    RHYTHM_EXPECTED_OPENCODE_VERSION="$FRESH_VERSION" \
    PATH="$FIXTURE/fakebin:/usr/bin:/bin:/usr/sbin:/sbin" \
      bash "$FIXTURE/tools/dev/launch_desktop_current.sh" 2>&1
  )"
  RUN_STATUS=$?
}

log_contains() {
  grep -Fq -- "$1" "$COMMAND_LOG"
}

log_absent() {
  ! log_contains "$1"
}

fail_reason() {
  printf '%s\n' "$1" >&2
  printf '%s\n' "--- command log ---" >&2
  sed -n '1,120p' "$COMMAND_LOG" >&2
  printf '%s\n' "--- launcher output ---" >&2
  printf '%s\n' "$RUN_OUTPUT" >&2
  return 1
}

criterion_c1() {
  # Regression caught: the launcher probes/reuses/starts :4000, allowing that
  # server to seize fixed engine port :4096.
  setup_fixture
  run_launcher
  log_absent "localhost:4000" || {
    fail_reason "launcher still contacts the competing :4000 server"
    return 1
  }
  log_absent "dist/server.js" || {
    fail_reason "launcher still starts apps/api_server/dist/server.js"
    return 1
  }
  for port in 4000 4001 4096; do
    log_contains "$port" || {
      fail_reason "launcher did not inspect listener state for :$port"
      return 1
    }
  done
}

criterion_c2() {
  # Regression caught: a fresh fork is supplied but never staged ahead of the
  # stock ~/.opencode binary, or is staged without executable/version checks.
  setup_fixture
  run_launcher
  [[ -x "$STAGED_ENGINE" ]] || {
    fail_reason "fresh fork was not staged as executable at $STAGED_ENGINE"
    return 1
  }
  [[ "$(
    COMMAND_LOG="$COMMAND_LOG" \
    LAUNCHED_MARKER="$LAUNCHED_MARKER" \
    CONTRACT_RUNTIME_VERSION="$FRESH_VERSION" \
      "$STAGED_ENGINE" --version
  )" == "$FRESH_VERSION" ]] || {
    fail_reason "staged fork does not preserve the supplied build identity"
    return 1
  }
  log_contains "opencode-version" || {
    fail_reason "launcher never executed the staged fork's --version check"
    return 1
  }
}

criterion_c3() {
  # Regression caught: the known stale 1.14.40 engine is accepted and the app
  # launches, invalidating an engine-change smoke.
  setup_fixture
  run_launcher "1.14.40"
  [[ "$RUN_STATUS" -ne 0 ]] || {
    fail_reason "launcher accepted stale opencode version 1.14.40"
    return 1
  }
  log_absent "open " || {
    fail_reason "launcher opened Rhythm after stale engine identity"
    return 1
  }
}

criterion_c4() {
  # Regression caught: copying to /private/tmp breaks repository discovery for
  # the GUI-spawned source agent server.
  setup_fixture
  run_launcher
  log_absent "/private/tmp" || {
    fail_reason "launcher still copies or opens a temporary app bundle"
    return 1
  }
  log_contains "open -na $APP_BUNDLE" || {
    fail_reason "launcher did not open the Debug bundle in the repo build path"
    return 1
  }
}

criterion_c5() {
  # Regression caught: app launch is reported successful even though the
  # app-owned :4001 agent server never reaches opencode-ready health.
  setup_fixture
  run_launcher "$FRESH_VERSION" "false"
  log_contains "localhost:4001/opencode/health" || {
    fail_reason "launcher never queried the app-owned opencode health endpoint"
    return 1
  }
  [[ "$RUN_STATUS" -ne 0 ]] || {
    fail_reason "launcher succeeded despite non-ready :4001 opencode health"
    return 1
  }
}

criterion_c6() {
  # Regression caught: a different executable owns :4096, but the smoke is
  # allowed to continue as if the staged fork were running.
  setup_fixture
  run_launcher "$FRESH_VERSION" "true" "true" "$FIXTURE/wrong-opencode"
  if ! log_contains "lsof" || ! log_contains "4096"; then
    fail_reason "launcher never resolved the process listening on :4096"
    return 1
  fi
  [[ "$RUN_STATUS" -ne 0 ]] || {
    fail_reason "launcher accepted a :4096 executable outside opencode_bin"
    return 1
  }
}

criterion_c7() {
  # Regression caught: :4096 uses the staged path but reports a different build
  # identity, so engine changes under test are not actually present.
  setup_fixture
  run_launcher "$FRESH_VERSION" "true" "true" "$STAGED_ENGINE" "0.0.0-wrong-runtime"
  [[ "$RUN_STATUS" -ne 0 ]] || {
    fail_reason "launcher accepted a running engine with the wrong version"
    return 1
  }
}

criterion_c8() {
  # Regression caught: the app is opened while /agents/capabilities reports
  # opencode=false, leaving the Agents UI unavailable.
  setup_fixture
  run_launcher "$FRESH_VERSION" "true" "false"
  log_contains "localhost:4001/agents/capabilities" || {
    fail_reason "launcher never queried agent capabilities"
    return 1
  }
  [[ "$RUN_STATUS" -ne 0 ]] || {
    fail_reason "launcher succeeded despite opencode=false"
    return 1
  }
}

run_test() {
  local id="$1"
  local description="$2"
  local function_name="$3"
  if "$function_name"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf 'ok - %s: %s\n' "$id" "$description"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf 'not ok - %s: %s\n' "$id" "$description"
  fi
}

run_test "issue-dev-smoke-launcher-c1" \
  "does not run a competing :4000 server and preflights fixed ports" \
  criterion_c1
run_test "issue-dev-smoke-launcher-c2" \
  "stages the supplied fork first, executable, with verified identity" \
  criterion_c2
run_test "issue-dev-smoke-launcher-c3" \
  "rejects the stale system engine version" \
  criterion_c3
run_test "issue-dev-smoke-launcher-c4" \
  "launches the repo Debug bundle without a temporary copy" \
  criterion_c4
run_test "issue-dev-smoke-launcher-c5" \
  "requires app-owned :4001 opencode health readiness" \
  criterion_c5
run_test "issue-dev-smoke-launcher-c6" \
  "requires :4096 to be owned by the staged fork executable" \
  criterion_c6
run_test "issue-dev-smoke-launcher-c7" \
  "requires the running engine build identity to match" \
  criterion_c7
run_test "issue-dev-smoke-launcher-c8" \
  "requires opencode capability before reporting success" \
  criterion_c8

printf '\n%d passed, %d failed\n' "$PASS_COUNT" "$FAIL_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]]
