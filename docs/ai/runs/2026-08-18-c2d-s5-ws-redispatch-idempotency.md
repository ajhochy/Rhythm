---
date: 2026-08-18
repo: Rhythm
branch: agent-stack/si-causal-runtime-v2-codex
pr: none
issues: [1448]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# C2-D (S5) / #1448 — redispatch reuse/verification (idempotent re-entry)

## Investigation

Read `reserveRunEnrollment` and `dispatchAndFinalizeReceiptAsync` (the two primitives
`commitReservedTreatmentDispatch` composes) before writing any new code:

- `reserveRunEnrollment` (`org_proposal_experiment_service.ts`) checks
  `enrollmentsRepo.findByRunEpisodeIdAsync(runEpisodeId)` **first, before any eligibility/assignment
  logic** — a repeat call with the same `runEpisodeId` and the same `profileId` returns the EXISTING
  enrollment row untouched. Already proven in isolation by
  `org_proposal_experiment_service.test.ts`'s "same-profile idempotent lookup still returns the
  existing binding even after policy is switched off and the target drifts" (from C1).
- `AgentOrgTreatmentReceiptsRepository.dispatchAndFinalizeReceiptAsync` checks for an existing receipt
  row by `enrollment.id` **before** the `enrollment.state !== 'reserved'` guard — so a retry against an
  enrollment already transitioned to `dispatched` (by the first attempt) still reaches the
  idempotent-match branch instead of falling into `illegal_transition`. Already proven in isolation by
  `agent_org_treatment_receipts_repository.test.ts`'s "an identical retry after success is idempotent
  and returns the exact existing receipt" and by
  `org_proposal_experiment_service.test.ts`'s "an identical retry (same enrollment, same fresh
  preparation) is idempotent and reuses the exact receipt" (both C2-B/C2-C).

Neither of those existing tests drives the FULL chain through a second, independent
reserve -> prepare -> commit pass (they either reuse the same enrollment/preparation objects across two
calls, or only test `reserveRunEnrollment` in isolation) — and neither drives it through the real WS
boundary S4 just wired. Traced the composed behavior by hand for a genuine two-pass redispatch (a
second, from-scratch `handleInputFrame` call for the same `id`/`runEpisodeId`, exactly as a WS
reconnect resending an unacknowledged frame would look):

1. `reserveRunEnrollment` finds the existing (now `dispatched`) row via its idempotency check → returns
   it, no new row.
2. `prepareReservedTreatment` re-verifies against the (unchanged) durable target → `ready`, same
   override.
3. `commitReservedTreatmentDispatch` re-runs `prepareReservedTreatment` fresh, confirms it reproduces
   the caller's `initialPreparation` byte-for-byte, then calls `dispatchAndFinalizeReceiptAsync` →
   finds the existing receipt row, confirms `receiptsMatch`, returns `status: 'idempotent'` with the
   SAME receipt → treated as success, no throw.

This traces to "already correct, no new logic needed" — confirmed by writing the test below and
observing it pass on the FIRST run, no implementation changes required.

## Files changed

- `apps/api_server/src/__tests__/c2_d_s4_ws_reserved_treatment_dispatch.test.ts` — added one test
  (`C2-D (S5) — redispatch reuse...`) to the file S4 created. No other file touched.
- `docs/ai/contracts/issue-1448.json` — `issue-1448-c3` status updated `failing` -> `pass`.

## Checks

- Ran the new test immediately after writing it (no implementation change in between):
  `npx vitest run src/__tests__/c2_d_s4_ws_reserved_treatment_dispatch.test.ts` -> **5/5 passed**
  (4 pre-existing S4 tests + the new S5 test), confirming the composed reserve -> prepare -> commit
  chain is idempotent through the real WS boundary with zero code changes.
- `node_modules/.bin/tsc --noEmit` -> clean, 0 errors. `git diff --check` -> clean.
- Per the dispatch's own S5 instruction ("if so, prove it with a focused test and move on rather than
  adding new logic"), no `ws_gateway.ts`/`org_proposal_experiment_service.ts` code was touched in this
  slice.

## What the test proves

Drives the real `handleInputFrame` TWICE with the exact same WS frame object (same session `id`, same
`runEpisodeId`) against a real declared experiment, with a fresh fake WebSocket for the second call
(matching a reconnect's fresh socket). Asserts:

- `promptAsyncSpy` called twice (both dispatches proceed — a redispatch is not silently dropped).
- The second dispatch's effective `system` override is byte-identical to the first (reused, not
  re-derived from a different assignment).
- The enrollment and receipt read back after the second call are `toEqual` the ones read back after the
  first (no mutation, no new row swapped in).
- A raw `COUNT(*) ... WHERE run_episode_id = ?` on both `agent_org_experiment_enrollments` and
  `agent_org_experiment_treatment_receipts` is exactly `1` — a stronger proof than a single-row lookup,
  since a second, orphaned row would not be caught by `findByRunEpisodeIdAsync` alone if the unique
  constraint were somehow bypassed.

## Decisions / deviations

- No production code changed. This slice is pure verification, matching the dispatch's explicit
  "investigate ... if so, prove it with a focused test and move on" instruction.
- Did not additionally test the `#930` cross-provider fallback re-dispatch path
  (`turn_redispatch.ts`'s `redispatchTurn`) — that is a different re-entry mechanism (mid-turn provider
  exhaustion, not a WS reconnect/retry of the same `session.input` frame) and was flagged as an explicit
  residual note in the S4 run note, out of scope for both S4 and S5.
