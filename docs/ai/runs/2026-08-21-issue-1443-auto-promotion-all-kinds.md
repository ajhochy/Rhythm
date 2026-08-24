---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d4-auto-promotion-sonnet
pr: null
issues: [1443]
status: pass
tags: [run, rhythm, d4, optimizer]
---

# D4.5 — all change types eligible for auto-promotion

## Files

- Added the D4.5 contract and one real SQLite integration suite. It drives
  the production-default gate with `AUTO_PROMOTION_FEATURE_AVAILABLE=true`;
  no availability dependency is injected.
- The suite covers a system-prompt refinement, D1 durable SAFE
  local-tarball installation through the real managed installer, a tool
  removal through the refine-config validator/applier, and a scope tightening
  through the atomic scope lifecycle.
- Every success asserts the target state, `measuring` deployment state,
  profile/change-type D2 monitor, and retry idempotence. Owned temporary tool
  roots are removed in `finally` and asserted absent.

## Checks

- RED control: intentional wrong expected prompt failed 1/16, showing the
  state assertion catches a non-applied mutation; restored before GREEN.
- GREEN Node 22 focused matrix: `npx vitest run
  src/services/__tests__/auto_promotion_all_kinds.integration.test.ts
  src/services/__tests__/auto_promotion_gate.test.ts
  src/services/__tests__/tool_install_managed_apply.test.ts
  src/services/__tests__/tool_install_proposal_lifecycle.test.ts
  src/services/__tests__/tool_install_safety_policy.test.ts
  src/services/__tests__/post_apply_lifecycle.integration.test.ts
  src/__tests__/auto_promotion_settings_routes.test.ts
  src/services/__tests__/post_apply_regression_feedback.test.ts
  --no-file-parallelism` — 93 passed, 1 expected Docker-gated skip.
- GREEN Node 22: `npx tsc --noEmit && npm run build` in `apps/api_server`.
- `ai-workflow checks --level issue` is blocked after Flutter format/analyze
  and API typecheck by the inherited `apps/mcp_server` missing TypeScript
  compiler dependency. Reproduced with `cd apps/mcp_server && npx tsc
  --noEmit`; no package mutation was made for this out-of-scope environment
  defect.
- No sandbox was needed: #1443 adds only direct production-service integration
  coverage over existing D1/D2/D4 code, and has no new HTTP/WS/MCP entry
  point. Postgres remains unavailable by the existing production availability
  predicate and is asserted in the negative matrix.

## Notes

- GitNexus impact/detect is UNKNOWN: the one permitted local detect-changes
  attempt could not select this worktree from multiple duplicate Rhythm
  indexes, and no reindex/analyze was run. Direct inspection covered the
  existing gate, D1 lifecycle, D2 finalizer, and scope lifecycle only; no
  production symbols were changed.
- The focused assertions would fail if a profile field did not change, a
  deployed proposal did not reach `measuring`, D2 used an incorrect
  profile/change type or duplicated an event, the installer did not create its
  managed receipt, or any fail-closed predicate mutated state.
