---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d4-1441-gate-terra
pr: null
issues: [1441]
status: pass
tags: [run, rhythm, d4]
index: "[[Rhythm]]"
---

## Files

- Added `auto_promotion_gate.ts` and its focused RED→GREEN matrix.
- Routed the durable fixed-horizon `promote -> verified` transition through the default-closed gate.
- Extracted the existing human approval execution path so the controller and gate share D1 validation/claim/CAS/applier/D2 finalization behavior.

## Checks

- RED: `npx vitest run src/services/__tests__/auto_promotion_gate.test.ts` initially could not collect because this clean worktree lacked installed Vitest dependencies; after `npm ci --ignore-scripts` and `npm rebuild better-sqlite3`, the pre-implementation matrix then drove the gate implementation.
- GREEN: `npx vitest run src/services/__tests__/auto_promotion_gate.test.ts src/services/__tests__/org_proposal_experiment_service.test.ts src/services/__tests__/post_apply_lifecycle.integration.test.ts src/__tests__/org_proposals_routes.test.ts src/services/__tests__/tool_install_proposal_lifecycle.test.ts src/services/__tests__/tool_install_safety_policy.test.ts` — 159 passed.
- Node 22: `npx tsc --noEmit && npm run build` — passed.
- `git diff --check` and changed-line secret scan — clean.

## Notes

- Availability is an injected narrow dependency that defaults to false. #1442 is the only follow-up permitted to wire an environment/UI enablement source.
- No positive live HTTP/sandbox run exists in this slice because the production-safe default has no enablement surface. The tests inject availability only in the real repository/applier/D2 wiring; no server was started.
- GitNexus impact/detect is UNKNOWN because the MCP integration is unavailable; no index rewrite was performed.
