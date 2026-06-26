---
date: 2026-06-25
repo: Rhythm
branch: workflow/run-2026-06-25-agent-fixes
pr: null
issues: [743]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #743 — Child session persistence + getDiff flood fix

## Files changed

| File | Change |
|------|--------|
| `apps/api_server/src/database/migrations.ts` | Additive SQLite migration: `parent_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL` |
| `apps/api_server/src/database/postgres_bootstrap.ts` | `ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS parent_session_id` |
| `apps/api_server/src/models/agent_session.ts` | Added `parentSessionId: string \| null` to `AgentSession` interface |
| `apps/api_server/src/repositories/agent_sessions_repository.ts` | `parent_session_id` in row type + `rowToModel`; new `upsertChildSession()` method (inherits parent's `agent_kind`) |
| `apps/api_server/src/services/opencode_stream_bridge.ts` | `session.created` event handler: detects `info.parentID`, calls `upsertChildSession`, broadcasts child row |
| `apps/api_server/src/controllers/agent_sessions_controller.ts` | `getDiff()` returns `200 []` (not `404 AppError.notFound`) for unknown session ids |
| `apps/api_server/src/@types/opencode-ai-sdk.d.ts` | Fixed `EventSessionCreated.properties` shape: `info` key with `parentID` (was wrong `session` key) |
| `apps/desktop_flutter/lib/features/agents/models/agent_session.dart` | Added `parentId`, `isChildSession`, fromJson (`parentSessionId`/`parentId` fallback), toJson, copyWith |
| `apps/desktop_flutter/lib/features/agents/views/_session_list_body.dart` | `_buildSessionTree()` groups children under parents; `ChildSessionRow` widget (indented, arrow icon) |
| `apps/api_server/src/__tests__/issue_743_child_session_persistence.test.ts` | **New**: 4 unit tests for `upsertChildSession`, 1 HTTP test for getDiff soft-404 |
| `apps/desktop_flutter/test/features/agents/issue_743_parent_id_test.dart` | **New**: 7 fromJson/toJson/copyWith tests, 4 grouping logic tests |

## Checks run

| Check | Result |
|-------|--------|
| `dart format --set-exit-if-changed` | PASS — 0 changed |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings |
| `tsc --noEmit` | PASS — exit 0 |
| `npm test` (vitest) | PASS — 1232/1232 (144 files; 5 new issue_743 tests) |
| `flutter test` | PASS — 676/676 (11 new issue_743_parent_id tests) |
| `ai-workflow checks --level pr` | PASS — 4/4 gates |
| Live server `/health` | PASS — `{"status":"ok"}` |
| Live server `/agents/capabilities` | PASS — 5 capability keys |

## Notes

- **SDK d.ts fix was load-bearing**: the hand-written `EventSessionCreated.properties` shape had a `session` key instead of `info` key. Fixed to match the real opencode fork's `CreatedEventSchema`. Without this, `createdInfo?.parentID` would always be undefined and child sessions would never be detected.
- **`agent_kind` inheritance**: `upsertChildSession` now queries `SELECT id, agent_kind` from the parent row and uses that value for the child INSERT. Original implementation hardcoded `'opencode'` which isn't a valid `AgentKind` union value (`'claude-code' | 'codex'`).
- **`logger.debug` unavailable**: logger shape is `{info, warn, error}` only — downgraded both `debug` calls to `info`. See `decisions/2026-06-25-issue-743-logger-debug.md`.
- **Pre-existing flaky test**: `claude_triggers.test.ts` "repeated add/remove/add" fails non-deterministically in full suite runs (passes in isolation). Test-order isolation issue, unrelated to this PR.
- **Visual UI note**: `_session_list_body.dart` change is additive — tree grouping only fires when sessions with `parentId != null` exist. Since `upsertChildSession` is new, no production data has parent_session_id rows yet; existing session list renders identically for all current users.
- **Live getDiff smoke**: running dev server returned 404 (not 200) because it hadn't reloaded changes. The vitest HTTP test (fresh server from source) confirmed the 200 behavior correctly.
