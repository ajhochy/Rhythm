---
date: 2026-07-23
repo: Rhythm
branch: fix/1139-broaden-scope-applier
pr: (pending)
issues: [1139]
status: verified
tags: [run, rhythm]
---

# #1139 — broaden-scope proposals cannot be approved

## Summary

HIGH-risk `broaden-scope` proposals (missing-scope workflow signal → grant a
denied MCP/skill) 400'd on Approve with "No re-validation is registered for
proposal kind 'broaden-scope'". Root cause: `registerAllProposalAppliers()` in
`org_proposal_appliers_wiring.ts` never registered a validator/applier for
`broaden-scope`, even though `workflow_signal_generator.proposeMissingScope`
emits it. The fail-closed re-validation guard then refused the unknown kind.

## Fix (root cause, minimal)

Registered a `broaden-scope` validator + applier that reads the **flat** shape
`{agentConfigId, field, add}` the generator emits (NOT refine-scope's nested
`{scopePatch:{...}}`, so it cannot alias `refineScopeApplier` verbatim). It
reuses the existing shared mechanics — `computeScopeList(add)`,
`readAgentConfigField`, `agentConfigFieldPatch`, `writeAgentProfileFile` — and
writes the identical `{agentConfigId, field, priorValue}` snapshot, so the
refine-scope revert branch (`isConfigFieldSnapshot`) and the scope measure path
(`isAgentConfigScopeChange`) cover it for free. Fail-closed: refuses a payload
missing `agentConfigId` / a valid scope field / a non-empty `add`, and
drift-guards the target agent at apply time.

## Files

- `apps/api_server/src/services/org_proposal_appliers_wiring.ts` — added
  `extractBroadenScopePatch`, `validateBroadenScope`, `broadenScopeApplier`;
  registered both in `registerAllProposalAppliers()`; updated the boot log line.
- `apps/api_server/src/__tests__/issue_1139_contract.test.ts` — new (7 tests):
  re-validation registered, apply appends tool + idempotent, fail-closed on
  malformed / empty-add, drift guard.
- `apps/api_server/src/__tests__/live_e2e_1139_broaden_scope.test.ts` — new,
  RHYTHM_LIVE_E2E-gated behavioral test.

## GitNexus

- `query()` mapped the approve → `validateProposalChange` →
  `registerAllProposalAppliers` seam and the flat vs nested payload divergence.
- `impact({target:'registerAllProposalAppliers', direction:'upstream'})` → LOW
  (0 upstream; boot-time wiring fn called only from server.ts).
- `detect_changes()` before commit → risk LOW, 0 affected processes; touched
  symbols were only line-shifted neighbors (no behavioral change).

## Checks

- `tsc -p tsconfig.json --noEmit` → exit 0.
- Unit/contract: `issue_1139_contract.test.ts` (7) + regression
  (`issue_830`, `issue_936`, `workflow_signal_generator`, `org_risk_classifier`,
  `issue_831`) → all pass.
- **Live behavioral (verification gate):**
  ```
  tools/dev/sandbox.sh up   # api :4098, engine :4097, built from this branch
  # boot log confirmed: "...refine-scope, broaden-scope, workflow-prompt-fix..."
  RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
    RHYTHM_SANDBOX_DB="$SB/rhythm.db" \
    npx vitest run src/__tests__/live_e2e_1139_broaden_scope.test.ts
  # → 1 passed. POST /agent-org-proposals/:id/approve returned 2xx (not 400);
  #   GET /agent-configs/:id showed allowedMcpsJson gained 'gitnexus',
  #   prior 'rhythm' preserved.
  ```

## Cleanup

- Restored `apps/opencode_fork/bun.lock` (sandbox build artifact, not my change).
- Sandbox left up for the next bug; will be brought down after #1143.

## Next

Commit → push → open draft PR for #1139, then proceed to #1138.
