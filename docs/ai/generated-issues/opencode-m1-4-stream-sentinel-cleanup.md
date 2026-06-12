# OPC-M1-4 — Stream lifecycle + sentinel cleanup; dead code removal

**Milestone:** M1 — Foundation
**Branch:** `opc-m1-4-stream-sentinel-cleanup`
**Depends on:** OPC-M1-3

## Summary

Make session teardown real and remove time-based in-memory sentinels: implement
`stopStream()` (currently a no-op at `opencode_stream_bridge.ts:580`), replace the
`erroredSessions` 5s `setTimeout` sentinel with persisted session status, and remove the
`__pending__` sentinel leakage paths. Delete `pty_runner.ts` (dead since PR #574).

## Motivation

Root cause 5: in-memory sentinels leak across turns — an errored session "un-errors" itself
after 5 seconds regardless of reality; `__pending__` rows surfaced raw in UI (#651/#652
band-aids). The no-op `stopStream` means closed sessions keep consuming bridge filtering work
and can emit ghost events for deleted local ids.

## Scope

- `stopStream(localId)`: unregister the session from the shared stream's routing/filter map so events for that sdk session are no longer relayed or persisted after DELETE/close; shared SSE subscription itself stays alive (current architecture).
- `erroredSessions`: persist error state on the session row (`status='error'`, `statusMessage`) via the existing repo; remove the setTimeout. Clearing happens on explicit user action (new prompt / resume), not on a timer.
- `__pending__`: confine the sentinel to the composer layer; it must never be persisted or broadcast (assert at the WS/REST boundary).
- Delete `apps/api_server/src/services/pty_runner.ts` + any test-only imports; update `docs/ai/architecture.md` "Known dead code".

## Likely files

- `apps/api_server/src/services/opencode_stream_bridge.ts` (:580)
- `apps/api_server/src/controllers/agent_sessions_controller.ts`
- `apps/api_server/src/repositories/agent_sessions_repository.ts` (status persistence if missing)
- `apps/api_server/src/services/pty_runner.ts` (DELETE)
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` (error-state consumption)

## Acceptance criteria

1. After `DELETE /agent-sessions/:id`, feeding the bridge a subsequent SSE event for that session's sdk id produces no WS broadcast and no DB write (vitest with spies).
2. `stopStream` for one session does not affect event relay for a second live session sharing the stream.
3. An error event sets the session row `status='error'` with message; restarting the server (re-reading the DB) still reports `error` — no time-based reset (assert after fake-timer advance of >5s).
4. Sending a new prompt to an errored session clears the error status via an explicit transition.
5. Repo-wide grep: zero references to `pty_runner`; no `setTimeout` in the errored-session path.
6. `__pending__` never appears in any WS frame or REST response (boundary test).
7. `ai-workflow checks --level pr` exits 0; full vitest + flutter test green.

## Required tests

- vitest: new `opc_m1_4_stream_lifecycle.test.ts` (criteria 1-4, 6) with fake timers.
- flutter test: errored session renders persisted error state and clears on resend.

## Out of scope

- No resume implementation (M1-5).
- No retry-status surfacing (M2-4).
