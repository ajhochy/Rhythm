---
date: 2026-08-18
repo: Rhythm
branch: agent-stack/si-causal-runtime-v2-codex
pr: none
issues: [1451]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# C2-D (S3) / #1451 — thread runEpisodeId through the WebSocket bridge to the terminal outcome hook

## Files

- `apps/api_server/src/services/ws_gateway.ts` — `handleInputFrame` parses an optional
  `runEpisodeId` field off the `session.input` WS frame; right before dispatching the prompt it
  calls `streamBridge.setPendingRunEpisodeId(id, runEpisodeId)`.
- `apps/api_server/src/services/opencode_stream_bridge.ts` — `OpencodeStreamBridge` gains
  `pendingRunEpisodeId: Map<localSessionId, runEpisodeId>`, `setPendingRunEpisodeId` (public setter)
  and `consumeRunEpisodeId` (private read-and-clear). All 3 `recordTerminalOutcome` call sites
  (session.idle-success, session.idle-empty-response, session.error) now pass
  `runEpisodeId: this.consumeRunEpisodeId(localSessionId)`. Cleared on `stopStream()` and `dispose()`
  alongside the existing `pendingText`/`pendingQuestions` maps.
- `apps/api_server/src/__tests__/issue_1451_contract.test.ts` — new, 5 tests, all 6 criteria +
  regression coverage.
- `docs/ai/contracts/issue-1451.json` — acceptance contract.

## Checks

- RED: stashed the 2 implementation files, ran the contract test — 4/8... actually 4/5 tests failed
  (the 5th, the unrelated-HTTP-path regression guard, correctly passed unchanged both before and
  after since `agent_runner.ts`/`run_outcome_service.ts` were never touched by this slice).
  `npx vitest run src/__tests__/issue_1451_contract.test.ts` → 4 failed / 1 passed, captured in the
  transcript.
- GREEN (implementation restored): `npx vitest run src/__tests__/issue_1451_contract.test.ts` →
  **5/5 passed**.
- Regression sweep of every pre-existing test file that imports `opencode_stream_bridge.ts` or
  `ws_gateway.ts` (66 unique files; some overlap between the two greps) — split into 3 batches:
  - Batch 1 (34 files): **242/242 passed**.
  - Batch 2 (32 files): **220/220 passed**.
  - Batch 3 (8 files, incl. the gated `live_e2e_self_improvement_foundation.test.ts`):
    **101 passed, 8 skipped** (the live suite skips without `RHYTHM_LIVE_E2E=1`, as designed).
- `npm run build` → PASS. `./node_modules/.bin/tsc --noEmit` → clean, 0 errors. `git diff --check` →
  clean. `detect_changes()` (GitNexus) → risk_level `low`, 0 affected processes.

## The 5 contract tests, and what each proves

1. `issue-1451-c1` — the REAL `handleInputFrame` (imported unmocked) calls the REAL
   `streamBridge.setPendingRunEpisodeId` (spied, not replaced) with the frame's `runEpisodeId`.
2. `issue-1451-c2/c3/c4` (session.idle) — a `runEpisodeId` reserved+dispatched ahead of time via
   `reserveRunEnrollment`/`markRunEnrollmentDispatched` (the same service-level setup S1's test uses),
   driven through a real WS frame, then a synthetic `session.idle` event fed into the REAL
   `streamBridge._relayEvent` (same technique as `issue_636_contract.test.ts`) — the persisted
   `agent_run_outcomes` row carries the exact `runEpisodeId`, `proposalId`, and `experimentVariant`
   (cohort) the reservation produced.
3. Same, but for `session.error` (the failed-turn terminal path) — proves the third call site too.
4. `issue-1451-c5` — regression: an ordinary interactive turn with **no** `runEpisodeId` on the frame
   never calls `setPendingRunEpisodeId`, and the persisted outcome still falls back to
   `rootSessionId` exactly as before (unchanged `run_outcome_service.ts` computation).
5. `issue-1451-c6` — regression: `recordTerminalOutcome` called the exact way `agent_runner.ts` calls
   it (explicit `runEpisodeId`, no WS bridge involved at all) still resolves the correct
   cohort/proposal — proves the untouched scheduled/HTTP path is unaffected.

Only the TRUE external boundary is faked in these tests: the real opencode engine process
(`opencodeClient.promptAsync`/`createSession`/allowlist calls) and the model catalog
(`resolveModelForSessionTurn`). `ws_gateway.ts` and `opencode_stream_bridge.ts` are never mocked.

## Live sandbox check — explicitly SKIPPED

Investigated both existing scriptable WS-driving paths before deciding:

- `tools/dev/agent_eval_driver.ts` — has a WS helper (`ws.send({v:1, type:'session.input', id, data})`)
  but no experiment/enrollment scripting at all.
- `apps/api_server/src/__tests__/live_e2e_self_improvement_foundation.test.ts` — a real, ~1200-line
  live E2E harness with its own WS helpers (`openAgentSocket`/`driveTurn`), gated behind
  `RHYTHM_LIVE_E2E=1`, that drives real WS turns against the sandbox.

Neither can exercise this issue's actual claim ("an interactive WS run with an explicit
`runEpisodeId` produces an outcome bound to the correct cohort/proposal") because **there is no HTTP
route that calls `reserveRunEnrollment`** — it is an internal service function invoked only by
`agent_runner.ts` (C1) and, in the future, the WS prompt-dispatch boundary itself (C2-D S4, tracked
separately in #1448 and explicitly not this slice's job). Building a route or other scaffolding to
make a live reservation triggerable now would be new scope for a capability this issue is not
assigned to build. Per the dispatch's own instruction ("if building one from scratch would be large
new scaffolding, skip the live check, say so explicitly, and rely on the focused test"), I skipped it
and relied on `issue-1451-c5`, which already drives the real production WS bridge code end-to-end
against a real SQLite-backed enrollment/receipt/outcome chain, faking only the actual external engine
process and model catalog.

## Decisions / deviations

- Scoped "AgentRunner receives it via the run input" and "bridges the gap for ... delegated runs" to
  the DIRECT interactive WS chat turn only (`opencode_stream_bridge.ts`'s three terminal-hook call
  sites). Did NOT thread `runEpisodeId` into `agent_delegation_service.ts`'s synchronous
  `delegateToAgent` (which also calls `agent_runner.ts`'s `run()`, already supports
  `AgentRunOptions.runEpisodeId` from C1) — that caller is triggered from inside an MCP tool
  execution, not from a WS frame, so there is no natural "handshake" value to thread through it
  without inventing a session-scoped lookup this issue doesn't ask for. If a future issue needs
  delegated-run cohort binding, `runAgent({...runEpisodeId})` is already a one-line call away.
- `pendingRunEpisodeId` follows the exact same transient-Map convention as the class's existing
  `pendingText`/`pendingPermissions`/`pendingQuestions` (including cleanup in `stopStream`/`dispose`).
- Single-use, read-and-clear (`consumeRunEpisodeId`): a `runEpisodeId` set for one turn can never leak
  onto a later, unrelated turn on the same long-lived interactive session.
