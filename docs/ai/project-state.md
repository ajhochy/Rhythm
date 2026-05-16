# Project State

## Current Status (2026-05-16 evening — vbeta.18.31 shipped; install-time gotchas filed)

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
