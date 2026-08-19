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

# C2-D (S4) / #1448 — interactive WS reservation/receipt at the promptAsync boundary

## Investigation

C1/C2-C already wired reserve-before-dispatch + receipt-finalize-at-dispatch for the scheduled/HTTP
path: `agent_runner.ts`'s `_runOnce` calls `reserveRunEnrollment` -> `prepareReservedTreatment` to get
the bound cohort's exact system prompt, then passes a `beforeDispatch` hook (which calls
`commitReservedTreatmentDispatch`) into `opencodeClient.prompt(...)`. `OpencodeClientService.prompt`
and `.promptAsync` both already implement the `beforeDispatch` boundary contract (construct the SDK
request first, run the hook immediately before the real SDK call, block dispatch if the hook throws)
-- confirmed by reading both methods in `opencode_client_service.ts`.

`ws_gateway.ts`'s `handleInputFrame` (the WS `session.input` handler) calls `opencodeClient.promptAsync`
directly and, since S3 (#1451), threads an optional per-turn `runEpisodeId` to
`streamBridge.setPendingRunEpisodeId` for the **terminal outcome** side only. It never called
`reserveRunEnrollment`/`prepareReservedTreatment`, never applied a treatment system-prompt override,
and never passed a `beforeDispatch` hook -- confirmed by grepping the file and reading the full
`handleInputFrame` body. This is exactly the gap S3's commit message named: "does not add reservation
to the WS prompt-dispatch boundary itself - that is C2-D S4, tracked separately in #1448."

## Files changed

- `apps/api_server/src/services/ws_gateway.ts` -- `handleInputFrame`, right after the transient
  skill/memory preface merge and before `retainTurn`/dispatch: when the frame carries a
  `runEpisodeId`, calls `reserveRunEnrollment` then `prepareReservedTreatment` (mirroring
  `agent_runner.ts`'s C2-A block exactly, including the `RunEnrollmentProfileCollisionError` handling
  and target-drifted/invalid-binding fail-closed paths -- no prompt sent, WS error frame returned).
  On a ready preparation, `sdkOpts.system` is unconditionally overwritten with the bound cohort's
  exact prompt (dropping the profile's own `wsSystemPrompt` and any transient skill/memory blocks --
  the receipt binds the effective-prompt hash to exactly what is dispatched). The `promptFn` type cast
  gained a 7th `beforeDispatch` parameter and a `Promise<boolean>` return type (previously
  `Promise<unknown>`, unused); the call site now captures the return value and, on a falsy result with
  a committed-or-attempted reservation, calls `markRunEnrollmentPreDispatchFailed` -- mirroring
  `agent_runner.ts`'s own `if (!response) { ... }` guard so a still-`reserved` row is never left
  eligible when the SDK call itself silently no-ops after the hook ran.
- `apps/api_server/src/__tests__/c2_d_s4_ws_reserved_treatment_dispatch.test.ts` -- new, 4 tests.
- `docs/ai/contracts/issue-1448.json` -- acceptance contract (covers S4 + S5 + S6; S5/S6 criteria
  recorded here as `failing`/`UNVERIFIED` pending their own slices).

## Checks

- RED: ran the new test file against the pre-implementation `ws_gateway.ts` --
  `npx vitest run src/__tests__/c2_d_s4_ws_reserved_treatment_dispatch.test.ts` -> **3 failed / 1
  passed** (the 4th, the no-declared-experiment regression guard, correctly passed unchanged since
  `reserveRunEnrollment` already no-ops gracefully with no code changes needed for that path).
- GREEN (implementation applied): same command -> **4/4 passed**.
- Focused regression sweep of the tests most directly exercising `handleInputFrame`/prompt-dispatch
  shape (`issue_1451_contract.test.ts`, `p2_systemprompt_ocagent.test.ts`,
  `opc_m4_1_file_attachments.test.ts`, `opc_m4_4_agent_selection.test.ts`,
  `opc_711_anthropic_permission_mode.test.ts`, `opencode_stream_bridge.test.ts`,
  `opc_question_handshake.test.ts`, `opc_question_recovery.test.ts`) -- **8 files, 83/83 passed**.
  Per the dispatch's gate policy, the full api_server suite was NOT run (deferred to the end of the
  whole C2-D -> C6 sequence).
- `npm run build` -> PASS. `node_modules/.bin/tsc --noEmit` -> clean, 0 errors. `git diff --check` ->
  clean.

## The 4 contract tests, and what each proves

1. `sends the exact reserved cohort system prompt ... and finalizes an immutable receipt` -- a real
   declared experiment + a real WS frame with `runEpisodeId` produces `opts.system` exactly equal to
   the reserved cohort's bound prompt (not the profile's own prompt), the enrollment reaches
   `dispatched`, and a receipt exists with the correct `effectivePromptHash`.
2. `proves both cohorts receive distinct bound system prompts` -- deterministically finds one
   baseline-assigned and one candidate-assigned `runEpisodeId` via the real `assignCohort`, drives both
   through the real WS path, and proves the two dispatched `system` values (and their receipts'
   effective-prompt hashes) are distinct.
3. `sends no prompt and fails closed (target_drifted)` -- reserves first, drifts the durable
   `AgentConfig` afterward, then drives the WS frame: `promptAsync` is never called, the enrollment is
   `treatment_failed`/`target_drifted`, and no receipt is written.
4. Regression -- a `runEpisodeId` with no matching declared experiment dispatches normally with the
   profile's own system prompt and leaves no enrollment row (proves an ordinary interactive turn is
   unaffected).

Only the TRUE external boundary is faked: the real opencode engine process (`opencodeClient.
promptAsync`, mocked to faithfully replay the `beforeDispatch` hook before resolving, exactly mirroring
`c2_a_reserved_treatment_dispatch.test.ts`'s `mockPrompt`) and the model catalog
(`resolveModelForSessionTurn`). `ws_gateway.ts` and every `org_proposal_experiment_service.ts` function
are real, unmocked, driven against a real in-memory SQLite DB.

## Decisions / deviations

- `resolvedProfileId` mirrors `agent_runner.ts`'s exact fallback: `scopeAgentId ?? 'claude-code'` (the
  same variable `handleInputFrame` already uses to resolve profile scope/systemPrompt/allowlists), so
  the reservation is always keyed to the SAME profile driving the rest of the turn.
- Did not add a WS-side `opts.experimentTreatment` fallback (the backward-compat path
  `agent_runner.ts`'s `run()` supports for callers with no reservation) -- the WS frame contract has no
  analogous caller-supplied-spec field and inventing one would be new scope this slice doesn't need.
- Did not touch `turn_redispatch.ts` (the #930 cross-provider rate-limit fallback re-dispatch
  mechanism). Its default `RedispatchDeps.prompt` calls `promptAsync` without a `beforeDispatch` hook,
  so a mid-turn cross-provider handoff re-sends the retained `sdkOpts` (which already contains the
  baked-in treatment override from the original dispatch) without re-committing a second receipt. This
  is a same-turn continuation on a different provider tier, not a new dispatch attempt, and is out of
  this slice's scope (S4/S5 concern WS session.input re-entry with the same runEpisodeId, not #930's
  internal retry state machine). Flagging as a residual note, not treating it as a gap in this
  contract.
