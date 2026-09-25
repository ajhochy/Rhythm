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
RELAY_ENABLED="${RHYTHM_SANDBOX_RELAY:-0}"
RELAY_PORT="${RHYTHM_SANDBOX_RELAY_PORT:-4100}"
PID_FILE="$SB/api_server.pid"
ENGINE_PID_FILE="$SB/opencode_engine.pid"
LOG_FILE="$SB/api_server.log"
RELAY_PID_FILE="$SB/relay/api_server.pid"
RELAY_LOG_FILE="$SB/relay/api_server.log"
SHUTDOWN_FILE="$SB/shutdown.requested"
FOREGROUND_PID_FILE="$SB/foreground_holder.pid"
SHUTDOWN_ACK_FILE="$SB/shutdown.acknowledged"
ENGINE_BIN="$ENGINE_DIR/dist/opencode-darwin-arm64/bin/opencode"
# Capture the caller's Node before sanitizing PATH; an explicit override wins.
NODE_BIN="${RHYTHM_SANDBOX_NODE_BIN-$(command -v node || true)}"
runtime_env=(
  # Include the engine's PATH additions here so it cannot prepend them ahead
  # of the sandbox Keychain blocker during initialization.
  "PATH=$SB/bin:${ENGINE_BIN%/opencode}:${NODE_BIN%/*}:$SB/home/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
  "HOME=$SB/home"
  "XDG_CONFIG_HOME=$SB/home/.config"
  "XDG_DATA_HOME=$SB/home/.local/share"
  "XDG_CACHE_HOME=$SB/home/.cache"
  "TMPDIR=$SB/tmp"
  "RHYTHM_MCP_SERVER_BIN=$ROOT/apps/mcp_server/dist/index.js"
  "npm_config_offline=true" "npm_config_registry=http://127.0.0.1:9" "npm_config_cache=$SB/npm-cache"
  "DB_CLIENT=sqlite"
  "RHYTHM_OPTIMIZER_MODE=shadow"
  "OPENCODE_DISABLE_MODELS_FETCH=1"
  "OPENCODE_DISABLE_AUTOUPDATE=1"
  "OPENCODE_DISABLE_PROJECT_CONFIG=1"
  "RHYTHM_MANAGED_CHROME=0"
  "PROD_API_URL=http://127.0.0.1:$API_PORT"
  "PORT=$API_PORT"
  "DB_PATH=$SB/rhythm.db"
  "LIVE_ARTIFACT_STORAGE_DIR=$SB/live-artifacts"
  "RHYTHM_MANAGED_TOOL_ROOT=$SB/managed-tools"
  "RHYTHM_TOOL_ARTIFACT_ROOT=$SB/tool-artifacts"
  "MEMORY_VAULT_PATH=$SB/vault"
  "RHYTHM_MANAGED_SKILLS_DIR=$SB/home/.config/opencode/skills"
  "RHYTHM_CREATIVE_RESOURCES_DIR=$API_DIR/resources"
  "RHYTHM_OPENCODE_ENGINE_PORT=$ENGINE_PORT"
  # Cold fork startup can exceed the SDK's production-default 5s on a busy
  # development host; the sandbox keeps a bounded, explicit readiness budget.
  "RHYTHM_OPENCODE_STARTUP_TIMEOUT_MS=60000"
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
  "OPENCODE_DISABLE_EXTERNAL_SKILLS=1"
  "RHYTHM_API_BASE=http://127.0.0.1:$API_PORT"
  "RHYTHM_AGENT_URL=http://127.0.0.1:$API_PORT"
  # Shared-agent live tests pass only the registrar digest into the isolated
  # api_server. The registrar secret itself remains in the invoking test.
  "RHYTHM_AGENT_BRIDGE_REGISTRAR_SHA256=${RHYTHM_SANDBOX_BRIDGE_REGISTRAR_SHA256:-}"
  "MAX_CONCURRENT_AGENT_RUNS=2"
  "AGENT_LOCAL=true"
  # Synthetic harness runs never inherit an operator's promotion opt-in.
  "AUTO_PROMOTION_FEATURE_AVAILABLE=false"
  "RHYTHM_LOCAL_RENDERER_ORIGINS=http://127.0.0.1:4175,rhythm://app"
  # The gateway port is a THIRD listener and was previously unset, so the
  # sandbox bound the default 4002 — the port `tailscale serve` publishes to
  # the tailnet, while serving a fully-credentialed copy of the real DB.
  "RHYTHM_MOBILE_GATEWAY_PORT=$GATEWAY_PORT"
)
relay_runtime_env=(
  "HOME=$SB/relay/home"
  "PORT=$RELAY_PORT"
  "DB_CLIENT=sqlite"
  "DB_PATH=$SB/relay/rhythm.db"
  "LIVE_ARTIFACT_STORAGE_DIR=$SB/relay/live-artifacts"
  "RHYTHM_ROLE=relay"
  "AGENT_LOCAL=false"
  "RHYTHM_NUMBAT_MONITORING_DISABLED=1"
  "RHYTHM_RELAY_PUBLIC_URL=http://127.0.0.1:$RELAY_PORT/relay"
  "RHYTHM_RELAY_ALLOW_INSECURE_LOOPBACK_FOR_TESTS=1"
)
if [[ "$RELAY_ENABLED" == 1 ]]; then
  runtime_env+=("RHYTHM_RELAY_URLS=ws://127.0.0.1:$RELAY_PORT/relay/uplink")
