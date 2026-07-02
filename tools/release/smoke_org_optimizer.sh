#!/usr/bin/env bash
#
# #831 (org-optimizer-15) — the regression guard for the WHOLE org
# self-optimizer epic's safety model. Four invariants, all silent when
# violated:
#
#   a. AUTO-PATH REVERT — a forced regression (functional guard fails) on an
#      applied low-risk proposal restores before_snapshot_json and sets
#      status='reverted', both in the DB row and in the live agent_configs
#      value it mutated.
#
#   b. GATE INVARIANTS — none of create-agent, grant-delegation,
#      expand-delegation, broaden-scope, webhook-wiring, external-adoption is
#      EVER auto-applied: classifyProposalRisk always returns 'high' for
#      these kinds, and applyProposal independently refuses every one of
#      them even when the row is mislabeled risk='low'.
#
#   c. NOTE-REQUIRED GATE — external-adoption and webhook-wiring cannot be
#      approved without a non-empty provenance/security note.
#
#   d. FAIL-INJECTION (guard-regression detection) — the mandated proof that
#      this smoke is load-bearing, not just a happy-path check: a
#      deliberately-broken classifier that misclassifies grant-delegation as
#      low-risk IS caught by the same gate-invariant check used in (b), and
#      the real (unpatched) classifier is then confirmed to pass cleanly
#      (no false positives from the fail-injection harness itself).
#
# DELIBERATE DEVIATION from smoke_mcp_alignment.sh / smoke_skill_alignment.sh:
# those two smokes run against the ACTUAL BUILT/SIGNED opencode fork binary,
# because their invariant lives inside that binary's own HTTP surface. #831's
# safety model (org_risk_classifier.ts, org_proposal_apply.ts,
# org_proposal_apply_service.ts) lives entirely in apps/api_server's
# TypeScript service layer and has ZERO runtime dependency on the opencode
# engine. This script therefore does not take an opencode binary argument —
# it runs tools/release/org_optimizer_guard_check.ts via `tsx` (an existing
# apps/api_server devDependency) directly against an in-memory SQLite DB,
# exercising the real service code. This means it needs no signed binary, no
# macOS entitlements, and no notarization — it can run on every PR, in any
# CI runner, not just the macOS release pipeline (see project memory: "opencode
# fork rebuild + cp/AMFI resign gotcha" — the built-binary smokes require a
# full release rebuild to test correctly).
#
# Usage: smoke_org_optimizer.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
API_SERVER_DIR="${REPO_ROOT}/apps/api_server"
TSX_BIN="${API_SERVER_DIR}/node_modules/.bin/tsx"
HARNESS="${SCRIPT_DIR}/org_optimizer_guard_check.ts"

fail() { echo "::error::$*" >&2; exit 1; }

[[ -f "${HARNESS}" ]] || fail "guard-check harness not found: ${HARNESS}"
[[ -x "${TSX_BIN}" ]] || fail "tsx not found at ${TSX_BIN} — run 'npm install' in apps/api_server first"

echo "Running org-optimizer safety guard check (#831) via tsx ..."
if ! "${TSX_BIN}" "${HARNESS}"; then
  fail "org-optimizer safety guard check FAILED — see [FAIL] lines above (a regression in the auto-apply/revert/gate/note-required safety model, or the fail-injection proof itself is broken)"
fi

echo "OK: auto-path-revert + gate-invariants + note-required-gate + fail-injection guards all passed."
