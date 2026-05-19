# Project State

## Recent coding-agent runs

### 2026-05-19 — feat/agents-per-message-action-row (#606)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_message_actions_row.dart` — new file; `MessageActionsRow` StatefulWidget with Copy icon (flash animation), Bell/notify toggle, relative timestamp; `MessageTimeTicker` wrapper using a global `_TimeTick` ChangeNotifier (single `Timer.periodic` shared across all rows); `_relativeTime` helper (just now / Xm / Xh / full date).
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — wired `MessageActionsRow` and `MessageTimeTicker` into `_buildTranscriptBody`; `copyText` computed from parts before `_ChatBubble` call; action row inserted in Column after bubble, inside `ListView.builder`.
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — `_notifyOnCompletion` Set<String>, `isNotifyArmed`, `toggleNotify`, `_fireArmedNotifications`; `LocalNotificationService.showMessageNotification` called when session finishes working with armed messages.
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: used a single global `_TimeTick` ChangeNotifier (one Timer for all rows) instead of per-bubble timers to avoid timer proliferation in long transcripts. Action row is outside `_ChatBubble` (in the ListView itemBuilder Column), not inside, to keep `_ChatBubble` a pure renderer. Notify key format is `"$sessionId:$messageId"` to scope flags per session.
- Deviations from spec: none — all acceptance criteria implemented; action row not shown for "…" placeholder (empty children guard in `_ChatBubble` returns early before the Column wrapping the row is reached).
- Concerns: `_globalTimeTick` is a module-level singleton — it runs for the app lifetime even when no chat is visible. Overhead is minimal (one tick per minute, no widget rebuild unless `MessageTimeTicker` is in tree). Timer is properly cancelled in `_TimeTick.dispose()` but dispose is never called on the singleton; acceptable for a long-lived app-level resource.

