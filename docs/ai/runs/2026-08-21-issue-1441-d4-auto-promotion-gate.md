---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d4-1441-gate-terra
pr: null
issues: [1441]
status: repairing
tags: [run, rhythm, d4]
index: "[[Rhythm]]"
---

## Files

- Added `auto_promotion_gate.ts` and its focused RED→GREEN matrix.
- Routed the durable fixed-horizon `promote -> verified` transition through the default-closed gate.
- Extracted the existing human approval execution path so the controller and gate share D1 validation/claim/CAS/applier/D2 finalization behavior.

## Checks

- RED: `npx vitest run src/services/__tests__/auto_promotion_gate.test.ts` initially could not collect because this clean worktree lacked installed Vitest dependencies; after `npm ci --ignore-scripts` and `npm rebuild better-sqlite3`, the pre-implementation matrix then drove the gate implementation.
- Initial GREEN (superseded by the repair pass below): `npx vitest run src/services/__tests__/auto_promotion_gate.test.ts src/services/__tests__/org_proposal_experiment_service.test.ts src/services/__tests__/post_apply_lifecycle.integration.test.ts src/__tests__/org_proposals_routes.test.ts src/services/__tests__/tool_install_proposal_lifecycle.test.ts src/services/__tests__/tool_install_safety_policy.test.ts` — 159 passed.
- Node 22: `npx tsc --noEmit && npm run build` — passed.
- `git diff --check` and changed-line secret scan — clean.

## Notes

- Availability is an injected narrow dependency that defaults to false. #1442 is the only follow-up permitted to wire an environment/UI enablement source.
- No positive live HTTP/sandbox run exists in this slice because the production-safe default has no enablement surface. The tests inject availability only in the real repository/applier/D2 wiring; no server was started.
- GitNexus impact/detect is UNKNOWN because the MCP integration is unavailable; no index rewrite was performed.

## Parent-review repair (same branch, follow-up commit pending)

- Replaced the prior enrollment-failure expectation: a first strict-auto call commits only once and returns `enrollment-pending`; a second call reconstructs the closed D2 target from the durable proposal, enrolls exactly one event without reapplying the config mutation, and a third call is idempotent.
- Added strict-auto enrollment semantics to the shared approval service. For a recognized profile target, null or throwing D2 finalization is pending; the default human route retains its established post-commit isolation. Non-profile proposals retain ordinary already-applied semantics because there is no closed D2 target to recover.
- Routed a real successful D1 immutable local-tarball installation through shared approval and asserted its persisted D2 event/profile identity; the test removes its owned temporary root in `finally`.
- Wrapped tool-safety evaluation in the auto gate's fail-closed boundary and proved a throwing durable-report read does not interrupt a settled promote, verified outcome, or calibration observation.
- Repair checks: Node 22 `npx vitest run src/services/__tests__/auto_promotion_gate.test.ts src/services/__tests__/org_proposal_experiment_service.test.ts src/services/__tests__/post_apply_lifecycle.integration.test.ts src/__tests__/org_proposals_routes.test.ts src/services/__tests__/tool_install_proposal_lifecycle.test.ts src/services/__tests__/tool_install_safety_policy.test.ts src/services/__tests__/tool_install_managed_apply.test.ts && npx tsc --noEmit && npm run build` — 177 passed, 1 Docker-gated test skipped; typecheck and build passed.
- `git diff --check` and the changed-line secret scan remain required before commit. Parent owns the integrated live gate and final acceptance; no server was started.
