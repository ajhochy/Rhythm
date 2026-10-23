#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/notifier-opencode.json"
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-shipping-rollout-20261014-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
export RHYTHM_SANDBOX_NODE_BIN="$ROOT/tools/dev/.hermes-shipping-runtime/node/bin/node"
export RHYTHM_SANDBOX_ENGINE_DIR="$ROOT/tools/dev/.hermes-shipping-runtime"
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
case "${1:-}" in
  up|status|down) exec bash "$ROOT/tools/dev/sandbox.sh" "$1" ;;
  acceptance) export RHYTHM_LIVE_E2E=1; exec "$RHYTHM_SANDBOX_NODE_BIN" --test "$ROOT/tools/dev/hermes_shipping_acceptance.mjs" ;;
  *) printf 'usage: bash tools/dev/hermes_shipping_checks.sh {up|status|down|acceptance}\n' >&2; exit 2 ;;
esac