### 2026-05-19 — feat/agents-archive-ui (#601)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — added `_confirmDelete` method and "Delete permanently" `PopupMenuButton` to `_ArchivedSessionRow` so hard-delete is available from archived rows; all other acceptance criteria were already implemented on this branch
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: All archive infrastructure (model `archivedAt` field, data source `archiveSession`/`unarchiveSession`, controller `archiveSession`/`unarchiveSession`/`loadArchivedSessions`/`archived` getter, WS `session.updated` routing, collapsible Archived section in `_SessionListPanelState`, `_SessionRowMenu` with Archive + Delete items, `_ArchivedSessionRow` with Restore button) was already implemented in prior runs on this branch (#605 WS broadcasts). The only gap was "Delete permanently" on archived rows — added as a `PopupMenuButton` with confirm dialog.
- Deviations from spec: none — all four acceptance criteria satisfied
- Concerns: none; the `deleteSession` controller method handles archived rows correctly (removes from `_sessions` but `_archived` is managed by WS `session.removed` broadcast; optimistic local removal works because `deleteSession` filters all three lists indirectly via WS)

### 2026-05-19 — fix/sync-production-task-mirror (#620)
- Files modified:
  - `apps/api_server/src/config/env.ts` — added `prodApiUrl` and `prodAuthToken` fields (read from `PROD_API_URL` / `PROD_AUTH_TOKEN` env vars); defaults to `null` so existing deployments are unaffected
  - `apps/api_server/src/services/sync_orchestrator_service.ts` — added `mirrorProductionTasksAsync()` method and `fetchProductionTasks()` helper; `runSync()` now calls the mirror before integrations loop. Pagination: fetches pages of 100 until a page is shorter than the limit. Upsert strategy: tasks whose ID already exists verbatim in local DB (pre-split) are updated in-place; new tasks are inserted as `source_type='prod_mirror'` + `source_id=<prod uuid>` so subsequent syncs are idempotent.
  - `apps/api_server/src/jobs/sync_orchestrator_job.ts` — cron tightened from `*/30` to `*/10` minutes (issue: 30-min window is too large)
  - `apps/api_server/src/controllers/sync_controller.ts` — new; `POST /sync/now` handler; calls `mirrorProductionTasksAsync()` synchronously and fires `runSync()` in background; returns `{ status, upserted, skipped }`
  - `apps/api_server/src/routes/sync_routes.ts` — new; mounts `/sync/now`; respects `AGENT_LOCAL` bypass same as all other agent-local routes
  - `apps/api_server/src/app.ts` — added `syncRouter` import and `app.use('/sync', syncRouter)`
  - `apps/api_server/src/services/__tests__/sync_orchestrator_service.test.ts` — new; 6 unit tests covering: first-sync upsert, idempotency, pagination, no-op when env unconfigured, graceful failure on network error, in-place update for pre-split tasks
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓. Vitest: pre-existing ABI mismatch (`better-sqlite3` compiled for NODE_MODULE_VERSION 127, runtime requires 137) prevents all SQLite-based tests from running in this environment; this is a known pre-existing condition affecting ALL tests in the repo, not introduced here.
- Decisions made: root cause is architectural — `SyncOrchestratorService` never had production task mirroring; the local SQLite only had tasks created locally or pre-split. Fix adds OPTIONAL mirroring (no-op when env vars absent) so existing deployments are unaffected. `source_type='prod_mirror'` is used rather than inserting with the original UUID to keep upsert idempotent without collision risk against locally-created tasks with the same UUID; verbatim-ID tasks (pre-split) are handled as a special case. Cron tightened to */10 + manual `/sync/now` endpoint added as dual mitigation.
- Deviations from spec: none
- Concerns: `mirrorProductionTasksAsync()` fetches ALL tasks in pages — for very large task lists this could be slow. No incremental sync (e.g. `updatedSince`) because the production API endpoint (`GET /tasks`) doesn't expose a filter param. A future incremental-sync feature would require a server-side `updated_since` query param. The test file is logically correct but cannot execute in this CI environment due to the pre-existing better-sqlite3 ABI issue.

---

### 2026-05-19 — feat/agents-session-ws-events (#605)
- Files modified: none — all implementation was already committed to this branch prior to this coding-agent run.
  - `apps/api_server/src/services/ws_gateway.ts` — exports `broadcastSessionUpdated(session)` and `broadcastSessionRemoved(id)` helper functions.
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — imports and calls `broadcastSessionUpdated` in `remove` (soft-close) and `update` (PATCH, including archive toggle), and `broadcastSessionRemoved` in `destroy` (hard-delete).
  - `apps/desktop_flutter/lib/features/agents/models/agent_ws_message.dart` — `SessionUpdatedMessage` and `SessionRemovedMessage` classes with `fromJson` factories; both registered in `AgentWsMessage.parse` switch.
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — `_onWsMessage` handles `SessionUpdatedMessage` (upsert via `_upsertById` across sessions/resumable/archived based on archivedAt/status) and `SessionRemovedMessage` (filter from all three lists + clean up liveOutputBuffer, sessionFirstSeenAt, selectedSessionId).
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✗ (pre-existing errors in out-of-scope files `sync_orchestrator_service.ts` and `sync_routes.ts`; owned files compile clean).
- Decisions made: this coding-agent run confirmed all changes already in place. Stream bridge status transitions deferred per issue spec (no trivial hook; regression risk). Follow-up needed: "emit session.updated on stream bridge status transitions".
- Deviations from spec: stream bridge transitions deferred as spec allowed.
- Concerns: pre-existing TypeScript errors in out-of-scope files cause `ai-workflow checks` to show failure; owned code is clean.

---

### 2026-05-19 — fix/server-bundled-sentinel-abi-fallback (#615)
- Files modified:
  - `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — implementation was already present from commit `726a5c4` ("fix(server): lifecycle cleanup + ABI-matched Node selection"). No code change was needed; coding-agent verified completeness and ran checks.
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓ (0 errors), `dart format` ✓ (0 changes), `tsc --noEmit` ✗ (pre-existing errors in out-of-scope unstaged WIP files `sync_orchestrator_service.ts`, `sync_routes.ts`, `sync_controller.ts`; owned `api_server_service.dart` compiles clean)
- Decisions made: Issue #615 was fully implemented in commit `726a5c4` on 2026-05-16. The implementation covers: (1) `_readRuntimeSentinelFull()` probes both dev walk-up path and `Resources/api_server/.node-runtime.json` bundled path; (2) `File(sentinelNodePath).existsSync()` validation; (3) `_findAbiMatchedNode()` scans candidates + `which node` login-shell fallback with `node -e 'process.stdout.write(process.versions.modules)'`; (4) Rich rebuild error message when no ABI match found.
- Deviations from spec: none — all four acceptance requirements satisfied in existing code
- Concerns: ABI fallback startup time: `_findAbiMatchedNode` runs `which node` via login shell + probes up to 4 Node binaries; login shell spawn is ~100-200ms and each `node -e` probe is ~50-100ms. Total overhead on worst-case path: ~500ms. Results are not cached between app launches (no persistent cache). In practice this path only runs when the sentinel's nodePath is missing (e.g. Node uninstalled/moved), so it's not on the hot path.

---

### 2026-05-19 — fix/lifecycle-terminate-spawned-processes (#614)
- Files modified: none — all implementation was already committed in prior coding-agent runs on this branch
  - `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — `stopGracefully()` (SIGTERM→2s→SIGKILL), `_killOrphanIfPresent()` (orphan-port reclaim on boot with PPID=1 check)
  - `apps/desktop_flutter/lib/main.dart` — SIGINT/SIGTERM signal handlers; `didChangeAppLifecycleState(detached)` calls `stopAndDispose()`
  - `apps/desktop_flutter/lib/app/core/layout/app_shell.dart` — `WindowListener.onWindowClose()` with `preventClose=true`; calls `AgentServerController.stopAndDispose()` then `windowManager.destroy()`
  - `apps/api_server/src/server.ts` — SIGTERM/SIGINT shutdown handler: stops cron jobs, calls `opencodeClient.dispose()`, closes WS server, closes HTTP server with 1s force-exit fallback; parent-PID watchdog (polls ppid every 2s; self-shuts on orphan)
  - `apps/api_server/src/services/opencode_client_service.ts` — `dispose()` calls `server.close()` to kill the opencode subprocess on :4096
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: all lifecycle work was already in place from prior runs in this batch. This coding-agent run confirmed completeness by reading all owned files, then ran validation.
- Deviations from spec: none
- Concerns: `didChangeAppLifecycleState(detached)` is a best-effort last resort; Cmd+Q flows through `onWindowClose` which is the primary graceful path. Force-quit (Cmd+Opt+Esc) cannot be intercepted but is handled by the startup orphan-reclaim logic.

---

### 2026-05-19 — fix/agents-ws-gateway-model-follow-up (#624)
- Files modified:
  - `apps/api_server/src/services/ws_gateway.ts` — two changes: (1) in the `__pending__` block, persist `providerId`+`modelId` on the session row when the first turn resolves agent kind, so follow-up turns use `resolveModelForSessionTurn`'s session-level path instead of falling back through the authed-provider list; (2) after model resolution, added a guard that sends a `type: 'error'` WS frame and returns early if `model` is `undefined` (unknown agentKind not in resolver catalog), with a `console.log` logging the resolved route for every turn to make silent failures visible
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: fix by code-review only (no opencode SDK available for live reproduction). Root-cause theory: `__pending__` sessions' first `session.input` carries `perTurnOverride` but never persisted `providerId`/`modelId` on the session row; follow-up turns (no override) fell back to `resolveModelForAgent` which could return a different model or `undefined` for unknown agent kinds. Added both the persistence fix and the defensive guard. Analogous to commit `40d4fee` which added model resolution in the first place.
- Deviations from spec: none
- Concerns: live reproduction requires the opencode SDK; manual smoke at end of batch will confirm. The `updateFields` call in the `__pending__` block is best-effort (wrapped in try-catch); if it fails, the follow-up will still use `resolveModelForAgent` as fallback. The new guard for `undefined` model will surface previously-silent failures as a WS error frame.

---

### 2026-05-19 — feat/agents-question-tool-selector (#622)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_question_tool_card.dart` — new file; `QuestionToolCard` StatefulWidget; parses `toolArgs.questions[]` into interactive answer buttons; submits via `AgentsController.sendInput`; shows "Answered: <label>" stub after selection; handles multi-question batch flows
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — added `sessionId` param to `_ChatBubble`; routing in tool-part loop: `toolName == 'question'` → `QuestionToolCard`, else → `ToolCallPart`; added import for `_question_tool_card.dart`; updated `_buildTranscriptBody` call site to pass `session.id`
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: tool lookup key is `part.toolName?.toLowerCase() == 'question'` (case-insensitive match for the SDK's tool name); submission goes via existing `controller.sendInput(sessionId, text)` — no new controller methods; `session.input` is the only upstream path in the WS gateway (see `ws_gateway.ts`); a TODO comment marks the spot to switch to a dedicated tool-result path if one is added later (#622 follow-up)
- Deviations from spec: "free-text Other" not implemented — the SDK's `question` tool schema doesn't expose a free-text field in `toolArgs`; spec item is aspirational. Multi-select via checkboxes replaced by multi-question sequential selection (each question still gets exactly one answer per the SDK contract).
- Concerns: submission path uses `session.input` which triggers a new agent turn rather than a true tool-result reply. This is the only path available in the current WS gateway. If the SDK exposes a `question.answer` or `tool.result` event type in the future, `_submit()` in `_question_tool_card.dart` is the one place to update.

---

### 2026-05-19 — feat/agents-bubble-agentless-session (#623)
- Files modified:
  - `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — replaced `startAgent(String agentId)` + multi-button layout with `_openChat()` that creates an agent-less session (`agentId: null`); single "Open chat" button; simplified `_bubbleHeight` to a fixed getter
- Checks run: `ai-workflow checks --level issue` → `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: preferred-agent default not plumbed — `PendingTrigger` / `AgentBubbleEntry` carry no `preferredAgentId`; wiring it into the composer would require touching `agents_view.dart` (out of scope); left `TODO(#623 follow-up)` comment in `_openChat()`
- Deviations from spec: preferred-agent default for claude-trigger payloads deferred (spec said "if no clean way, leave a TODO" — done)
- Concerns: none; `createSession(agentId: null)` path already verified working server-side per PR #617/#602

---

### 2026-05-19 — fix/agents-bubble-transcript-per-session (#625)
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — added `_transcriptsBySession` map and `transcriptFor(sessionId)` getter; updated all `_transcript` write sites (reconnect, selectSession, TranscriptAppendMessage, WsErrorMessage) to also write per-session
  - `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` — replaced `agents.transcript` + `isSelected` gate with `agents.transcriptFor(sessionId)` so bubble always shows its own session's transcript
- Checks run: `flutter analyze` ✓, `dart format` ✓, `tsc --noEmit` ✓
- Decisions made: added `_transcriptsBySession` as an additive map alongside the existing `_transcript` flat list; `_transcript` retained unchanged for backward compat with the main Agents tab view; both stores are updated in lock-step at every write site
- Deviations from spec: none
- Concerns: `_transcriptsBySession` grows unbounded for long-running sessions with many messages (same as `_liveOutputBuffer`); no concern for typical church-staff use; same behavior as existing `_liveOutputBuffer`.

---

## Current Status (2026-05-19 — follow-up fixes for #606, #622, #623, #624, #625 committed; smoke pending)

🟡 **Branch `follow-up` stays open. PR #617 still not merged.** PR #621 stacked on top — FK tolerance for production task IDs in the local SQLite. Independent and shippable.

### Today's work

[**PR #621**](https://github.com/ajhochy/Rhythm/pull/621) — `fix(agent-sessions): tolerate taskId missing from local SQLite (rebased onto #617/follow-up)`. Branch `fix/agent-session-fk-task-id-tolerance-followup`. Supersedes the closed PR #619 (which was against stale `main`).

**Bug fixed**: POST `/agent-sessions` with a `taskId` not in the local SQLite `tasks` table returned 500. Flutter picker reads tasks from production (`api.vcrcapps.com`) but POSTs hit localhost; the sync mirror is incomplete; SQLite raises `SQLITE_CONSTRAINT_FOREIGNKEY` on `agent_sessions.task_id REFERENCES tasks(id)`; controller doesn't catch it. New-session dialog showed "Something went wrong on the server"; Task-ready bubble showed "Internal server error".

**Fix**: in `agent_sessions_controller.create()`, probe `TasksRepository.findByIdIncludingLegacy(taskId)` before insert. On miss, log `warn` and null out `task_id`; `task_title` is preserved (the schema stores them independently — see migration comment introducing `task_title`).

**Acceptance contract** at `docs/ai/contracts/pr-619.json`. Two strengthened tests assert the full launch path: HTTP 201 + reconciled taskId + preserved taskTitle + `opencodeClient.createSession(name, cwd)` invoked + `opencodeSessionMap` populated + `promptAsync` invoked with initial prompt containing taskTitle. Red proven by reverting the controller fix → 2 fail with `expected 500 to be 201`. Green: 508/508.

**Smoke infrastructure**: `apps/api_server/scripts/smoke-launch.sh` (`npm run smoke:launch`). Verifies sentinel Node + ABI match + dist build, spawns the api_server with exactly the env Flutter uses (`PORT=4001 AGENT_LOCAL=true DB_PATH=/tmp/rhythm-smoke/smoke.db`), hits `/health`, `/agents/capabilities`, and the PR's regression POST. Uses `set -m` + process-group kill on cleanup + `pkill -9 -f "opencode serve"` so the SDK's child server on `:4096` can't orphan and surface as "Reusing existing server on :4001" on the next Rhythm.app launch (which silently coupled stale dev servers earlier in this session).

**Live verification**: against the running `flutter run -d macos` app, POST with bogus taskId returned **HTTP 201**, WARN was logged, taskTitle preserved. End-to-end through the actual SDK and Anthropic provider.

### Bugs caught during manual smoke and filed as follow-ups

| # | Title | Notes |
|---|---|---|
| [#620](https://github.com/ajhochy/Rhythm/issues/620) | sync: local SQLite tasks table missing tasks that exist on production | The underlying gap PR #621 defends against. #621 is the boundary fix; #620 fixes the mirror. |
| [#622](https://github.com/ajhochy/Rhythm/issues/622) | agent chat: `question` tool call renders as raw args instead of an answer selector | Wall of JSON shown instead of clickable options. Any agent that asks structured questions becomes unusable. |
| [#623](https://github.com/ajhochy/Rhythm/issues/623) | agent chat: Task-ready bubble forces agent pre-selection instead of using the composer picker | Bubble's `startAgent(agentId)` predates the #602 composer redesign. Should open agent-less. |
| [#624](https://github.com/ajhochy/Rhythm/issues/624) | agent chat: follow-up user message accepted by SDK but no LLM call fires; UI stuck on "working" | **Critical**: first prompt's 7-step output works; second prompt logs only `message.updated` — no `step=N loop`, no `service=llm`, no deltas. Smells like a regression of the `40d4fee` "model on follow-up turns" fix. Includes the SDK timeline as repro. Also covers the related persistence desync (`lastActivityAt` stays null even after streamed output). |
| [#625](https://github.com/ajhochy/Rhythm/issues/625) | agent chat: mini-bubble transcript blanks when a different session is selected in the Agents tab | Bubble reads from `_transcript[selectedSessionId]` instead of its own `widget.entry.sessionId`. Breaks the persistent-chat premise of the bubble overlay entirely. |

### Follow-up bug status (2026-05-19 batch fixes)

| # | Title | Status |
|---|---|---|
| [#622](https://github.com/ajhochy/Rhythm/issues/622) | `question` tool renders as raw args | ✅ Fixed — commit `3abb2f4` |
| [#623](https://github.com/ajhochy/Rhythm/issues/623) | Task-ready bubble forces agent pre-selection | ✅ Fixed — commit `1844fce` |
| [#624](https://github.com/ajhochy/Rhythm/issues/624) | Follow-up prompt: no LLM call fires, UI stuck on "working" | ✅ Fixed — commit `37fcc26` (code-review fix; manual smoke to confirm) |
| [#625](https://github.com/ajhochy/Rhythm/issues/625) | Mini-bubble transcript blanks on session switch | ✅ Fixed — earlier commit |
| [#620](https://github.com/ajhochy/Rhythm/issues/620) | Local SQLite tasks table missing production tasks | 🟡 Open — lower priority; PR #621 defends the boundary |

### Critical-path before next release

- All critical-path blockers (#606, #622–#625) have fixes committed on `follow-up`.
- **#624 fix needs manual smoke confirmation** — no opencode SDK available for live reproduction; fix was by code review. Key behavior: follow-up user messages in an agent session should trigger a new LLM stream.
- **#606 (action row)** — purely additive Flutter UI; no API changes. Manual smoke should confirm: Copy copies text, Bell arms notification, timestamp shows correctly below each bubble.
- **#620** is lower-urgency; PR #621 keeps the symptom invisible.

### Tooling lessons recorded

Postmortem: `.agent-stack/postmortems/2026-05-19-pr-621-agent-fk-tolerance.json`. Two reusable artifacts:

1. `apps/api_server/scripts/smoke-launch.sh` — repeatable build+spawn pipeline check. Catches ABI mismatches and orphan-port issues programmatically instead of "click Retry, repeat."
2. The acceptance-contract pattern (`docs/ai/contracts/pr-619.json`) — tests that prove **launch**, not just **insert**. The mandate "PASS = sessions actually launch" came directly from the user when the earlier test was only proving the row was inserted.

Workflow lesson: **before branching off `main`, check `gh pr list --state open` for an active draft trunk** (#617 was the real trunk; the original PR #619 was wasted effort branching off stale `main`).

---

## Previous Status (2026-05-18 — manual smoke of vbeta.18.36; iterate on `follow-up`, do not merge #617 yet)

🟡 **Branch `follow-up` stays open. PR #617 NOT merged.** User decision after a full manual smoke pass: keep grinding bugs on this branch, re-smoke after each fix cluster, merge to `main` only when ≥80% of the original smoke checklist passes cleanly.

### What landed this session

Six commits on `follow-up` (mine + a parallel agent's):

1. **`promptAsync` TypeError** — commit `49ef628`. `apps/api_server/src/services/ws_gateway.ts` was extracting `opencodeClient.promptAsync` as a bare function reference (cast-to-alias pattern from `acdc835`), losing `this`. Every send threw `Cannot read properties of undefined (reading 'client')`. Fix: `.bind(opencodeClient)`. Most user-visible regression on the branch — user hit it ~5× during smoke before root-cause.
2. **PATH discovery for opencode binary** — folded in via merge `34d57bf` (closed PR #618). `apps/api_server/src/services/opencode_client_service.ts` exports `augmentPathForOpencode()`, prepends `~/.opencode/bin`, `/opt/homebrew/bin`, `/usr/local/bin` before `createOpencode()`. GUI-spawned `.app` children get a stripped PATH; without this, opencode binary not found. +4 unit tests.
3. **Parent-PID watchdog** — `apps/api_server/src/server.ts` polls `process.ppid` every 2s; if it flips to 1 (orphaned to launchd), runs the SIGTERM clean-shutdown. Defense in depth for Cmd+Q via NSApp.terminate killing the Dart engine before its lifecycle hooks fire.
4. **`server.close()` in `dispose()`** — `OpencodeClientService.initialize()` now destructures and stores the `server` handle from `createOpencode()`; `dispose()` calls `server.close()` to actually kill the :4096 subprocess (previous `client.close()` / `client.shutdown()` probes didn't exist on the SDK).
5. **`_pendingTurnOverride` in `setSessionModel`** — `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`. Picking session-default in the model picker no longer leaves the per-turn override unset; "Pick a model before sending the first message" error gone.
6. **From parallel agent:** `ensureReady()` auto-recovery + dispose stack traces (`2f5fbdb`), curated OpenRouter models in catalog (`6b341d4`), Express body limit → 1 MB (`f52d3b0`).

Verification: **503/503 vitest**, **218/218 flutter test**, `tsc --noEmit` clean, `dart format` + `flutter analyze` clean.

### Smoke results (vbeta.18.36 against `/Applications/Rhythm.app/`)

**6 PASS / 1 PARTIAL / 10 FAIL** of 20 testable items. Lifecycle 4 (ABI fallback) skipped — needs v24-only machine.

PASS: Cmd+Q clears :4001 and :4096 ≤3s; new session + model picker + send to DeepSeek (TypeError gone); soft-close + hard-delete live; new-session has no agent dropdown + "Choose a model" placeholder; unified picker layout with Connect on unauthorized rows.

PARTIAL: Archive — DB write + active-list removal live, but **Archived section doesn't update live** (needs refresh). Issue: `docs/ai/generated-issues/fix-archived-section-not-updating-live.md`.

FAIL (each filed under `docs/ai/generated-issues/`):
- **Permissions pipeline never fires for Claude direct in default mode (#608)** — Bash runs unprompted, no PermissionCard. Highest severity, safety feature broken. `fix-permission-pipeline-not-firing-claude-direct.md`.
- **Reasoning effort + fast-mode never reach SDK (#604)** — 5th `sdkOpts` param in ws_gateway promptFn alias silently dropped; `OpencodeClientService.promptAsync` only accepts 4 params. `fix-thinking-budget-fast-mode-never-applied.md`.
- **File-attach paperclip is a no-op (#602)** — `fix-composer-file-attach-paperclip-no-op.md`.
- **Slash popover never appears (#610)** — `fix-slash-command-popover-not-firing.md`.
- **Notify-on-completion + relative timestamp ticker dead (#606)** — copy works; the other two don't. `fix-notify-on-completion-not-firing.md`.
- **OpenRouter curation overhaul (#609)** — picker filter too aggressive (hundreds curated → ~6 visible) + duplicate `anthropic/claude-sonnet-4.6` row. `fix-openrouter-curation-overhaul.md`.
- **VCS branch dropdown (#603)** — Dart type cast error `String is not subtype of Map<String, dynamic>?`, no "Current" section, switch fails silently. `fix-vcs-branch-dropdown-type-cast-and-switch.md`.
- **VCS chip never renders in session header (#607)** — entire surface invisible. `fix-vcs-chip-not-rendering-in-session-header.md`.

Inline UX findings filed: auto-scroll steals focus during streaming (`fix-agent-chat-auto-scroll-steals-focus.md`); pill mislabels non-Anthropic OpenRouter models as "Claude Code" (`fix-agent-kind-mislabels-non-anthropic-openrouter-models.md`); default model should be Sonnet not Opus (`tweak-default-model-sonnet-over-opus.md`); Google OAuth dialog hangs because route + UI assume auto-callback but SDK requires paste-back (`fix-google-oauth-paste-back-ui.md`).

### Next-session plan

1. High-severity: permission pipeline (#608), VCS parse error (#603), VCS chip (#607).
2. Medium: thinking/fast-mode SDK plumbing (#604), file attach (#602), slash popover (#610), notify + ticker (#606), OpenRouter curation overhaul (#609).
3. UX: archived live update, auto-scroll, pill mislabel.
4. Trivial: default Sonnet.
5. Re-smoke each cluster on a new DMG. Merge #617 only at ≥80% checklist pass.

## Prior Status (2026-05-18 — triage round 2: isReady flip + dispose diagnostics)

🟡 **Branch `follow-up` — 3 commits this session on top of PR #617 batch.**

### Fixes this session (2026-05-18)

1. **Chat broken for all sessions (`promptAsync` TypeError)** — committed as `49ef628`. Root cause: commit `acdc835` (#604) extracted `opencodeClient.promptAsync` from its object and cast it as a bare function reference, losing `this`. Every prompt threw `TypeError: Cannot read properties of undefined (reading 'client')`. Fix: `.bind(opencodeClient)` preserves `this`.

2. **Curated OpenRouter models not surfacing in model picker** — `listAllRoutes()` in `agent_model_resolver.ts` only iterates the hardcoded `ROUTE_FALLBACKS_BY_AGENT` map. The `agent_model_visibility` table (used by the "Browse & Curate" UI) was only applied to *hide* models from this hardcoded list — it never *added* curated models. **Fix**: Modified `GET /agents/models/catalog` to include curated OpenRouter models with `visible=1` not in the hardcoded fallback list. Commit `6b341d4`.

3. **`isReady` flip between `/opencode/health` and `POST /agent-sessions`** — the `OpencodeClientService.isReady` getter returned `true` for the health endpoint but `false` for the session-creation controller. Root cause: the PARENT_GONE watchdog (2s interval in `server.ts`) fires when `process.ppid` becomes 1 (parent process exits). This resets `this.status = 'uninitialized'` via `dispose()`, which is called by the shutdown handler. The watchdog is designed to catch macOS Cmd+Q (Flutter killed before it can SIGTERM the child), but it also fires during development when the shell or process-manager parent exits between requests.

   **Fix (commits `2f5fbdb`):**
   - Added `ensureReady()` to `OpencodeClientService` — auto-reinitializes the engine when `isReady` is false, unless the server is in intentional shutdown (`_shuttingDown` flag).
   - Made `initialize()` idempotent and re-entrant with `_initializing` guard (prevents double-init races from concurrent `ensureReady` calls).
   - Added dispose diagnostics: stack-trace logging on `dispose()`, idempotency guard, `isDisposed` getter.
   - Controller `create()` and `resume()` now log the current `statusMessage` and call `ensureReady()` before failing — gives a recovery window if the watchdog fired seconds earlier.
   - Server shutdown handler sets `_shuttingDown` on `opencodeClient` so `ensureReady()` does not wastefully re-initialize during teardown.
   - Raised Express JSON body parser limit to 1 MB (default 100 KB was causing `PayloadTooLargeError` on large OAuth callback payloads).

### What this branch lands
- **Install hardening (#614, #615)**: SIGTERM/SIGINT shutdown chain in api_server + lifecycle hooks in Flutter (window_manager onWindowClose, SIGINT/SIGTERM watchers, AppLifecycleState.detached). Orphan self-heal on next launch kills any node holding :4001 with PPID=1. `ApiServerService._readRuntimeSentinel` reads the bundled `Resources/api_server/.node-runtime.json` and ABI-matches against installed Node binaries; on total mismatch the failure dialog surfaces the exact `npm rebuild better-sqlite3 --build-from-source` command.
- **Sessions / archive / WS events (#601, #605)**: `agent_sessions.archived_at` column; `PATCH { archived }`; `?includeArchived` and `?archivedOnly` filters; new "Archive" row action and collapsible Archived section. `session.updated` / `session.removed` WS events emitted from every status / archive / PATCH / hard-delete touchpoint; Flutter dedupes and routes rows into sessions/resumable/archived live.
- **Permissions (#608, #611)**: `permission.asked` events from the SDK now broadcast via WS and surface as a PermissionCard (modal when DestructiveModalService.enabled). `accept` / `deny` endpoints invoke `respondPermission`. `agent_sessions.permission_mode` column with `default | acceptEdits | plan | bypassPermissions`. All four paths invoke `respondPermission` so the SDK never hangs. First selection of `bypassPermissions` requires confirmation.
- **Model picker enhancements (#604, #609, #610)**: Variant rows in `ROUTE_FALLBACKS_BY_AGENT['claude-code']` (Opus 4.7, Opus 4.7 1M, Opus 4.6 Legacy) and `['codex']`. `thinking_budget` + `fast_mode` columns; effort picker (Low → Max → budget_tokens map) + fast-mode toggle wired through WS `session.input`. New `agent_model_visibility` table + `GET /opencode/models?provider=openrouter` proxy + `GET/PATCH /agent-models/visibility`; AiAccountSection gains an expandable OpenRouter catalog with search/pricing/checkboxes. `SlashCommandPopover` anchored to the composer TextField with arrow-key navigation.
- **Per-message action row (#606)**: copy / notify-on-completion (LocalNotificationService) / relative timestamp under every bubble. Single global ticker drives timestamp updates.
- **Branch / VCS (#603, #607)**: `vcs_probe.listBranches` + `gitCheckout` helpers. New-session dialog gets a Branch dropdown with current/recent/local sections and "+ New branch from current" inline input. Dirty-tree → Stash/Cancel confirm. The VCS chip becomes a button; tapping it opens a popover with the same branch list, Stash/Discard/Cancel dirty-tree handling, and verbatim git errors in a SnackBar.
- **Composer redesign (#602)**: `GET /agents/models/catalog` returns the whole catalog grouped by Authorized — Claude/Codex/Copilot/Gemini → Free — OpenRouter, with `connectUrl` for unauthorized rows. Model picker, permission-mode pill, reasoning effort, fast-mode toggle, and a new file-attach button all live in the composer area. New sessions start agent-less (`agent_kind='__pending__'`); `agent_kind` is resolved from the first `modelOverride` on the first turn.

### Verification (local, 2026-05-16)

| Check | Result |
|---|---|
| `apps/api_server` `tsc --noEmit` | clean |
| `apps/api_server` `vitest run` | **506/506** (catalog curated-model test added + opencode_client_service object-map unwrap) |
| `apps/api_server` `npm run build` | clean |
| `apps/desktop_flutter` `dart format --set-exit-if-changed lib test` | clean |
| `apps/desktop_flutter` `flutter analyze --no-fatal-infos` | 0 errors (180 pre-existing infos) |
| `apps/desktop_flutter` `flutter test` | **218/218** |
| Server-side endpoint smoke (HTTP) | **22/22** — catalog, visibility, archive, permission modes, tuning fields, branch list + checkout, OpenRouter proxy |

### What still needs a human

Playwright cannot drive the Flutter macOS UI. The server side is fully smoked; the UI bits below need a manual pass against `flutter run -d macos`. Before launching, **fully quit Rhythm.app and free :4001** because #614 changes the lifecycle of the spawned child:

```
lsof -iTCP:4001 -sTCP:LISTEN -n -P    # find pid
kill <pid>
```

Then walk the PR #617 manual smoke checklist (full list lives in the PR body — copied here for reference):

- Install / lifecycle (#614, #615): Cmd+Q ↔ `lsof` empty; force-quit + relaunch self-heals; ABI-fallback on a v24-only machine.
- Sessions / archive / WS (#601, #605): live status updates without manual refresh; archive↔unarchive round-trip.
- Permissions (#608, #611): each of the four modes exhibits the documented behavior against a bash/write/edit prompt.
- Composer (#602, #604, #606, #609, #610): unified picker layout, agent-less new session, file attach, effort/fast-mode, slash popover, action row.
- Branch / VCS (#603, #607): branch dropdown in new-session, clickable chip with branch popover, dirty-tree handling.

After smoke, merge PR #617 manually on GitHub.

## Prior Status (2026-05-16 evening — vbeta.18.31 shipped; install-time gotchas filed)

🟢 **PR #598 merged to `main` via commit `d7a0775`.** Desktop release `vbeta.18.31` is **published** (DMG + ZIP) and verified running locally. Sibling PRs #593–#596 closed (content lives on main via #598); their branches deleted.

### Release-day discoveries (worth knowing before the next install)
Two install-time issues bit the post-install smoke after the DMG landed. Both have follow-up issues filed; the immediate workarounds are recorded here so the next person doesn't re-debug.

1. **First release build failed** — the "Bundle CLI server into app" workflow step ran `npm install` inside the bundled `Rhythm.app/.../api_server/`, which triggered the `package.json` postinstall (`node scripts/postinstall.js`) — but the workflow only copied `dist/`, `package.json`, and `package-lock.json` into the bundle, not `scripts/`. Fixed in **PR #613**: copy `scripts/` alongside `dist/` and add `test -f $DEST/scripts/postinstall.js` to the verify step so it fails at the gate next time. Re-triggered run was green.

2. **Orphan api_server kept old code alive across app updates** — quitting Rhythm.app does not kill the spawned api_server (PPID=1 orphan). The orphan keeps holding port :4001, the next launch of the updated app silently connects to the stale orphan, and the user sees ghost behavior that looks like the new fixes never shipped. **Workaround**: `kill <pid>` from `lsof -iTCP:4001`. **Proper fix tracked in #614**: window_manager.onWindowClose → SIGTERM → 2s grace → SIGKILL on the Node child; matching SIGTERM/SIGINT handler in api_server that also disposes the opencode subprocess; force-quit safety net auto-detects the PPID=1 orphan on next launch and kills it with a clear recovery log line.

3. **better-sqlite3 ABI mismatch after orphan kill** — the bundled `better-sqlite3` is built in CI against Node v22.22.2 (ABI 127); `ApiServerService._readRuntimeSentinel()` only checks the dev sentinel path (`$dir/apps/api_server/.node-runtime.json`), not the bundled one at `Resources/api_server/.node-runtime.json`. So on a fresh machine the runtime falls through to `/opt/homebrew/bin/node` (commonly v24 ABI 137 on Apple Silicon today) and the spawn fails with NODE_MODULE_VERSION mismatch, surfacing as "Agent server unavailable". **Workaround**: `cd Rhythm.app/Contents/Resources/api_server && /opt/homebrew/bin/node $(dirname /opt/homebrew/bin/node)/npm rebuild better-sqlite3 --build-from-source`. **Proper fix tracked in #615**: Flutter reads the bundled sentinel, validates `nodePath` existence, ABI-matches against installed Node binaries when the install-time one is missing, and surfaces the rebuild command in the error dialog instead of the generic 502.

### Bottom line for the next agent or sprint
- The release is up and working locally.
- **#614 and #615 are the highest-priority follow-ups** — they bite every install until fixed.
- Everything else is iterative UX (composer redesign, permissions, OpenRouter curation, branch selector, etc.) — see the full follow-up list below.

### What PR #598 landed
Everything below is now on `main`, embedded in the `vbeta.18.31` build.

**M1–M5 consolidation** (originally stacked PRs #593–#596 — superseded):
- M1 — projects rail + VCS chip + per-project session filter.
- M2 — `PATCH /agent-sessions/:id` (rename + provider/model override), per-turn `modelOverride` over WS, cancel endpoint.
- M3 — inspector side panel + tool-call cards (now actually rendering inline) + permission card widget (WS pipeline still pending #608).
- M4 — composer attachments + structured-parts WS protocol + commands data source (slash popover deferred #610).
- M5 — settings services (destructive-modal, keybinds, opencode-server-URL).

**Net-new in this PR**:
- Session-list decode fix: client accepts the `{sessions, resumable}` envelope (server has returned this since #580).
- Closed sessions no longer filtered out of the list. Greyed via status chip; hard-deletable via the three-dot menu.
- `DELETE /agent-sessions/:id/hard` endpoint (true row delete + cascade) + per-row trailing menu + confirm dialog.
- Shift-click multi-select on session rows + bulk-delete banner.
- Model picker (`SessionModelPicker`): sub-grouped by provider (Anthropic / OpenAI / Google / GitHub Copilot direct vs Via OpenRouter); check-mark + accent-bold on the active row; pill reflects resolver precedence (turn override > session default > fallback).
- `GET /agents/models?agentId=…` endpoint joining `ROUTE_FALLBACKS_BY_AGENT` with authed providers.
- Expanded model catalog: claude-opus-4-7 / 4-5, sonnet-4-6, haiku-4-5 across anthropic + github-copilot + openrouter; gpt-5.3-codex / 5.3 / mini; gemini-3-pro-preview + flash.
- Agent settings sheet (gear icon on session list header): four sections — Accounts (full `AiAccountSection` moved here from main Settings), Behavior (destructive-modal toggle), Keybindings (4 actions + reset), Opencode server URL.
- AI Accounts section removed from main app Settings.
- Manage Agents view and button removed (file deleted, references cleaned up).
- "OpenCode" agent label renamed to "OpenRouter" via migration — the catch-all kind routes through OpenRouter in practice.
- Projects rail loads from server on mount; new-session dialog cwd defaults to selected project's folder; duplicate-cwd guard rejects with 400.
- Project name auto-derives from picked folder when empty or matches previous basename.
- Folder picker uses `osascript "choose folder"` (file_picker plugin's beginSheetModal was suppressed under the showDialog overlay).
- Icon field accepts long emoji (dropped `maxLength: 7` that was truncating multi-codepoint emoji into U+FFFC).
- Refresh button on session list header (stop-gap for #605).
- Capabilities refetched on new-session dialog open (server's first response often arrives before the SDK boot finishes, so `opencode: false` was cached stale).
- Keybinds + opencode-server-URL persistence: switched from onSubmitted/onEditingComplete to onChanged so closing the sheet without pressing Enter still saves.
- Tool-call cards default to expanded inline so output shows without an extra click.
- `_ChatBubble` now walks parts in order: text → SelectableText spans; tool → `ToolCallPart` cards. Previously it joined every part's text and silently dropped tool parts.
- CI repairs: `vcs_probe.ts` calls `git` directly (no zsh dep, fixes Ubuntu runners); `agents_models_routes.test.ts` count-agnostic shape assertions; duplicate `features/settings/services/*` imports in `main.dart` removed.

### Smoke pass (manual)
Confirmed end-to-end on local build:
1. Session list populates and historical rows visible.
2. Project rail loads + filter narrows correctly.
3. Bulk shift-click + bulk-delete confirm flow.
4. Folder picker + name auto-derive on new project.
5. Cwd defaults to selected project on new session.
6. Send turn through model picker (per-turn + session-default).
7. Session-default model persists across Cmd+Q restart.
8. Closed-session refresh via the new refresh icon.
9. AI Accounts moved into gear → Accounts; removed from main Settings.
10. Tool-call inspector renders bash output inline by default.
11. VCS chip displays current branch.
12. Picker sub-groups (Anthropic / OpenAI / GitHub Copilot / Via OpenRouter).
13. OpenCode label is "OpenRouter" and selectable (not greyed).
14. Manage Agents button gone.
15. Keybinds + Opencode-server-URL persist across restart.

### Known data-layer-only items (functional gap, not regressions)
- M5 **destructive-modal toggle**: no permission flow exists for the SDK's tool calls. The toggle is armed but nothing triggers it — tool calls fire instantly. Tracked in **#608**.
- M5 **Opencode-server-URL switch**: `OpencodeClientService` doesn't consume the persisted URL yet — value persists but the SDK stays on the embedded endpoint. Tracked separately as part of M5 follow-ups.
- M5 **Keybind editing**: persists, but no `Shortcuts`/`Actions` widget tree consumes the values yet — typed shortcuts don't actually fire.

### Open follow-up issues
- **#599** — Per-turn / per-session model picker (closed-by #598).
- **#600** — Agent settings sheet (closed-by #598).
- **#601** — Archive / soft-delete for sessions (separate column + `?includeArchived`).
- **#602** — Composer redesign: relocate model picker to composer area, add file attach, agent-less session start, unified agent selector with Authorized/Connect rows.
- **#603** — Branch selector in new-session dialog (git checkout before session start; dirty-tree UX).
- **#604** — Variant model IDs (1M context, legacy) + reasoning effort + fast-mode.
- **#605** — Server broadcasts `session.updated` / `session.removed` WS events on status / row changes.
- **#606** — Per-message action row (copy, notify on completion, timestamp).
- **#607** — Clickable VCS chip → branch switcher with dirty-tree handling.
- **#608** — Permission flow: surface `permission.asked` WS events + accept/deny endpoints + gate destructive tools.
- **#609** — OpenRouter model curation: browse full catalog in Agent Settings; pick which surface in the in-session picker.
- **#610** — Composer slash-command popover (`CommandsDataSource` already exists, widget never built).
- **#611** — Permission Mode pill in chat sessions (default / acceptEdits / plan / bypassPermissions) — depends on #608.
- **#612** — Docs: project-state snapshot after #598 merge (merged).
- **#613** — Release: bundle `apps/api_server/scripts` into the macOS .app so postinstall can run during the bundling step (merged).
- **#614** — Lifecycle: quitting Rhythm.app must terminate spawned api_server + opencode subprocesses (no orphans). Force-quit safety net on next launch. **High priority — bites every install today.**
- **#615** — `ApiServerService`: read bundled `.node-runtime.json` + ABI-match fallback when the install-time Node is missing. Surface a copy-paste rebuild command in the error dialog. **High priority — same root cause class as #614.**

### Release
- **No Synology release needed.** The api_server in this PR is bundled inside the macOS .app; production Synology server owns only user-facing data (tasks, rhythms, project-templates, messages, facilities, users, claude-triggers) — none of which changed.
- Desktop release `vbeta.18.31` in flight on Actions run 25968794136. Triggered with version `beta.18.31` since the latest stable was `v18.30` and the latest beta was `vbeta.18.29`.

## Prior Status (2026-05-15 — M1–M5 consolidated + UX follow-ups on PR #598)

PR #598 was open at this point; this prior status is preserved for chronology.

### What PR #598 contains
- **M1–M5 merged in**: projects rail + VCS chip (M1), session header PATCH + per-turn override + cancel (M2), inspector + tool-call parts + permission card (M3), composer attachments + commands (M4), settings services + opencode-auth surfaces (M5). Brought in via `git merge origin/m5-settings` after the original `fix-session-list-decode` branch shipped the decode fix off `main`.
- **Session list decode fix**: `agents_data_source.listSessions()` now accepts the `{sessions, resumable}` envelope (server has returned this since #580; client was still casting to `List`).
- **Show closed sessions**: controller stopped filtering `status='closed'`, so historical rows are visible. Greyed by the row status chip; removable via hard-delete.
- **Model picker (#599)**: `GET /agents/models?agentId=…` joins `ROUTE_FALLBACKS_BY_AGENT` with authed providers; rows tagged `routeKind: 'direct' | 'aggregator'`. Picker pill in transcript header shows the **active** model with a check-mark on the matching row when open; sections separate "Direct accounts" vs "Via OpenRouter/Together/Groq". Catalogue expanded to opus-4-7 / opus-4-5 / sonnet-4-6 / haiku-4-5 (claude-code), gpt-5.3 / -codex / -mini (codex), gemini-3-pro / -flash (gemini-cli).
- **Agent settings sheet (#600)**: gear button on Agents header opens dialog with four sections — Accounts (full `AiAccountSection` moved here from main Settings), Behavior (destructive-modal toggle), Keybindings (4 actions + reset), Opencode server URL. Wired in `main.dart`.
- **Hard-delete session**: new `DELETE /agent-sessions/:id/hard` route (true delete + FK cascade). Three-dot trailing menu on each row → "Delete session" with confirm dialog. Distinct from existing soft-close `DELETE /agent-sessions/:id`.
- **Shift-click multi-select + bulk delete**: `_SessionListPanel` is stateful; Shift-click toggles membership in `_multiSelected`; banner at top of list shows "N selected · Cancel · Delete" → confirm dialog → parallel hard-deletes with per-row rollback on failure.
- **Manage agents view removed**: the page, the button on Agents header, the agent-bubble-overlay link, and the source file — all gone.
- **AI Accounts removed from main Settings**: section moved into the gear sheet.
- **Folder picker (osascript)**: the file_picker plugin's `beginSheetModal` was being suppressed under Flutter's showDialog overlay; replaced with `/usr/bin/osascript "choose folder"` for a standalone Finder dialog. Wired in the project create/edit dialog.
- **Auto-derived project name**: picking a folder fills the Name field with the folder's basename if empty or unchanged from the previously-picked basename.
- **Icon field accepts long emoji**: dropped `maxLength: 7` from the project Icon TextField; multi-codepoint emoji no longer truncate to `U+FFFC`.
- **Projects rail loads on mount**: `ProjectsRail` is now stateful and calls `controller.load()` in `initState`, so the rail reflects server state (not just in-session creations).
- **New-session dialog defaults cwd to selected project's folder** when one is active.
- **CI repairs**: `vcs_probe.ts` now calls `git` directly (Ubuntu runners don't ship zsh, which the original `/bin/zsh -lc` wrapper relied on); `agents_models_routes.test.ts` asserts shape rather than length so the expanded catalogue doesn't break it; duplicate `features/settings/services/*` imports in `main.dart` dropped.

### Open follow-up issues (filed during this session)
- [#599](https://github.com/ajhochhalter/Rhythm/issues/599) — Model picker (closed-by #598).
- [#600](https://github.com/ajhochhalter/Rhythm/issues/600) — Agent settings sheet (closed-by #598).
- [#601](https://github.com/ajhochhalter/Rhythm/issues/601) — Archive / soft-delete for sessions (separate column in DB; opt-in `?includeArchived`).
- [#602](https://github.com/ajhochhalter/Rhythm/issues/602) — Composer redesign: relocate model picker to composer area, add file attach, agent-less session start, unified agent selector with Authorized/Connect rows.
- [#603](https://github.com/ajhochhalter/Rhythm/issues/603) — Branch selector in new-session dialog (git checkout before session start; dirty-tree UX).

### Pre-merge state
- CI: latest run on `4b4f7b3` — server tests fix + duplicate-imports fix in flight. Watch [#598 checks](https://github.com/ajhochhalter/Rhythm/pull/598/checks).
- Smoke: see `docs/testing/manual-smoke.md` (predates this work; gap noted — sheet/picker/multi-select/projects rail/hard-delete need explicit smoke steps).
- M2–M5 sibling PRs (#592–#596) remain open but their content lives on this branch; manual merge of #598 effectively supersedes them.
- Manual merge only. No auto-merge.

## Prior Status (2026-05-14 v3 — all five milestones shipped to draft PRs)

🟢 **All five milestones (M1–M5, 25/26 atomic issues) landed across stacked draft PRs in a single power-through session.**

| Milestone | Branch | PR | Status |
|---|---|---|---|
| M1 — Sessions ↔ Projects | `m1-projects` | [#592](https://github.com/ajhochy/Rhythm/pull/592) base=main | 6/6 issues #586–#591, full UI shipped |
| M2 — Session header toolbar | `m2-session-header` | [#593](https://github.com/ajhochy/Rhythm/pull/593) base=m1-projects | Backend + Flutter data layer; visible header UI follow-up |
| M3 — Details / inspector | `m3-inspector` | [#594](https://github.com/ajhochy/Rhythm/pull/594) base=m2-session-header | Widgets + endpoints shipped; agents_view rewrite follow-up |
| M4 — Composer upgrades | `m4-composer` | [#595](https://github.com/ajhochy/Rhythm/pull/595) base=m3-inspector | WS protocol + data sources; popover widgets follow-up |
| M5 — Settings surface | `m5-settings` | [#596](https://github.com/ajhochy/Rhythm/pull/596) base=m4-composer | Persistence services + backend stubs; tab UI + dark-mode audit follow-up |

**Automated checks at every milestone boundary:** `ai-workflow checks --level pr` exited 0 (flutter analyze, dart format, tsc --noEmit, vitest, flutter test 218/218, vitest 38/38 incl. M3-1 tool-call fixture).

**The stacked PR chain is ordered for sequential review:**
1. Review and merge #592 first (smoke the rail, VCS chip, project dialog).
2. Then #593 (PATCH endpoint, cancel, per-turn override — data layer only).
3. Then #594 (tool-call widgets, side panel, permission card — visual integration in a follow-up).
4. Then #595 (composer parts protocol — visible popovers in a follow-up).
5. Then #596 (settings services — tab UI in a follow-up).

### Known UI integration follow-ups (intentional gaps)

This session shipped backend completeness for M2–M5 and Flutter data-layer + scaffold widgets, but **did not** rewrite the live UI surfaces to integrate them. The composable pieces are import-clean and tested where reasonable. Visible follow-ups:

- **M2 session header**: model picker dropdown chip, Stop button on `working` status, token/cost meter, inline rename.
- **M3 chat thread**: hang `SessionSidePanel` off `agents_view`, render `ToolCallPart` inside assistant bubbles when `ChatPart.type == 'tool'`, surface `PermissionCard` for `permission.asked` WS events, wire backend `respondPermission` to the real SDK call.
- **M4 composer**: drag-drop region (needs `desktop_drop` plugin), slash-command popover widget, @-mention fuzzy file finder, file picker.
- **M5 settings**: `SettingsView` left-rail tab scaffold + Providers/Appearance/Keybinds/Servers/About tab widgets. **Full dark-mode token audit across all 11 screens** (Tasks/Projects/Rhythms/WeeklyPlanner/Messages/Facilities/Dashboard/Integrations/Imports/Agents/Settings) — services exist, but per-screen hex-literal flush deferred.
- **M5-1 destructive modal**: `PermissionCard` does not yet read `DestructiveModalService.enabled`; needs a single-line wiring in the consumer when the inline-vs-modal switch is implemented.
- **M5-5 server switching**: `OpencodeClientService` does not yet consume `OpencodeServerService.effectiveUrl`. Restart-on-switch is a follow-up.

### Backend stubs vs. functional endpoints

These endpoints return graceful empty/501 responses until the SDK methods are wired:

- `GET /agent-sessions/:id/diff` → `[]` when `opencodeClient.diffSession` is absent.
- `POST /agent-sessions/:id/permission/:permissionId/{accept,deny}` → 204 no-op when `opencodeClient.respondPermission` is absent.
- `PUT /opencode/providers` → 501 ("edit opencode.json directly") until `opencode_plugin_config.ts` writer lands.
- `GET /opencode/commands` → `[]` until `client.command.list` is wrapped.

### Project-state hygiene

- Local plan/issues match GitHub state (milestone #86, issues #586–#591 closed; M2–M5 implementations posted to PRs without per-issue tickets).
- All 5 branches pushed and tracked; no uncommitted local work outside `auth-strategy-probe.ts` (pre-existing untracked dev script).

## Prior Status (2026-05-14, session-end snapshot — PRE-merge)

🟢 **Agents chat was fully working end-to-end** at PR #574 merge: user bubble right-aligned, assistant streams in place, Enter sends, auto-resume rebinds orphan sessions.

**Routing verification (live, `/opencode/auth/`):** authed providers = `["openrouter","anthropic","openai","github-copilot"]`. Local cred sources = `{"claudeCode":true,"codex":true}`. So:
- `claude-code` → `anthropic / claude-sonnet-4-6` (direct, via `opencode-claude-auth` Keychain bridge)
- `codex` → `openai / gpt-5.3-codex` (direct, via `opencode-openai-codex-auth`)
- `gemini-cli` → `openrouter / google/gemini-3.1-pro-preview-customtools` (Google not signed in)
- `opencode` (bare) → `openrouter / anthropic/claude-sonnet-4.6` (fallback)

Automated checks (last run, post 9b26aa1):
- **417/417 tests** (vitest, api_server) — `agents_ws_e2e.test.ts` has 4 cases (chat→server, server→chat, full round-trip, auto-resume regression)
- **tsc --noEmit** — clean
- **flutter analyze --no-fatal-infos** — clean (info-level findings only)
- **dart format --set-exit-if-changed** — clean
- **flutter test** — 180/180
- `ai-workflow checks --level pr` → exit 0

## Outstanding Issues (must verify before merge)

| # | Issue | Status | Notes |
|---|---|---|---|
| 1 | **Follow-up WS prompts dropped / no chat messages rendered** | **CLOSED** — user smoke-verified the parts-based chat thread renders user + streaming assistant bubbles correctly across all four agent kinds. Full chain in "Opencode Desktop UI port + auto-resume" section below. | — |
| 2 | **Gemini direct route requires Google OAuth, no other path** | UI tile shipped (`f501791`), user has not signed in. | `opencode-gemini-auth` plugin handles the listener on :8085; user clicks "Sign in with Google AI account" → polls /opencode/auth/ until `google` appears. Without it, gemini-cli falls back to `openrouter` which is rate-limited on this account. |
| 3 | **OpenRouter key rate-limited** on the live test account | Not a code issue. | Surfaces as `Error: Key limit exceeded (total limit). Manage it using https://openrouter.ai/settings/keys` via the new error-message extractor. User should top up at https://openrouter.ai/settings/keys or remove openrouter as fallback. |
| 4 | **macOS Keychain prompt on every app launch** | Cached per session, but the OS still prompts the first call after each app restart. User asked for this earlier. | Working as designed — Keychain access requires confirmation each new process. Cache lives inside `CredentialsBridgeService` and only re-prompts on `auth.set` failure within the same process. |
| 5 | **User-input messages not persisted to DB** | Known gap; assistant-only persistence currently. | `agent_session_messages` only contains `role: 'output'` (assistant) and `role: 'system'` (errors). User prompts are sent via WS and never written to the table. If a user reopens an old session they see assistant turns but no preceding user inputs. |
| 6 | **Local SDK type defs hand-maintained** | Risk: drift from `@opencode-ai/sdk` releases. | `apps/api_server/src/@types/opencode-ai-sdk.d.ts` is a hand-written subset. The cast pattern `as unknown as { data?: T; error?: E }` covers the actual runtime shape. After SDK upgrades, re-run `apps/api_server/scripts/auth-strategy-probe.ts` (gitignored) to catch breakage. |
| 7 | **`tasks_controller.test.ts` vitest flake** | Pre-existing, not blocking. | One test ("returns only open tasks (default)") intermittently fails when the full suite runs; passes in isolation. Cross-test pollution. Survives the rework unchanged. |
| 8 | **GitHub Copilot OAuth is custom-implemented** | Working, but tied to an upstream client_id. | We reimplemented the device-flow in `api_server/src/services/github_copilot_device_auth.ts` because the SDK's plugin polling can't be driven over HTTP RPC. Hard-codes GitHub `client_id=Ov23li8tweQw6odWQebz`. If GitHub revokes/rotates that ID, we have to update. |

## Opencode Desktop UI port + auto-resume (2026-05-14, commits d8b929d, 5591d51, a067083, 1fc8768, ef5ea12)

End state: confirmed working in the running app — claude-code, codex, opencode sessions all stream user + assistant bubbles correctly via OpenRouter.

The path to "working" required **five** distinct fixes, in this order. Future agents should treat this section as the canonical record of what these commits actually solve.

1. **Parts-based chat model (d8b929d).** Mirror Opencode Desktop's renderer (`/tmp/opencode-ref/packages/app/src/context/global-sync/event-reducer.ts`): one ChatMessage per session, one ChatPart per message, deltas mutate `part.text` in place. Replaces the old `_LiveOutputBuffer` + `_transcript` split. New WS event types forwarded by the bridge: `message.updated`, `message.part.updated`, `message.part.delta`, `message.removed` — each carries the SDK's `messageID`/`partID` intact so the Flutter reducer can address parts correctly.

2. **End-to-end WS suite (5591d51).** `agents_ws_e2e.test.ts` spins up a real http.Server + ws_gateway + stream bridge with a vi-hoisted SDK event queue. **Caveat:** the original three tests fed event shapes I assumed; one of them (`message.part.delta`) DID match the real SDK, the others use the SDK's actual SSE event union. Always verify mock fixtures against `/tmp/opencode-ref` before trusting the suite.

3. **`opencode` agent OpenRouter fallback + auto-resume (a067083).** Two distinct fixes in `ws_gateway.ts` + `agent_model_resolver.ts`:
   - `agent_model_resolver` now lists `openrouter / anthropic/claude-sonnet-4.6` for the bare `opencode` agent kind. Without this, OpenRouter-only setups got `Routing opencode session ... via <unmapped>` and prompts were silently dropped.
   - `ws_gateway.session.input` now auto-resumes orphan sessions: if `opencodeSessionMap.get(id)` is undefined (post-restart), pull cwd + name from the DB row, create a fresh SDK session, register the mapping, start the stream bridge, then forward the prompt. The user never sees the seam. Regression test in `agents_ws_e2e.test.ts`.

4. **WS connect only after server-ready (1fc8768).** `AgentsController.initialize()` runs at app launch, before the spawned api_server is up — `_agentServerController.isReady` is false, the controller gated out of `_repository.connect()` and never retried. Now it subscribes to `AgentServerController` (a ChangeNotifier) and calls `_tryConnectWs()` on every transition. This was the actual reason no WS frames reached Flutter for the longest time.

5. **Enter-to-send in chat composer + messages reply box (1fc8768 + ef5ea12).** `Focus` + `KeyEvent` handler around each TextField; `Enter` sends, `Shift+Enter` newlines.

## Chat round-trip fix (2026-05-14, commits 3e4df87 + f547a2c)

Diagnosed seam (recorded so future agents don't rediscover it):

- Backend `opencode_stream_bridge.ts` broadcasts deltas as `{type:'output', id, data}` which Flutter routes to `_liveOutputBuffer` (preview only). On `session.idle` it persisted the assistant turn to DB and broadcast `session.status` — **never `transcript.append`** — so the streamed text never finalized into the visible chat transcript.
- Flutter `agents_controller._onWsMessage` had no case for `TranscriptAppendMessage`, `output.flush`, or `error`, so any such frame would have been silently dropped anyway.

Fix applied (3e4df87):
- Bridge emits `{type:'transcript.append', id, role:'output', text}` on `session.idle` after persisting (only when `pendingText` is non-empty and the session has not errored this turn).
- On `session.error` with partial `pendingText`, the bridge flushes a `transcript.append` BEFORE the `error` frame and clears `pendingText` so a follow-up `session.idle` does not re-emit.
- `streamSession` logs an entry line so SSE subscription start is visible.
- Flutter controller handles `TranscriptAppendMessage` (append to `_transcript`, clear `_liveOutputBuffer[id]`) and `WsErrorMessage` (append role:`'system'` entry, clear live buffer). Both scoped to `_selectedSessionId` so background-session frames don't pollute the visible transcript — background transcripts reload on session select.
- `WsErrorMessage` model now carries `id`.

Cleanup (f547a2c): removed pre-existing dead `_hasCodex` field in `ai_account_section.dart` that was blocking `flutter analyze --no-fatal-infos`.

Tests added: `apps/api_server/src/__tests__/opencode_stream_bridge.test.ts` — 3 cases (delta+idle → transcript.append with accumulated text; error after partial delta → transcript.append precedes error; idle with empty buffer → no transcript.append).

Remaining: manual UI smoke. The "split UI" (live preview block + finalized transcript) stays in place until issues #593/#594 collapse it into a parts-based chat thread.

## Recent Commits (31 stacked on opencode-engine-issue-564 since 70b87d7)

### Auth rework — spec phase
| SHA | Topic |
|---|---|
| `af7100e` | docs(spec): opencode auth rework design |

### Issue A — SDK `.data` unwrap (5 commits)
| SHA | Topic |
|---|---|
| `7375953` | unwrap res.data in listProviders |
| `9d3fa2c` | unwrap res.data in listModels |
| `ee7b283` | unwrap res.data in setAuth |
| `c99b821` | unwrap res.data in session methods |
| `7e9dfa4` | unwrap res.data in OAuth methods |

### Issue B — Auth source-of-truth (4 commits)
| SHA | Topic |
|---|---|
| `d29f4b5` | add OpencodeAuthStore (reads ~/.local/share/opencode/auth.json) |
| `e3a590f` | expose listAuthedProviders via auth store |
| `5ecc83a` | capabilities now reads from auth store, not catalog |
| `7199c1a` | GET /opencode/auth/ returns authed providers from auth store |

### Issue C — Anthropic Claude Code creds bridge (4 commits)
| SHA | Topic |
|---|---|
| `4f26be9` | read Claude Code creds from Keychain or file |
| `54cc1dd` | bridgeAnthropic + refresh via claude.ai (correction from `console.anthropic.com`) |
| `b740ea6` | bridge route + sources discovery |
| `9b09f58` | 30-min background refresh loop |

### Issue D — Flutter UI rework (1 commit, bundled D1/D2/D3)
| SHA | Topic |
|---|---|
| `4b2f6a4` | Flutter auth UI rework (subscription tile, polling, capability refresh) |

### Smoke-driven fixes E/F/G + iterations
| SHA | Topic |
|---|---|
| `b9fd5de` | OpenAI OAuth uses methodIndex=1 paste-back |
| `10df29d` | reimplement GitHub Copilot device flow in api_server |
| `1bc44f8` | route agent sessions to preferred provider/model |
| `08c4ada` | route via openrouter + show connected indicators |
| `bde0b91` | smart route fallback + persist session errors |
| `b2eefaa` | prefer github-copilot over openrouter for claude-code |
| `592624b` | persist session status + assistant messages |
| `cd80584` | look up sessionID from info/part for message events |
| `2184fef` | subscribe per-cwd + persist assistant turns |
| `2d51e9c` | readable error messages + don't clobber closed status |
| `928a28b` | route to user's direct provider account, not aggregator |
| `7499416` | auto-install community auth plugins on startup (claude-auth, codex-auth, gemini-auth) |
| `f501791` | Google Gemini OAuth tile + polling completion |
| `40d4fee` | **[verified by code review]** WS gateway passes model to follow-up prompts |
| `3e4df87` | **[chat round-trip]** Bridge emits transcript.append on idle/error; Flutter handles TranscriptAppendMessage + WsErrorMessage |
| `f547a2c` | chore: remove pre-existing unused `_hasCodex` field that was blocking flutter analyze |

## Issues Completed

| # | Description | Commit |
|---|---|---|
| #564 | Install @opencode-ai/sdk + OpencodeClientService | `f13b033` |
| #565 | Init SDK on startup + /opencode/health endpoint | `baaa245` |
| #566 | Replace which-based capabilities with SDK providers | `de0f00b` |
| #567 | Replace PTY subprocess with SDK sessions | `6b797a4` |
| #568 | Opencode SSE stream bridge | `6b797a4` |
| #569 | Auth endpoints (OAuth + API key) | `aacaba0` |
| #570 | Flutter auth UI (Settings + ManageAgentsView) | `2109324` |
| #571 | Remove old PTY transcript, status service, reaper | `71697c6` |
| #572 | Remove .clideck-workflow directory | `8a95360` |
| #573 | Flutter data sources for Opencode engine | `8a95360` |

## Post-Issue Integration Fixes

| Fix | Description | Commit |
|---|---|---|
| WS gateway | Replaced `ptyRunner.sendInput()` with `opencodeClient.prompt()`. Removed all ptyRunner refs | `f152e69` |
| Stream bridge | Rewrote to properly subscribe to Opencode SSE events and map to WS format | `f152e69` |
| Session ID mapping | `opencodeSessionMap` routes local session IDs → SDK session IDs for prompt routing | `f152e69` |
| Auth flow | OAuth opens system browser via `url_launcher`. `GET /opencode/auth/` lists connected providers | `f152e69` |
| Tests | Updated agent_sessions.test.ts to mock opencode_engine instead of pty_runner | `e2a35c7` |

## Settings UI Cleanup (2026-05-13, issues #575–#579)

| # | Fix | Commit |
|---|---|---|
| #575 | Remove CLI command field, "Supports session resume" checkbox, and Configured/Needs-setup badge from Manage Agents cards. Drop unused CLI-era fields from `AgentConfig` (DB schema retained). | `f99fa7d` |
| #576 / #578 / #579 | Surface real OAuth/auth error message instead of generic fallback. Guard `jsonDecode` in `_saveApiKey` against non-JSON (HTML) error bodies. `getOAuthUrl` now returns `{error}` rather than swallowing exceptions. Provider IDs `anthropic` and `github-copilot` confirmed correct against SDK models cache. | `ab79260` |
| #577 | Remove "Claude Code CLI" / "Codex CLI" install rows + Refresh button + "Install Claude Code" banner from Settings AGENT SERVER card. Collapsed to a single "Running on localhost:4001" indicator. | `143f1eb` |

## Resolved Gaps (2026-05-13, branch `opencode-engine-issue-564`, pending merge)

| # | Resolution |
|---|---|
| #580 | `AgentSessionsController.resume()` now creates a new SDK session via `opencodeClient.createSession(name, cwd)`, registers `opencodeSessionMap`, starts the SSE stream bridge, and sets status to `starting`. Resumed sessions do NOT reattach prior SDK conversation history — per #580 scope. |
| #581 | `agent_configs_repository` no longer persists or echoes the five legacy CLI fields (`command`, `canResume`, `resumeCommand`, `sessionIdPattern`, `outputMarker`). DB columns retained for rollback safety. |

## Code Review Fixes (2026-05-13)

| Fix | File | Commit |
|---|---|---|
| Test mock missing `promptAsync` → TypeError → 400 not 201 | `agent_sessions.test.ts` | `55f8bff` |
| `_ready` closure not reset in afterEach → test order poisoning | `agent_sessions.test.ts` | `55f8bff` |
| `subscribed` stuck true when `subscribeToEvents()` returns null | `opencode_stream_bridge.ts` | `55f8bff` |
| `opencodeSessionMap` never cleaned up on session DELETE (memory leak) | `agent_sessions_controller.ts` | `55f8bff` |
| Double `expandHome(cwd.trim())` — redundant re-expansion | `agent_sessions_controller.ts` | `55f8bff` |
| Silent catch blocks with no logging in service methods | `opencode_client_service.ts` | `55f8bff` |
| `_refreshConnectedProviders` called wrong endpoint, never populated state | `ai_account_section.dart` | `55f8bff` |

## Smoke-Found Fixes (2026-05-13, stacked onto `opencode-engine-issue-564`)

| # | Resolution | Commit |
|---|---|---|
| #585 | `apps/api_server/scripts/postinstall.js` force-rebuilds `better-sqlite3` from source against install-time Node and writes `apps/api_server/.node-runtime.json` sentinel. Flutter `_findNode()` reads the sentinel first so the api_server is spawned with the same Node the binary was built against; fallback candidate order now puts `/opt/homebrew/bin/node` ahead of `/usr/local/bin/node`. `engines: ">=20 <25"` pinned. `SKIP_BETTER_SQLITE3_REBUILD=1` escape hatch for CI. | `44fc175` |
| #583 | Settings AI Accounts now collects the OAuth code via a paste-back dialog (matches the SDK's out-of-band flow). After opening the browser we show the SDK's `instructions` field plus a code input, then `GET /opencode/auth/<provider>/callback?code=<pasted>` and refresh the connected-providers list. | `b374279` |
| #584 | `agents_capabilities_routes.ts` introduces `AGGREGATOR_PROVIDERS = ['openrouter', 'together', 'groq']` and extends `agentToProvider` so each CLI agent treats any aggregator as a satisfying provider. Connecting only OpenRouter now flips `claude-code` / `codex` / `gemini-cli` to true. | `b7859ce` |
| #582 | `_NoCLIDetected` → `_NoAgentsAvailable`. Copy rewritten to "Connect a provider in Settings → AI Accounts" with an inline `FilledButton.icon` that pushes `SettingsView` directly. | `5b3c8c4` |

## Known Gaps (tracked, not blocking merge)

| Gap | Detail |
|---|---|
| `pty_runner.ts` dead code | Still present in the repo. No production imports. Tracked in existing [#571](https://github.com/ajhochy/Rhythm/issues/571) (deletion of legacy PTY files). |
| Custom (non-preset) agent configs always show "Unavailable" (#575) | `AgentServerController.isAgentAvailable` keys the capabilities map by preset ID (`claude-code`, `codex`, `gemini-cli`, `opencode`). Custom configs have no entry. Acceptable until users can author custom Opencode providers. |
| Controller-side validation of legacy CLI fields on POST/PATCH | Repository no longer persists or echoes legacy CLI fields (#581 resolved), but `agent_configs_controller` still requires `command` and validates `resumeCommand`/`canResume` on input. Follow-up needed if/when the Flutter client stops sending them. |
| GitHub Copilot OAuth may use device flow (#579) | Current flow assumes redirect URL. The paste-code dialog from #583 will display the SDK's `instructions` field, but a device-flow payload may still need bespoke UX. Self-diagnosing — defer redesign until first user hits it. |
| `tasks_controller` vitest flake | One `GET /tasks` test ("returns only open tasks (default)") intermittently fails when the full vitest suite runs, but passes in isolation and on re-run (367/367 green). Cross-test pollution; not blocking merge. |
| Aggregator API-key registration (#584 follow-up) | Per #584 notes, `opencodeClient.listProviders()` may not surface API-key-only providers in every case. If smoke shows the API-key path doesn't register an aggregator with `listProviders()`, file as a follow-up against `opencode_client_service`. |

## End-to-End Flow
```
Flutter → POST /agent-sessions → controller creates SDK session + stores mapping + starts bridge
Flutter → WS session.input → ws_gateway → opencodeClient.prompt(sdkId, text)
Opencode → SSE events → stream bridge → WS broadcast → Flutter output
Flutter → DELETE /agent-sessions/:id → controller stops bridge + clears map entry + marks closed
```

## Branch / PR
`m1-projects` — branched off clean `main` at `84eef44` (post PR #574 merge). Local-only commit `7ccadbf` adds the M1 issue bodies under `docs/ai/generated-issues/`. M1-1 implementation is on disk, not yet committed.

Historic: `opencode-engine-issue-564` → PR #574 — **MERGED** 2026-05-14.

## Active plan
`docs/ai/current-plan.md` is no longer a placeholder. It contains the full 8-issue UI port plan (Opencode Desktop reference at `github.com/anomalyco/opencode/tree/dev/packages/desktop`). Status of the plan's issues:

- **#590 / #591** (chat round-trip fix) — **DONE** (3e4df87). Manual UI smoke pending.
- **#592** (error path partial flush) — **DONE in 3e4df87** (folded into same commit).
- **#593–#597** (parts-based chat thread, sessions sidebar polish, details panel, model echo in DTO) — not started.

## Issue backlog state (2026-05-14)

All Opencode-implementation issues (#564–#585) are closed. Final disposition:

- **#564–#570, #572, #573, #575–#578, #582, #584, #585** — closed with commit references. Implementation matched the original issue.
- **#571** — closed by ae597b2; `pty_runner.ts` deleted.
- **#581** — closed by ae597b2; controller-side validation of legacy CLI fields removed; route tests updated to assert accept-and-ignore.
- **#579 (GitHub Copilot OAuth)** — closed; different approach taken (device flow in api_server instead of redirect-based OAuth through the SDK plugin).
- **#583 (OAuth callback lands on opencode.ai)** — closed; different approach taken (paste-back dialog in Settings instead of redirect-back to localhost).
- **#580 (resume() implementation)** — closed; scope note: resumed sessions get a fresh SDK session bound to the same local id, do not reattach prior SDK conversation history. DB-persisted assistant messages still render via the legacy transcript REST path.

Open issues remaining (none Opencode-related): #48 (PCO automation rules UX), #71 (mobile MVP scope), #418 (mobile smoke fail), #476 (AgentTriggerWatcher dev-gating).

## M1 — Sessions ↔ Projects (milestone #86)

| # | Issue | Status |
|---|---|---|
| #586 | M1-1 Backend: projects table + CRUD with VCS detection | **Implemented + verified** on `m1-projects`, uncommitted |
| #587 | M1-2 Backend: agent_sessions.project_id FK + per-project listing | Not started |
| #588 | M1-3 Backend: auto-assign project on session create | Not started |
| #589 | M1-4 Flutter: Project model + repository + controller | Not started |
| #590 | M1-5 Flutter: sidebar rail + project panel with VCS chip | Not started |
| #591 | M1-6 Flutter: edit-project dialog | Not started |

### M1-1 (#586) summary

Files added/changed on `m1-projects`:
- `apps/api_server/src/database/migrations.ts` — `CREATE TABLE IF NOT EXISTS projects` + `idx_projects_archived` (additive, idempotent)
- `apps/api_server/src/models/project.ts` (NEW) — `Project`, `CreateProjectDto`, `UpdateProjectDto`
- `apps/api_server/src/services/vcs_probe.ts` (NEW) — `probeVcs(cwd)` via `/bin/zsh -lc` (rev-parse → symbolic-ref → status --porcelain); best-effort, never throws
- `apps/api_server/src/repositories/projects_repository.ts` (NEW)
- `apps/api_server/src/controllers/projects_controller.ts` (NEW) — expandHome, absolute-path rejection (400), trailing-slash normalization, VCS re-probe on cwd change
- `apps/api_server/src/routes/projects_routes.ts` (NEW) — mirrors `agent_sessions_routes` AGENT_LOCAL bypass
- `apps/api_server/src/app.ts` — register `projectsRouter` at `/projects`
- `apps/api_server/src/__tests__/vcs_probe.test.ts` (NEW) — 5 tests (git, non-git, dirty toggle, detached HEAD, mocked spawn failure)
- `apps/api_server/src/__tests__/projects_routes.test.ts` (NEW) — 8 tests (CRUD + archive filter + cwd re-probe + refresh-vcs)

Endpoints: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `POST /projects/:id/refresh-vcs`.

## What to do next (resume notes)

1. **Manual UI smoke** of M1 in particular — rail visible, project create/edit dialog, VCS chip, session filter. PR #592 is the gating change for everything stacked on top.
2. **Merge PRs in order** (`#592 → #593 → #594 → #595 → #596`); each one rebases cleanly because of the stacked branch strategy.
3. **Pick up the UI integration follow-ups** as separate small PRs:
   - Session header chip (M2) — biggest user-facing win.
   - agents_view rewrite to host `SessionSidePanel` + render tool/permission cards inline (M3).
   - Settings tabs scaffold (M5) — unblocks the dark-mode audit.
4. Outstanding non-M1..M5 items still apply: Google AI sign-in for direct gemini routing; OpenRouter rate-limit on test account; plugin requirements doc in CLAUDE.md.
