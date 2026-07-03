#!/usr/bin/env bash
#
# agent_eval.sh — dev-only wrapper for tools/dev/agent_eval_driver.ts.
#
# Mirrors tools/release/smoke_org_optimizer.sh's NODE_PATH + tsx invocation
# pattern: the driver lives in tools/dev/ but imports apps/api_server source
# (apps/api_server/src/services/agent_eval_scoring.ts), which pulls in bare
# specifiers (better-sqlite3, ws, etc.) that Node can only resolve by walking
# up from the importing file's own directory. tools/dev/ never reaches
# apps/api_server/node_modules on its own, so NODE_PATH must point there
# explicitly (this also works via the node_modules symlink some worktrees
# have, but CI/fresh clones have no such symlink — NODE_PATH is the real fix).
#
# NEVER wired into any GitHub Actions workflow — this is a dev-only harness
# that can spend real LLM tokens when run with --yes-live. See
# docs/testing/agent-eval-matrix.md for the full per-agent brief and
# docs/testing/results/ for prior scorecards (gitignored).
#
# Usage:
#   tools/dev/agent_eval.sh --dry-run
#   tools/dev/agent_eval.sh --agents secretary,librarian --yes-live
#   tools/dev/agent_eval.sh --agents all --seed-burst --yes-live
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
API_SERVER_DIR="${REPO_ROOT}/apps/api_server"
TSX_BIN="${API_SERVER_DIR}/node_modules/.bin/tsx"
DRIVER="${SCRIPT_DIR}/agent_eval_driver.ts"

fail() { echo "::error::$*" >&2; exit 1; }

[[ -f "${DRIVER}" ]] || fail "driver not found: ${DRIVER}"
[[ -x "${TSX_BIN}" ]] || fail "tsx not found at ${TSX_BIN} — run 'npm install' in apps/api_server first"

NODE_PATH="${API_SERVER_DIR}/node_modules" "${TSX_BIN}" "${DRIVER}" "$@"
