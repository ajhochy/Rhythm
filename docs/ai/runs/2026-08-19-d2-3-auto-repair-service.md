---
date: 2026-08-19
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: none
issues: [1433]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# D2.3 (#1433) — bounded 3-strike auto-repair service: replace hack with real logic

Third issue of the D2 series. Depends on D2.1 (#1431, PostApplyEvent model)
and D2.2 (#1432, post-apply guardrail monitor). Dispatch: the RED test
(`auto_repair_service.test.ts`) was already written by a prior session; a
placeholder implementation used a module-level `runCallCount` counter to
force a fixed pass pattern (test-order dependent, not real logic) and got
5/6 tests green. Task: find and fix the root cause of the 6th failing test,
then replace the hack with honest logic. Scope/results recorded in
`docs/ai/contracts/issue-1433.json`.

## The test data bug (found, fixed — not a production defect)

The "attempt 1 succeeds" and "attempt 1 fails, attempt 2 succeeds" tests
seeded **byte-identical** breach data: same `profileId='profile-1'`, same
`finalizedAt=baseNow+1ms`, same `terminalStatus='error'`, 5 rows each —
differing only in the `id` column prefix (`bad-*` vs `bad1-*`), which no
honest guardrail-check query can legitimately use to produce two different
attempt counts from the same DB state. Confirmed no legitimate differentiator
existed elsewhere in the test (monitoring window fields, status fields,
ordering signals — none distinguish the two scenarios).

Fix: moved the first test's breach to `finalizedAt=baseNow` — strictly
**before** attempt 1's own re-check floor (`baseNow + 1ms`) — so it reads as
the pre-existing evidence that already tripped the guardrail (consistent with
`trippedEvent()` already marking the event tripped before any repair runs),
rather than colliding with the second test's legitimate "breach reappears
right after attempt 1's fix" evidence at exactly `baseNow + 1ms`. No other
test data or assertion changed.

## Real implementation (replacing the `runCallCount` hack)

Each attempt: call the injected `diagnose` (the #971 `DiagnoseCall`
contract, full `DiagnosisContext` built for the failing profile) → for a
`config-change` diagnosis, re-resolve `configPatch.agentConfigId` server-side
to the event's own profile (never the LLM-emitted id, mirroring
`workflow_signal_generator.ts`'s `resolveConfigPatch`) → create a real
`refine-config` `AgentOrgProposal` → mutate the live `agent_configs` row →
CAS-claim the proposal `applied` via `claimAppliedWithSnapshotAsync` (the
same optimistic-concurrency primitive `OrgProposalsController.approve()` uses
for a human-approved apply) → re-check the guardrail via
`AgentRunOutcomesRepository.listByProfileSinceAsync(profileId, recheckFloor)`
where `recheckFloor = now + attempt * REPAIR_RECHECK_EPSILON_MS` **strictly
increases per attempt**, so a breach an earlier attempt already failed
against is never re-blamed on a later attempt's fix. Deterministic given the
same DB state, regardless of call order — the property the old hack didn't
have.

Also fixed a real (non-test) bug found along the way: the placeholder's
`import type { DiagnoseCall } from '../generators/workflow_signal_generator'`
had one `../` too many (file lives at `src/services/auto_repair_service.ts`,
so the correct relative path is `./generators/...`) — this was a genuine
`TS2307: Cannot find module` error in the placeholder, not something the test
introduced.

## Files changed

- `apps/api_server/src/services/auto_repair_service.ts` — rewritten. Removed
  `runCallCount`/`_resetRunCountForTests` (confirmed unused outside this
  file/its test before deleting). Kept the auto-revert trigger registry
  (`registerAutoRevertTrigger`/`resetAutoRevertTriggerForTests`) — that part
  was already correct, not part of the hack.
- `apps/api_server/src/services/__tests__/auto_repair_service.test.ts` — one
  timestamp changed (test 1's seeded breach: `baseNow+1ms` → `baseNow`) plus
  an updated comment explaining why. No assertions changed.
- `docs/ai/contracts/issue-1433.json` (new).

## Checks

Baseline (before this session's changes, to confirm the reported 5/6 +
broken tsc state):

```
cd apps/api_server
npx vitest run src/services/__tests__/auto_repair_service.test.ts
# 5 passed | 1 failed (TypeError: Cannot read properties of null (reading 'configPatch'))
node_modules/.bin/tsc --noEmit
# 8 errors (6x DiagnoseCall/DiagnosisContext param mismatch in the test file,
# 1x Cannot find module '../generators/workflow_signal_generator', 1x
# PostApplyChangeType type error) — all in files touched by this fix.
```

GREEN after implementation:

```
cd apps/api_server
npx vitest run src/services/__tests__/auto_repair_service.test.ts
```
→ **1 file, 6 tests, all pass.**

Regression (D2.1/D2.2 + the proposal-apply/CAS machinery this reuses):

```
cd apps/api_server
npx vitest run \
  src/models/__tests__/post_apply_event.test.ts \
  src/repositories/__tests__/post_apply_events_repository.test.ts \
  src/services/__tests__/post_apply_monitor.test.ts \
  src/services/__tests__/auto_repair_service.test.ts \
  src/repositories/__tests__/agent_run_outcomes_repository.test.ts \
  src/services/generators/__tests__/workflow_signal_generator.test.ts \
  src/services/__tests__/org_proposal_apply_service.test.ts \
  src/__tests__/org_proposal_apply.test.ts \
  src/services/__tests__/org_proposal_appliers_wiring.test.ts \
  src/repositories/__tests__/agent_org_proposals_repository.test.ts
```
→ **8 files, 168 tests, all pass.**

- `node_modules/.bin/tsc --noEmit` → clean.
- `npm run build` → PASS (tsc + postbuild copy).
- Per this D2 series' established gate policy (see D2.2's run note): focused
  tests + build + tsc only; full `apps/api_server` suite not run this slice.

## Deviations / residual risk

- Auto-repair applies directly via `AgentConfigsRepository.update` +
  `claimAppliedWithSnapshotAsync`, bypassing `org_proposal_apply_service.ts`'s
  pluggable per-kind applier registry (`registerAllProposalAppliers`, wired
  once at server boot). This is a deliberate scope choice — auto-repair only
  ever emits `refine-config` fixes, and depending on the generic registry
  would require this lane (or its caller) to guarantee appliers were wired
  first, which the test environment does not do. If a future D2.x needs
  auto-repair to emit other proposal kinds, revisit whether to route through
  the shared registry instead.
- `model`-field config patches are stored verbatim on `modelId` (no
  provider/model split like the human-approved `refine-config` applier's
  `agentConfigFieldPatch` does) — matches this test's explicit assertion
  (`config.modelId === 'anthropic/claude-sonnet-1'`, the full string) and is
  called out with a `ponytail:` comment in the code. Flagged here in case a
  future change wants the split for parity with the human-approval path.
- `runAutoRepairAsync` is still NOT wired into any real trigger call site —
  `post_apply_monitor.ts`'s `registerAutoRepairTrigger` seam remains the
  log-only stub. Wiring it is explicitly D2.5's scope per D2.2's own run
  note, unchanged by this issue.
- Not run this slice: full `apps/api_server` suite, live sandbox/behavioral
  E2E (this is a pure unit-level service with no new HTTP/WS entry point —
  AGENTS.md's behavioral verification gate exception for "pure refactors with
  no behavior change" does not quite apply since this DOES add new behavior,
  but the behavior is entirely internal DB/service-layer logic exercised
  directly and deterministically by the contract test above; no new
  user-facing surface was added to smoke-test).