fi

fail() { printf 'sandbox: %s\n' "$*" >&2; exit 1; }

# `env -i` is intentional, but these explicit offline/test-mode switches are
# safe inputs that the engine and api_server need during deterministic live
# verification. Accept only the enabled form so arbitrary caller values never
# leak through the sanitized runtime boundary.
append_enabled_runtime_flag() {
  local name="$1"
  case "${!name:-}" in
    '') ;;
    1) runtime_env+=("$name=1") ;;
    *) fail "$name must be 1 when set" ;;
  esac
}
append_enabled_runtime_flag OPENCODE_DISABLE_DEFAULT_PLUGINS
append_enabled_runtime_flag OPENCODE_PURE
append_enabled_runtime_flag RHYTHM_NUMBAT_MONITORING_DISABLED

# Evidence is a sibling of the disposable runtime, never part of teardown.
preserve_diagnostics() {
  [[ -d "$SB" && ! -L "$SB" && -O "$SB" ]] || return 0
  local evidence
  evidence="$(mktemp -d "$SB.evidence.XXXXXX")" || return 1
  if [[ -f "$PID_FILE" ]]; then
    curl --max-time 3 -sS "http://127.0.0.1:$API_PORT/opencode/health" >"$SB/opencode-health.log" 2>&1 || true
  fi
  python3 -I - "$SB" "$evidence" <<'PY'
import pathlib, re, sys
root, out = map(pathlib.Path, sys.argv[1:])
for path in root.rglob('*.log'):
    if path.is_symlink() or not path.is_file():
        continue
    text = path.read_text(errors='replace')
    text = re.sub(r'(?i)(bearer\s+)\S+', r'\1[REDACTED]', text)
    text = re.sub(r'(?i)([\"\w-]*(?:token|password|secret|api[_-]?key)[\"\w-]*\s*[:=]\s*)(\"[^\"]*\"|\S+)', r'\1[REDACTED]', text)
    dest = out / path.relative_to(root)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
PY
  printf 'sandbox: sanitized diagnostics preserved: %s\n' "$evidence" >&2
}
validate_node() {
  [[ "$NODE_BIN" = /* && -f "$NODE_BIN" && -x "$NODE_BIN" ]] ||
    fail 'RHYTHM_SANDBOX_NODE_BIN (or command -v node) must resolve to an absolute executable file'
  # Construct and query a database so better-sqlite3 loads its N-API prebuild.
  # Resolve from API_DIR instead of reaching through the package exports map.
  env -i "${runtime_env[@]}" "$NODE_BIN" -e '
    const { createRequire } = require("node:module");
    const requireFromApi = createRequire(process.argv[1] + "/package.json");
    const Database = requireFromApi("better-sqlite3");
    const db = new Database(":memory:");
    const row = db.prepare("select 1 as x").get();
    db.close();
    if (row.x !== 1) process.exit(1);
  ' "$API_DIR" || fail "Node $NODE_BIN cannot load installed api_server better-sqlite3; select a compatible RHYTHM_SANDBOX_NODE_BIN"
}
listener() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; }
require_free_port() { [[ -z "$(listener "$1")" ]] || fail "port :$1 is occupied; refusing to touch it"; }
process_executable() {
  lsof -a -p "$1" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

# Ordinary synthetic runs never qualify real Keychain behavior. That remains
# a separate test tier in a dedicated disposable macOS account.
security_shim_content() {
  printf '#!/bin/sh\nprintf "sandbox: Keychain blocked\\n" >&2\nexit 1\n'
}

validate_security_shim() {
  python3 -I - "$SB" <<'PY' || fail 'security shim missing, unowned, or modified; refusing runtime launch'
import os, pathlib, stat, sys
root = pathlib.Path(sys.argv[1])
for path, mode in ((root, 0o700), (root / 'bin', 0o700), (root / 'bin/security', 0o500)):
    info = path.lstat()
    expected_type = stat.S_ISREG if path.name == 'security' else stat.S_ISDIR
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != mode or not expected_type(info.st_mode):
        raise ValueError('unsafe security shim ownership, type, or permissions')
if (root / 'bin/security').read_bytes() != b'#!/bin/sh\nprintf "sandbox: Keychain blocked\\n" >&2\nexit 1\n':
    raise ValueError('unexpected security shim content')
PY
}

prepare_security_shim() {
  [[ -d "$SB" && ! -L "$SB" && -O "$SB" ]] || fail 'security shim requires an owned sandbox directory'
  # Never repair an existing shim silently: tampering must remain a failure.
  if [[ ! -e "$SB/bin" && ! -L "$SB/bin" ]]; then
    mkdir -m 700 "$SB/bin"
    (umask 077; set -o noclobber; security_shim_content >"$SB/bin/security")
    chmod 500 "$SB/bin/security"
  fi
  validate_security_shim
}

# ── Copied-data preflight guard (issue-c6 item 6) ───────────────────────────
#
# `up` copies a live-looking SQLite DB and an opencode config into a
# throwaway sandbox. Before this guard, that source defaulted to this
# operator's REAL rhythm.db/opencode config with no override required — the
# exact footgun this guard closes. `up` now REQUIRES four explicit env vars
# naming an operator-sanitized fixture; there is no default source.

canon() {
  realpath -- "$1" 2>/dev/null || fail "cannot resolve path (does not exist): $1"
}

# Canonicalizes a path that may not exist yet (e.g. RHYTHM_SANDBOX_DIR before
# `up` creates it) by resolving its parent and re-appending the leaf name.
canon_maybe_missing() {
  local p="$1" dir base
  if [[ -e "$p" ]]; then
    canon "$p"
    return
  fi
  dir="$(dirname -- "$p")"
  base="$(basename -- "$p")"
  [[ -d "$dir" ]] || fail "cannot resolve path (parent directory missing): $p"
  printf '%s/%s\n' "$(canon "$dir")" "$base"
}

require_nonempty_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name must be set explicitly — 'up' has no default copied-data source"
}

# The sanitized config must be real: a valid JSON opencode config carrying at
# least one MCP server entry (an empty map is not a usable fixture). Optimizer
# mode is a Rhythm runtime setting, not an OpenCode config key; it is validated
# separately from RHYTHM_OPTIMIZER_MODE below.
validate_sanitized_config() {
  local config_path="$1"
  local json_file="$config_path"
  [[ -f "$json_file" ]] || json_file="$config_path/opencode.json"
  [[ -f "$json_file" ]] || fail "RHYTHM_SANDBOX_OPENCODE_CONFIG has no opencode.json: $config_path"
  command -v jq >/dev/null || fail 'jq is required to validate the sandbox opencode config'
  jq -e . "$json_file" >/dev/null 2>&1 || fail "RHYTHM_SANDBOX_OPENCODE_CONFIG's opencode.json is not valid JSON: $json_file"
  jq -e '.mcp | type == "object" and length > 0 and all(.[];
    type == "object" and .type == "local" and
    (.command | type == "array" and length > 0 and all(.[]; type == "string" and test("\\S"))))
  ' "$json_file" >/dev/null 2>&1 || fail "RHYTHM_SANDBOX_OPENCODE_CONFIG requires a safe MCP map with local command arrays: $json_file"
}

# The single preflight gate `up` calls before touching a process or a file
# outside $SB. Every check fails closed (`fail` exits nonzero) — there is no
# partial/best-effort acceptance.
validate_copied_data_inputs() {
  require_nonempty_env RHYTHM_APPROVED_FIXTURE_ROOT
  require_nonempty_env RHYTHM_LIVE_DB_PATH
  require_nonempty_env RHYTHM_SANDBOX_OPENCODE_CONFIG
  require_nonempty_env RHYTHM_SANDBOX_DIR

  [[ -e "$RHYTHM_APPROVED_FIXTURE_ROOT" ]] || fail "RHYTHM_APPROVED_FIXTURE_ROOT does not exist: $RHYTHM_APPROVED_FIXTURE_ROOT"
  [[ -f "$RHYTHM_LIVE_DB_PATH" ]] || fail "RHYTHM_LIVE_DB_PATH does not exist: $RHYTHM_LIVE_DB_PATH"
  [[ -e "$RHYTHM_SANDBOX_OPENCODE_CONFIG" ]] || fail "RHYTHM_SANDBOX_OPENCODE_CONFIG does not exist: $RHYTHM_SANDBOX_OPENCODE_CONFIG"

  local fixture_root db_path config_path sandbox_dir prohibited
  local prohibited_rhythm_db prohibited_opencode_db
  fixture_root="$(canon "$RHYTHM_APPROVED_FIXTURE_ROOT")"
  db_path="$(canon "$RHYTHM_LIVE_DB_PATH")"
  config_path="$(canon "$RHYTHM_SANDBOX_OPENCODE_CONFIG")"
  sandbox_dir="$(canon_maybe_missing "$RHYTHM_SANDBOX_DIR")"

  prohibited_rhythm_db="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$HOME/Library/Application Support/Rhythm/rhythm.db")" \
    || fail 'cannot canonicalize prohibited Rhythm DB path'
  prohibited_opencode_db="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$HOME/.local/share/opencode/opencode.db")" \
    || fail 'cannot canonicalize prohibited OpenCode DB path'
  for prohibited in "$prohibited_rhythm_db" "$prohibited_opencode_db"
  do
    [[ "$db_path" != "$prohibited" ]] || fail "RHYTHM_LIVE_DB_PATH resolves to a prohibited live path: $db_path"
    [[ "$config_path" != "$prohibited" ]] || fail "RHYTHM_SANDBOX_OPENCODE_CONFIG resolves to a prohibited live path: $config_path"
  done

  case "$db_path" in
    "$fixture_root"/*|"$fixture_root") ;;
    *) fail "RHYTHM_LIVE_DB_PATH must be under RHYTHM_APPROVED_FIXTURE_ROOT ($fixture_root): $db_path" ;;
  esac
  case "$config_path" in
    "$fixture_root"/*|"$fixture_root") ;;
    *) fail "RHYTHM_SANDBOX_OPENCODE_CONFIG must be under RHYTHM_APPROVED_FIXTURE_ROOT ($fixture_root): $config_path" ;;
  esac

  [[ ! -w "$db_path" ]] || fail "RHYTHM_LIVE_DB_PATH must be read-only (chmod a-w it first): $db_path"
  if [[ -f "$config_path" ]]; then
    [[ ! -w "$config_path" ]] || fail "RHYTHM_SANDBOX_OPENCODE_CONFIG must be read-only (chmod a-w it first): $config_path"
  fi

  case "$sandbox_dir" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) ;;
    *) fail "RHYTHM_SANDBOX_DIR must resolve under /tmp, /private/tmp, or /var/folders: $sandbox_dir" ;;
  esac

  case "$db_path" in
    "$sandbox_dir"/*|"$sandbox_dir") fail "RHYTHM_LIVE_DB_PATH must not be inside RHYTHM_SANDBOX_DIR: $db_path" ;;
  esac
  case "$config_path" in
    "$sandbox_dir"/*|"$sandbox_dir") fail "RHYTHM_SANDBOX_OPENCODE_CONFIG must not be inside RHYTHM_SANDBOX_DIR: $config_path" ;;
  esac

  local db_client="${DB_CLIENT:-sqlite}"
  [[ "$db_client" == "sqlite" ]] || fail "sandbox copied-data mode requires DB_CLIENT=sqlite, got '$db_client'"
  local optimizer_mode="${RHYTHM_OPTIMIZER_MODE:-shadow}"
  [[ "$optimizer_mode" == "shadow" ]] || fail "sandbox copied-data mode requires RHYTHM_OPTIMIZER_MODE=shadow, got '$optimizer_mode'"

  validate_sanitized_config "$config_path"
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
  if [[ -n "${RHYTHM_SANDBOX_BRIDGE_REGISTRAR_SHA256:-}" &&
        ! "${RHYTHM_SANDBOX_BRIDGE_REGISTRAR_SHA256}" =~ ^[0-9a-f]{64}$ ]]; then
    fail "RHYTHM_SANDBOX_BRIDGE_REGISTRAR_SHA256 must be a lowercase sha256 digest"
  fi
  [[ "$RELAY_ENABLED" == 0 || "$RELAY_ENABLED" == 1 ]] ||
    fail "RHYTHM_SANDBOX_RELAY must be 0 or 1"
  [[ "$API_PORT" != "$ENGINE_PORT" ]] || fail "sandbox API and engine ports must be different"
  [[ "$GATEWAY_PORT" != "$API_PORT" && "$GATEWAY_PORT" != "$ENGINE_PORT" ]] ||
    fail "sandbox gateway port must differ from the API and engine ports"
  if [[ "$RELAY_ENABLED" == 1 ]]; then
    validate_port RHYTHM_SANDBOX_RELAY_PORT "$RELAY_PORT"
    [[ "$RELAY_PORT" != "$API_PORT" && "$RELAY_PORT" != "$ENGINE_PORT" && "$RELAY_PORT" != "$GATEWAY_PORT" ]] ||
      fail "sandbox relay port must differ from the API, engine, and gateway ports"
  fi
}

copy_runtime_files() {
  local sandbox_home="$SB/home"
  mkdir -p "$sandbox_home/.config/opencode" "$sandbox_home/.local/share/opencode" "$SB/vault" "$SB/live-artifacts" "$SB/tmp"
  chmod 700 "$SB" "$sandbox_home"

  # Copied ONLY from the approved, read-only, operator-sanitized
  # RHYTHM_SANDBOX_OPENCODE_CONFIG fixture (validated by
  # validate_copied_data_inputs before `up` ever reaches this point) — never
  # from this operator's live $HOME.
  local config_src="$RHYTHM_SANDBOX_OPENCODE_CONFIG"
  local config_json="$config_src"
  [[ -f "$config_json" ]] || config_json="$config_src/opencode.json"
  if [[ -f "$config_json" ]]; then
    cp "$config_json" "$sandbox_home/.config/opencode/opencode.json"
    chmod u+w "$sandbox_home/.config/opencode/opencode.json"
  fi
  if [[ -d "$config_src" && -f "$config_src/auth.json" ]]; then
    cp "$config_src/auth.json" "$sandbox_home/.local/share/opencode/auth.json"
  fi
  if [[ -d "$config_src" && -d "$config_src/skills" ]]; then
    cp -R "$config_src/skills" "$sandbox_home/.config/opencode/"
  fi
}

copy_relay_runtime_files() {
  local relay_home="$SB/relay/home"
  mkdir -p "$relay_home/.config/opencode" "$relay_home/.local/share/opencode" \
    "$SB/relay/live-artifacts"
  chmod 700 "$SB/relay" "$relay_home"

  local config_src="$RHYTHM_SANDBOX_OPENCODE_CONFIG"
  local config_json="$config_src"
  [[ -f "$config_json" ]] || config_json="$config_src/opencode.json"
  cp "$config_json" "$relay_home/.config/opencode/opencode.json"
  chmod u+w "$relay_home/.config/opencode/opencode.json"
  if [[ -d "$config_src" && -f "$config_src/auth.json" ]]; then
    cp "$config_src/auth.json" "$relay_home/.local/share/opencode/auth.json"
  fi
  if [[ -d "$config_src" && -d "$config_src/skills" ]]; then
    cp -R "$config_src/skills" "$relay_home/.config/opencode/"
  fi
}

configure_relay_runtime() {
  [[ "$RELAY_ENABLED" == 1 ]] || return 0
  local bearer
  bearer="$(sqlite3 "$SB/rhythm.db" "SELECT token FROM sessions WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1;")"
  [[ -n "$bearer" ]] || fail 'sandbox has no active synthetic session for relay authentication'
  runtime_env+=("RHYTHM_RELAY_BEARER=$bearer")
}

wait_for_relay_ready() {
  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:$RELAY_PORT/health" >/dev/null &&
      curl -fsS "http://127.0.0.1:$RELAY_PORT/relay/health" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "sandbox relay did not become healthy on :$RELAY_PORT"
}

launch_relay() {
  [[ "$RELAY_ENABLED" == 1 ]] || return 0
  nohup env "${relay_runtime_env[@]}" \
    node "$API_DIR/dist/server.js" --parent-pid=1 --rhythm-sandbox="$SB/relay" >"$RELAY_LOG_FILE" 2>&1 &
  printf '%s\n' "$!" >"$RELAY_PID_FILE"
  wait_for_relay_ready
}

cleanup_failed_up() {
  local status=$?
  trap - EXIT
  if ((status != 0)); then
    preserve_diagnostics || true
    stop >/dev/null 2>&1 || true
  fi
  exit "$status"
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
      curl -fsS "http://127.0.0.1:$API_PORT/opencode/health" | jq -e '.status == "ready"' >/dev/null; then
      record_engine_identity
      printf 'Sandbox ready: http://127.0.0.1:%s (engine :%s)\n' "$API_PORT" "$ENGINE_PORT"
      return 0
    fi
    sleep 1
  done
  fail 'sandbox did not become engine-ready; see preserved diagnostics'
}

ensure_rhythm_mcp() {
  local token
  token="$(sqlite3 "$SB/rhythm.db" "SELECT token FROM sessions WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1;")"
  [[ -n "$token" ]] || fail 'sandbox has no active user session for Rhythm MCP'
  curl -fsS -X POST "http://127.0.0.1:$API_PORT/opencode/mcp/rhythm/ensure" \
    -H 'Content-Type: application/json' \
    --data "{\"apiToken\":\"$token\",\"apiUrl\":\"http://127.0.0.1:$API_PORT\"}" >/dev/null
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

build_engine() {
  if [[ "${RHYTHM_SANDBOX_SKIP_ENGINE_BUILD:-0}" == 1 ]]; then
    [[ -x "$ENGINE_BIN" ]] ||
      fail "prebuilt engine is missing or not executable: $ENGINE_BIN"
    return 0
  fi
  [[ "${RHYTHM_SANDBOX_SKIP_ENGINE_BUILD:-0}" == 0 ]] ||
    fail 'RHYTHM_SANDBOX_SKIP_ENGINE_BUILD must be 0 or 1'
  (cd "$ENGINE_DIR" && MODELS_DEV_API_JSON="$ROOT/apps/opencode_fork/packages/opencode/test/tool/fixtures/models-api.json" \
    bun run build --single --skip-install --skip-embed-web-ui) >"$SB/engine-build.log" 2>&1
}

up() {
  local mode="${1:-background}"
  local api_pid

  validate_node
  validate_copied_data_inputs
  safe_sandbox_path
  [[ ! -e "$SB" && ! -L "$SB" ]] || fail 'sandbox directory already exists; refusing to reuse unverified runtime files'
  [[ ! -e "$PID_FILE" ]] || fail "sandbox already has $PID_FILE; run '$0 status' or '$0 down'"
  require_free_port "$API_PORT"
  require_free_port "$ENGINE_PORT"
  require_free_port "$GATEWAY_PORT"
  require_free_port 4175
  if [[ "$RELAY_ENABLED" == 1 ]]; then
    require_free_port "$RELAY_PORT"
  fi
  command -v sqlite3 >/dev/null || fail 'sqlite3 is required'

  trap cleanup_failed_up EXIT
  mkdir -m 700 "$SB"
  prepare_security_shim
  copy_runtime_files
  sqlite3 "$RHYTHM_LIVE_DB_PATH" ".backup '$SB/rhythm.db'"
  if [[ "$RELAY_ENABLED" == 1 ]]; then
    copy_relay_runtime_files
    sqlite3 "$RHYTHM_LIVE_DB_PATH" ".backup '$SB/relay/rhythm.db'"
  fi
  if [[ "$(sqlite3 "$SB/rhythm.db" "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_scheduled_tasks';")" == "1" ]]; then
    sqlite3 "$SB/rhythm.db" 'UPDATE agent_scheduled_tasks SET enabled=0;'
  fi

  build_engine
  (cd "$API_DIR" && npm run build)
  # up() builds the local MCP payload here; under `set -e` a failed build aborts
  # the run, so do NOT re-add a pre-build existence guard (it makes up() fail on
  # any checkout that has not built mcp_server yet). restart() does not build,
  # so it keeps its own guard.
  (cd "$ROOT/apps/mcp_server" && npm run build)
  configure_relay_runtime
  launch_relay

  validate_security_shim
  if [[ "$mode" == foreground ]]; then
    env -i "${runtime_env[@]}" \
      "$NODE_BIN" "$API_DIR/dist/server.js" --parent-pid=1 --rhythm-sandbox="$SB" >"$LOG_FILE" 2>&1 &
  else
    nohup env -i "${runtime_env[@]}" \
      "$NODE_BIN" "$API_DIR/dist/server.js" --parent-pid=1 --rhythm-sandbox="$SB" >"$LOG_FILE" 2>&1 &
  fi
  api_pid="$!"
  printf '%s\n' "$api_pid" >"$PID_FILE"
  if [[ "$mode" == foreground ]]; then
    printf '%s\n' "$$" >"$FOREGROUND_PID_FILE"
  fi

  wait_for_ready
  ensure_rhythm_mcp
  if [[ "$mode" == foreground ]]; then
    wait_in_foreground "$api_pid"
  fi
  trap - EXIT
}

stop_recorded_engine_if_needed() {
  local current_pid recorded_pid executable
  current_pid="$(listener "$ENGINE_PORT")"
  if [[ -n "$current_pid" ]]; then
    [[ "$current_pid" =~ ^[0-9]+$ ]] ||
      fail "sandbox engine port :$ENGINE_PORT has multiple listeners; refusing to kill any process"
    [[ -f "$ENGINE_PID_FILE" ]] ||
      fail "sandbox engine port :$ENGINE_PORT is occupied without a recorded engine PID; refusing to kill it"
  fi
  [[ -f "$ENGINE_PID_FILE" ]] || return 0
  recorded_pid="$(<"$ENGINE_PID_FILE")"
  [[ "$recorded_pid" =~ ^[0-9]+$ ]] || fail "recorded sandbox engine PID is invalid"
  if ! kill -0 "$recorded_pid" 2>/dev/null; then
    [[ -z "$current_pid" ]] ||
      fail "sandbox engine port :$ENGINE_PORT is now PID $current_pid, not live recorded PID $recorded_pid; refusing to kill it"
    return 0
  fi
  [[ -z "$current_pid" || "$current_pid" == "$recorded_pid" ]] ||
    fail "sandbox engine port :$ENGINE_PORT is now PID $current_pid, not recorded PID $recorded_pid; refusing to kill it"
  executable="$(process_executable "$recorded_pid")"
  [[ "$executable" == "$ENGINE_BIN" ]] ||
    fail "recorded engine PID $recorded_pid no longer uses this sandbox's built fork; refusing to kill it"

  kill "$recorded_pid" 2>/dev/null || true
  for _ in {1..10}; do
    ! kill -0 "$recorded_pid" 2>/dev/null && [[ -z "$(listener "$ENGINE_PORT")" ]] && return 0
    sleep 0.2
  done
  kill -KILL "$recorded_pid" 2>/dev/null || true
  for _ in {1..10}; do
    ! kill -0 "$recorded_pid" 2>/dev/null && [[ -z "$(listener "$ENGINE_PORT")" ]] && return 0
    sleep 0.2
  done
  fail "recorded sandbox engine PID $recorded_pid did not exit and release :$ENGINE_PORT"
}

stop_recorded_relay_if_needed() {
  [[ "$RELAY_ENABLED" == 1 ]] || return 0
  local current_pid recorded_pid command
  current_pid="$(listener "$RELAY_PORT")"
  if [[ -n "$current_pid" ]]; then
    [[ "$current_pid" =~ ^[0-9]+$ ]] ||
      fail "sandbox relay port :$RELAY_PORT has multiple listeners; refusing to kill any process"
    [[ -f "$RELAY_PID_FILE" ]] ||
      fail "sandbox relay port :$RELAY_PORT is occupied without a recorded relay PID; refusing to kill it"
  fi
  [[ -f "$RELAY_PID_FILE" ]] || return 0
  recorded_pid="$(<"$RELAY_PID_FILE")"
  [[ "$recorded_pid" =~ ^[0-9]+$ ]] || fail "recorded sandbox relay PID is invalid"
  [[ -z "$current_pid" || "$current_pid" == "$recorded_pid" ]] ||
    fail "sandbox relay port :$RELAY_PORT is now PID $current_pid, not recorded PID $recorded_pid; refusing to kill it"
  if kill -0 "$recorded_pid" 2>/dev/null; then
    command="$(ps -o command= -p "$recorded_pid" 2>/dev/null || true)"
    [[ "$command" == *"$API_DIR/dist/server.js"* && "$command" == *"--rhythm-sandbox=$SB/relay"* ]] ||
      fail "recorded relay PID $recorded_pid no longer belongs to this sandbox; refusing to kill it"
    kill "$recorded_pid" 2>/dev/null || true
    for _ in {1..10}; do
      ! kill -0 "$recorded_pid" 2>/dev/null && [[ -z "$(listener "$RELAY_PORT")" ]] && return 0
      sleep 1
    done
    kill -KILL "$recorded_pid" 2>/dev/null || true
    for _ in {1..10}; do
      ! kill -0 "$recorded_pid" 2>/dev/null && [[ -z "$(listener "$RELAY_PORT")" ]] && return 0
      sleep 0.2
    done
  fi
  [[ -z "$(listener "$RELAY_PORT")" ]] ||
    fail "recorded sandbox relay PID $recorded_pid did not exit and release :$RELAY_PORT"
}

stop() {
  safe_sandbox_path
  local current_pid pid command
  current_pid="$(listener "$API_PORT")"
  if [[ -n "$current_pid" ]]; then
    [[ "$current_pid" =~ ^[0-9]+$ ]] ||
      fail "sandbox API port :$API_PORT has multiple listeners; refusing to kill any process"
    [[ -f "$PID_FILE" ]] ||
      fail "sandbox API port :$API_PORT is occupied without a recorded API PID; refusing to kill it"
  fi
  if [[ -f "$PID_FILE" ]]; then
    pid="$(<"$PID_FILE")"
    [[ "$pid" =~ ^[0-9]+$ ]] || fail "recorded sandbox API PID is invalid"
    [[ -z "$current_pid" || "$current_pid" == "$pid" ]] ||
      fail "sandbox API port :$API_PORT is now PID $current_pid, not recorded PID $pid; refusing to kill it"
    if kill -0 "$pid" 2>/dev/null; then
      command="$(ps -o command= -p "$pid" 2>/dev/null || true)"
      [[ "$command" == *"$API_DIR/dist/server.js"* && "$command" == *"--rhythm-sandbox=$SB"* ]] ||
        fail "PID $pid no longer belongs to this sandbox; refusing to kill it"
      : >"$SHUTDOWN_FILE"
      kill "$pid" 2>/dev/null || true
      for _ in {1..10}; do
        ! kill -0 "$pid" 2>/dev/null && break
        sleep 1
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
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
  stop_recorded_relay_if_needed
  [[ -z "$(listener "$API_PORT")" ]] || fail "sandbox API port :$API_PORT is still occupied"
  [[ -z "$(listener "$ENGINE_PORT")" ]] || fail "sandbox engine port :$ENGINE_PORT is still occupied"
  [[ -z "$(listener "$GATEWAY_PORT")" ]] || fail "sandbox gateway port :$GATEWAY_PORT is still occupied"
  if [[ "$RELAY_ENABLED" == 1 ]]; then
    [[ -z "$(listener "$RELAY_PORT")" ]] || fail "sandbox relay port :$RELAY_PORT is still occupied"
  fi
  rm -f "$PID_FILE" "$ENGINE_PID_FILE" "$RELAY_PID_FILE" "$FOREGROUND_PID_FILE" "$SHUTDOWN_FILE" "$SHUTDOWN_ACK_FILE"
}

restart() {
  local api_pid

  validate_node
  [[ -f "$ROOT/apps/mcp_server/dist/index.js" ]] || fail 'local MCP payload missing; refusing npx fallback'
  safe_sandbox_path
  validate_security_shim
  [[ -f "$SB/rhythm.db" ]] || fail "sandbox DB is missing; run '$0 up' first"
  [[ -d "$SB/home" && -d "$SB/vault" && -d "$SB/live-artifacts" ]] ||
    fail "sandbox runtime directories are incomplete; refusing a partial restart"
  if [[ "$RELAY_ENABLED" == 1 ]]; then
    [[ -d "$SB/relay/home" && -d "$SB/relay/live-artifacts" && -f "$SB/relay/rhythm.db" ]] ||
      fail "sandbox relay runtime is incomplete; refusing a partial restart"
  fi
  [[ -x "$ENGINE_BIN" ]] || fail "sandbox engine binary is missing: $ENGINE_BIN"
  [[ -f "$API_DIR/dist/server.js" ]] || fail "built api_server is missing; run '$0 up' first"

  stop
  require_free_port "$API_PORT"
  require_free_port "$ENGINE_PORT"
  require_free_port "$GATEWAY_PORT"
  if [[ "$RELAY_ENABLED" == 1 ]]; then
    require_free_port "$RELAY_PORT"
    trap cleanup_failed_up EXIT
    configure_relay_runtime
    launch_relay
  fi
  nohup env -i "${runtime_env[@]}" \
    "$NODE_BIN" "$API_DIR/dist/server.js" --parent-pid=1 --rhythm-sandbox="$SB" >"$LOG_FILE" 2>&1 &
  api_pid="$!"
  printf '%s\n' "$api_pid" >"$PID_FILE"
  wait_for_ready
  ensure_rhythm_mcp
  trap - EXIT
  printf 'Sandbox restarted without replacing DB or vault: %s\n' "$SB"
}

require_owned_api() {
  [[ -f "$PID_FILE" ]] || fail "sandbox API PID is missing; run '$0 up' first"
  local pid command
  pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || fail "sandbox API PID file is invalid: $PID_FILE"
  kill -0 "$pid" 2>/dev/null || fail "recorded sandbox API PID $pid is not alive"
  command="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  [[ "$command" == *"--rhythm-sandbox=$SB"* ]] ||
    fail "PID $pid no longer belongs to this sandbox; refusing engine restart"
  printf '%s\n' "$pid"
}

wait_for_engine_ready() {
  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:$ENGINE_PORT/global/health" >/dev/null; then
      record_engine_identity
      return 0
    fi
    sleep 0.25
  done
  fail "replacement engine did not become healthy on :$ENGINE_PORT"
}

launch_engine() {
  validate_security_shim
  (
    cd "$ROOT"
    nohup env -i "${runtime_env[@]}" "$ENGINE_BIN" serve \
      --hostname 127.0.0.1 --port "$ENGINE_PORT" \
      --cors http://127.0.0.1:4175 >>"$LOG_FILE" 2>&1 &
    printf '%s\n' "$!" >"$ENGINE_PID_FILE"
  )
  wait_for_engine_ready
}

restart_engine() {
  safe_sandbox_path
  local api_pid
  api_pid="$(require_owned_api)"
  [[ -d "$SB/home" ]] || fail "sandbox home is missing; run '$0 up' first"
  [[ -x "$ENGINE_BIN" ]] || fail "sandbox engine binary is missing: $ENGINE_BIN"
  stop_recorded_engine_if_needed
  require_free_port "$ENGINE_PORT"
  rm -f "$ENGINE_PID_FILE"
  launch_engine
  kill -0 "$api_pid" 2>/dev/null || fail "sandbox API PID exited during engine restart"
  printf 'Sandbox engine restarted without restarting api_server (PID %s).\n' "$api_pid"
}

down() {
  preserve_diagnostics
  stop
  rm -rf "$SB"
  printf 'Sandbox removed: %s\n' "$SB"
}

status() {
  safe_sandbox_path
  validate_security_shim
  [[ -d "$SB/live-artifacts" ]] || fail "live-artifact storage root is missing"
  printf 'sandbox: %s\nlive-artifact storage: %s\napi :%s listener: %s\nengine :%s listener: %s\ngateway :%s listener: %s\n' \
    "$SB" "$SB/live-artifacts" "$API_PORT" "$(listener "$API_PORT" || true)" "$ENGINE_PORT" "$(listener "$ENGINE_PORT" || true)" "$GATEWAY_PORT" "$(listener "$GATEWAY_PORT" || true)"
  if [[ "$RELAY_ENABLED" == 1 ]]; then
    local relay_pid='missing'
    [[ -d "$SB/relay/live-artifacts" ]] || fail "relay live-artifact storage root is missing"
    [[ ! -f "$RELAY_PID_FILE" ]] || relay_pid="$(<"$RELAY_PID_FILE")"
    printf 'relay api :%s listener: %s\nrelay PID: %s\nrelay storage: %s\n' \
      "$RELAY_PORT" "$(listener "$RELAY_PORT" || true)" \
      "$relay_pid" "$SB/relay/live-artifacts"
  fi
}

usage() {
  printf 'Usage: %s {up [--foreground]|restart|restart-engine|down|status}\n' "$0" >&2
}

# Only dispatch when EXECUTED directly. A test harness sources this file to
# call validate_copied_data_inputs / canon / etc. in isolation — sourcing
# must never trigger a CLI action or `usage; exit 2`.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
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
    restart) restart ;;
    restart-engine) restart_engine ;;
    status) status ;;
    *) usage; exit 2 ;;
  esac
fi
