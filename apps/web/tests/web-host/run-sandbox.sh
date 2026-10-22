#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-web-slice1-fixtures-20261022
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/opencode.json"
export RHYTHM_SANDBOX_DIR="${RHYTHM_SANDBOX_DIR:-/private/tmp/rhythm-web-slice1-sandbox-20261022-attempt4-a2}"
export RHYTHM_SANDBOX_ENGINE_DIR=/private/tmp/rhythm-feature-playwright-2026-10-19/apps/opencode_fork/packages/opencode
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 RHYTHM_WEB_HOST=1
export RHYTHM_WEB_PUBLIC_ORIGIN=http://rhythm-web.test:4098 RHYTHM_WEB_OWNER_USER_ID=1
export RHYTHM_WEB_DIST_DIR="$ROOT/apps/web/dist-web"
# Live Electron env pair (sandbox.sh adds RHYTHM_MANAGED_CONTEXT_EXPORTS=1). Without it every
# prompt is held `proof_unavailable` by the Dayflow guard before the provider: see
# docs/ai/runs/2026-10-10-router-sandbox-stop-handoff.md. Set explicitly; never inherit it.
export RHYTHM_WORKSTREAMS_ENABLED=true
provider=''
cleanup() {
  local result=$? teardown=0
  tools/dev/sandbox.sh down || teardown=$?
  if [[ -n "$provider" ]]; then kill "$provider" 2>/dev/null || true; wait "$provider" 2>/dev/null || true; fi
  if [[ "$result" == 0 ]]; then result=$teardown; fi
  exit "$result"
}
trap cleanup EXIT
node apps/web/tests/live/scripted-openai-provider.mjs > apps/web/tests/web-host/provider.log 2>&1 & provider=$!
tools/dev/sandbox.sh up --foreground > apps/web/tests/web-host/sandbox.log 2>&1 & holder=$!
ready=0
for n in {1..180}; do
  kill -0 "$holder" 2>/dev/null || break
  if curl -sf http://127.0.0.1:4098/health >/dev/null && curl -sf http://127.0.0.1:4097/global/health >/dev/null; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then tools/dev/sandbox.sh status; exit 1; fi
tools/dev/sandbox.sh status
# Let the foreground launcher finish its ownership envelope before early tests exit.
sleep 3
"$@"
