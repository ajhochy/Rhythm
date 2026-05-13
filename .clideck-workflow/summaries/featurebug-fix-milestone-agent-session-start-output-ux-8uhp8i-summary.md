# Feature/Bug Fix Milestone: Agent Session Start & Output UX

Three adjacent bugs in the Rhythm Flutter desktop agent-session flow — all surfacing when a user tries to start a Claude Code agent session from the "New agent session" modal. Fixed as one milestone across server (TypeScript) and client (Flutter/Dart).

## Issues

### Bug 1: Repair legacy agent_configs IDs and add server-side alias normalization
**Issue #549** · Commit `117263aa1c78b97bcc8dd20ce8b15605716ae063`

Legacy `agent_configs` rows with `id='claude'` (from older seeds) caused `POST /agent-sessions` to return 400. Added an idempotent DB migration to rename legacy rows to kebab-case canonical IDs, plus a server-side alias map so stale clients sending `'claude'`, `'claudeCode'`, `'gemini'`, or `'codexCli'` are normalized to the canonical IDs before lookup.

Files changed:
- `apps/api_server/src/database/migrations.ts`
- `apps/api_server/src/controllers/agent_sessions_controller.ts`
- `apps/api_server/src/__tests__/agent_sessions.test.ts`

### Bug 2: Surface structured server error messages (4xx vs 5xx) in the new-session dialog
**Issue #550** · Commit `64b07b8691ecacecbb2ce8134131abd0f3e0b74f`

Non-2xx responses from `POST /agent-sessions` were rendered as a generic "Internal server error" regardless of status. Updated `assertOk` to pass HTTP statusCode through `AppError`, updated `AgentsController` to expose `lastErrorStatus`, and updated the new-session dialog to show the server's `error.message` verbatim for 4xx errors and a friendly generic message with a collapsible details disclosure for 5xx errors.

Files changed:
- `apps/desktop_flutter/lib/app/core/utils/http_utils.dart`
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`
- `apps/desktop_flutter/test/app/core/utils/http_utils_test.dart`
- `apps/desktop_flutter/test/features/agents/new_session_dialog_error_test.dart`

### Bug 3: Cursor-aware ANSI stripping on server + matching live ANSI strip on Flutter client
**Issue #551** · Commit `aecadd5`

Claude Code's TUI uses cursor-positioning CSI sequences (`ESC[nC`, `ESC[nG`, `ESC[r;cH`) instead of literal spaces to lay out text. The existing single-pass `stripAnsi` stripped those sequences without substituting whitespace, causing words to concatenate ("Accessingworkspace"). Replaced with a two-stage pipeline: expand cursor-positioning sequences to approximate whitespace first, then strip remaining ANSI. Ported the same pipeline to Dart for the Flutter live PTY view.

Files changed:
- `apps/api_server/src/services/transcript_service.ts`
- `apps/api_server/src/services/transcript_service.test.ts`
- `apps/desktop_flutter/lib/app/core/agents/ansi_strip.dart` *(new)*
- `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart`
- `apps/desktop_flutter/test/app/core/agents/ansi_strip_test.dart` *(new)*

## Manual Setup Needed

None. All changes are code-only — no API keys, environment variables, secrets, webhooks, or DNS configuration required.
