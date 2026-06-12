# OPC-M1-5 — Resume with real conversation continuity

**Milestone:** M1 — Foundation
**Branch:** `opc-m1-5-resume-continuity`
**Depends on:** OPC-M1-2, OPC-M1-3

## Summary

Persist the SDK session id on the local session row at create time and make
`resume()` re-attach to it: re-populate `opencodeSessionMap`, re-register the stream filter,
and let the next prompt continue the same SDK conversation. The Flutter side rehydrates the
transcript (already built in M1-3), so a resumed session shows its full history and the model
keeps its context.

## Motivation

Audit B: `resume()` creates a fresh SDK session — no conversation continuity; the
`sessionToken` DB field is unused; `session.messages` is never called. Architecture doc lists
resume as a known stub. Opencode sessions are durable server-side (the embedded server stores
them under its data dir), so re-attach is the correct semantic.

## Scope

- Migration: `ALTER TABLE agent_sessions ADD COLUMN sdk_session_id TEXT` (PRAGMA-guarded); populate on create. (Repurpose/retire the unused `sessionToken` field — prefer the new explicitly-named column; mark old field deprecated.)
- `resume()`: look up `sdk_session_id` → verify the SDK session still exists (typed `getSession`/list wrapper from M1-1) → `opencodeSessionMap.set(localId, sdkId)` → register stream filter → status `running`/`idle` per SDK status. If the SDK session is gone, return 410 with a clear message (client offers "start fresh").
- Server boot: do NOT auto-resume all sessions; sessions remain `resumable` until user action (matches current UX).
- Flutter: resume action calls REST resume, then rehydrates messages (M1-3 path); composer enabled on success; 410 → dialog offering new session seeded with same name/cwd.

## Likely files

- `apps/api_server/src/database/migrations.ts`
- `apps/api_server/src/controllers/agent_sessions_controller.ts` (resume())
- `apps/api_server/src/services/opencode_engine.ts`
- `apps/api_server/src/services/opencode_stream_bridge.ts`
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`

## Acceptance criteria

1. POST create persists `sdk_session_id`; vitest asserts the row value equals the mocked SDK session id.
2. `resume()` on a session with a live SDK session re-maps `opencodeSessionMap` and does NOT call `createSession` (spy assert: zero create calls).
3. After resume, a WS `session.input` routes the prompt to the original sdk id.
4. `resume()` when the SDK reports the session missing returns HTTP 410 with a message naming the session; no map entry is created.
5. Flutter: resuming a session triggers exactly one messages rehydrate fetch and renders prior parts (controller test with fakes).
6. Flutter: 410 surfaces the "start fresh" affordance (widget/controller test).
7. `ai-workflow checks --level pr` exits 0.

## Required tests

- vitest: extend `agent_sessions.test.ts` + new `opc_m1_5_resume_contract.test.ts` (criteria 1-4).
- flutter test: `opc_m1_5_resume_test.dart` (criteria 5-6).

## Out of scope

- Fork (M4-2). Compaction (M3-3). Auto-resume on app launch.
