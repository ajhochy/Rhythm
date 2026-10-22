#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
export RHYTHM_SANDBOX_DIR="${RHYTHM_SANDBOX_DIR:?Choose a new sandbox directory per run}"
export RHYTHM_SANDBOX_API_PORT="${RHYTHM_SANDBOX_API_PORT:-4098}" RHYTHM_SANDBOX_ENGINE_PORT="${RHYTHM_SANDBOX_ENGINE_PORT:-4097}" RHYTHM_SANDBOX_GATEWAY_PORT="${RHYTHM_SANDBOX_GATEWAY_PORT:-4099}"
cloud_port=7097
export RHYTHM_APPROVED_FIXTURE_ROOT="${RHYTHM_SANDBOX_DIR}-fixtures"
fixture_flags=(--web-host "--api-port=$RHYTHM_SANDBOX_API_PORT")
# Synthetic cloud custody (slice 2b): fake loopback upstream, protected synthetic credential.
if [[ "${RHYTHM_WEB_CLOUD_TEST:-}" == 1 ]]; then fixture_flags+=(--web-cloud "--cloud-port=$cloud_port"); fi
node tools/dev/sandbox_fixture.mjs "$RHYTHM_APPROVED_FIXTURE_ROOT" "${fixture_flags[@]}"
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT"
export RHYTHM_SANDBOX_ENGINE_DIR="${RHYTHM_SANDBOX_ENGINE_DIR:-/private/tmp/rhythm-feature-playwright-2026-10-19/apps/opencode_fork/packages/opencode}"
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 RHYTHM_WEB_HOST=1
export RHYTHM_WEB_PUBLIC_ORIGIN="${RHYTHM_WEB_PUBLIC_ORIGIN:-http://rhythm-web.test:$RHYTHM_SANDBOX_API_PORT}"
export RHYTHM_WEB_OWNER_USER_ID="${RHYTHM_WEB_OWNER_USER_ID:-1}"
export RHYTHM_WEB_DIST_DIR="$ROOT/apps/web/dist-web"
if [[ "${RHYTHM_WEB_CLOUD_TEST:-}" == 1 ]]; then
  export RHYTHM_LIVE_E2E=1
  export RHYTHM_WEB_CLOUD_CREDENTIAL_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/private/cloud.json"
  export RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_AUTH_FIXTURE_URL="http://127.0.0.1:$cloud_port"
  export RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE="$RHYTHM_APPROVED_FIXTURE_ROOT/registrar"
fi
# Live Electron env pair (sandbox.sh adds RHYTHM_MANAGED_CONTEXT_EXPORTS=1). Without it every
# prompt is held `proof_unavailable` by the Dayflow guard before the provider: see
# docs/ai/runs/2026-10-10-router-sandbox-stop-handoff.md. Set explicitly; never inherit it.
export RHYTHM_WORKSTREAMS_ENABLED=true
provider='' fake=''
cleanup() {
  local result=$? teardown=0
  tools/dev/sandbox.sh down || teardown=$?
  if [[ -n "$provider" ]]; then kill "$provider" 2>/dev/null || true; wait "$provider" 2>/dev/null || true; fi
  if [[ -n "$fake" ]]; then kill "$fake" 2>/dev/null || true; wait "$fake" 2>/dev/null || true; fi
  if lsof -nP -iTCP:"$RHYTHM_SANDBOX_ENGINE_PORT" -iTCP:"$RHYTHM_SANDBOX_API_PORT" -iTCP:"$RHYTHM_SANDBOX_GATEWAY_PORT" -iTCP:6996 -iTCP:"$cloud_port" -sTCP:LISTEN; then
    printf 'web-host teardown: sandbox ports still occupied\n' >&2
    teardown=1
  fi
  printf 'web-host teardown: exit=%s (canonical down and port audit)\n' "$teardown"
  if [[ "$result" == 0 ]]; then result=$teardown; fi
  exit "$result"
}
trap cleanup EXIT
node apps/web/tests/live/scripted-openai-provider.mjs > apps/web/tests/web-host/provider.log 2>&1 & provider=$!
if [[ "${RHYTHM_WEB_CLOUD_TEST:-}" == 1 ]]; then
  node apps/web/tests/web-host/fake-cloud.mjs > apps/web/tests/web-host/fake-cloud.log 2>&1 & fake=$!
fi
tools/dev/sandbox.sh up --foreground > apps/web/tests/web-host/sandbox.log 2>&1 & holder=$!
ready=0
for n in {1..180}; do
  kill -0 "$holder" 2>/dev/null || break
  if curl -sf "http://127.0.0.1:$RHYTHM_SANDBOX_API_PORT/health" >/dev/null && curl -sf "http://127.0.0.1:$RHYTHM_SANDBOX_ENGINE_PORT/global/health" >/dev/null; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then tools/dev/sandbox.sh status; exit 1; fi
tools/dev/sandbox.sh status
# Let the foreground launcher finish its ownership envelope before early tests exit.
sleep 3
"$@"
