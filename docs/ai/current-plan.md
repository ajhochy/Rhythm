# Current Plan — Opencode Desktop UI parity for Rhythm Agents (June 2026)

## Status
Active. Replaces the now-completed chat-round-trip plan (commits d8b929d…ef5ea12; see `project-state.md` for the working-end-state record).

## Goal (one sentence)
Bring Rhythm's Agents surface to feature parity with the Opencode Desktop client — projects, mid-session model switching, details/inspector panel with diffs and tool calls, composer attachments and slash commands, and a real settings surface — so a Rhythm user can do everything an Opencode Desktop user can without leaving the app.

## In Scope
- Sessions ↔ Projects model (projects rail in sidebar; sessions belong to projects; new-session shortcuts per project).
- Session header toolbar (model picker mid-session, agent mode switch, cancel-turn, inline rename, token/cost meter).
- Details / inspector panel on the right (file diffs review tab, permission requests, tool-call timeline with collapsible groups, reasoning sections, terminal panel).
- Composer upgrades (file drag-drop attachments, slash-command popover, image paste, `@`-mentions for files).
- Settings surface (provider/model management, keybinds editor, theme picker, release notes / about).
- Cross-cutting: workspace/server switching, permission auto-respond rules, project file tree.

## Not in Scope (deferred)
- Mobile layout / responsive breakpoints (desktop only for this round).
- Inline code execution in Rhythm's window (open in user's terminal instead).
- Plugin marketplace UI — community plugin install stays in JSON config until parity work hardens.
- Multi-user / collaborative editing within a session.
- Migrating away from `@opencode-ai/sdk` to direct REST.

## Reference (Opencode Desktop)
Local clone at `/tmp/opencode-ref` (repo `anomalyco/opencode`, branch `dev`). Key files we mirror:

| Concern | Reference file |
|---|---|
| Page layout (3-pane) | `packages/app/src/pages/layout.tsx` |
| Session page | `packages/app/src/pages/session.tsx` |
| Message timeline | `packages/app/src/pages/session/message-timeline.tsx` |
| Side panel (details/changes) | `packages/app/src/pages/session/session-side-panel.tsx` |
| Review (diff) tab | `packages/app/src/pages/session/review-tab.tsx` |
| Terminal panel | `packages/app/src/pages/session/terminal-panel.tsx` |
| Composer | `packages/app/src/components/prompt-input/` |
| Slash commands | `packages/app/src/components/prompt-input/submit.ts` |
| Build request parts | `packages/app/src/components/prompt-input/build-request-parts.ts` |
| Message-part rendering | `packages/ui/src/components/message-part.tsx` |
| File tree | `packages/app/src/components/file-tree.tsx` |
| Sync / state | `packages/app/src/context/sync.tsx` |
| Event reducer | `packages/app/src/context/global-sync/event-reducer.ts` |
| Permissions | `packages/app/src/context/permission.tsx` |
| Settings dialogs | `packages/app/src/components/dialog-settings.tsx` + `settings-*.tsx` |

## Constraints
- Flutter desktop is the shipping target. `apps/web/` is reference only.
- Stay on the Opencode SDK we already have wired (no protocol rewrites).
- Each commit should keep `ai-workflow checks --level pr` green.
- Backend changes must include vitest coverage; Flutter changes get widget tests where the surface is non-trivial.
- No production-API coupling — agent work stays on `localhost:4001`.
- The branch strategy (one-PR-per-milestone vs one-mega-PR vs one-branch-per-issue) is an Open Question; default proposal below.

## Milestones

The plan is 5 milestones, ~25 atomic issues total. Each milestone is a self-contained shipping unit — if you stop after any milestone the app still works and is better than it was.

| # | Milestone | Issues | Why first | Why last |
|---|---|---|---|---|
| M1 | Sessions ↔ Projects | 6 | Data-model change everything else inherits | — |
| M2 | Session header toolbar | 5 | Daily-value, small footprint, no new backend events | Depends on M1 for project context |
| M3 | Details / inspector panel | 6 | Unlocks diff review + tool-call visibility | Depends on backend forwarding more SDK events |
| M4 | Composer upgrades | 4 | Quality-of-life | Depends on file tree from M3 |
| M5 | Settings surface | 4 | Self-contained; can run in parallel with M3/M4 | — |

---

## M1 — Sessions ↔ Projects

**Why first.** Every other milestone (model picker per project, file tree scoped to project, diff review against a project repo, settings for project-specific overrides) assumes a session belongs to a project. Get the data model right once, then everything inherits.

**Reference.** `packages/app/src/pages/layout.tsx` (sidebar rail + panel), `packages/app/src/components/dialog-edit-project.tsx`, `packages/app/src/context/sync.tsx` (project store).

| # | Issue | Likely files | Acceptance | Deps |
|---|---|---|---|---|
| M1-1 | **Backend: `projects` table + CRUD** — id, name, cwd (absolute), icon (emoji/color), createdAt, archivedAt. Idempotent migration. | `apps/api_server/src/database/migrations.ts`, new `repositories/projects_repository.ts`, new `controllers/projects_controller.ts`, new `routes/projects_routes.ts`, `app.ts` | vitest CRUD; migration creates table if missing; GET `/projects` returns list | — |
| M1-2 | **Backend: `agent_sessions.project_id` FK + per-project listing** — nullable column, ALTER TABLE migration. `GET /agent-sessions?projectId=X`. | `migrations.ts`, `agent_sessions_repository.ts`, `agent_sessions_controller.ts` | vitest listActive filters by projectId; existing sessions get NULL project_id and remain visible | M1-1 |
| M1-3 | **Backend: auto-assign project on session create** — if request body omits projectId, look up project whose cwd matches (or is a prefix of) the session cwd; otherwise NULL. | `agent_sessions_controller.ts` | vitest covers prefix-match + no-match → NULL | M1-2 |
| M1-4 | **Flutter: Project model + repository + controller** — mirror existing pattern (model/repo/data-source/controller); ChangeNotifier holds `_projects` + `_selectedProjectId`. | `lib/features/projects/...` (new), `main.dart` MultiProvider entry | unit tests for controller CRUD + select | M1-1 |
| M1-5 | **Flutter: sidebar rail + project panel** — 64px rail with project icons, click switches `_selectedProjectId`, panel shows sessions for that project (or "All sessions" pseudo-project). New-session button picks up the rail's cwd by default. | `lib/features/agents/views/agents_view.dart` (replace existing `_SessionListPanel`), new `lib/features/agents/views/_projects_rail.dart` | sessions filter by project; switching rail repaints; visual smoke | M1-2, M1-4 |
| M1-6 | **Flutter: edit-project dialog + new-project flow** — name, cwd picker (folder selector), emoji/icon. | new `lib/features/projects/views/edit_project_dialog.dart`, `agents_view.dart` "+" button | dialog opens, saves, list refreshes | M1-4 |

**Validation.** Manual smoke: create a project pointing at `~/Documents/Rhythm`, create a session inside it, send a prompt, see the session listed under that project rail icon. Existing sessions without a project show under "All sessions".

---

## M2 — Session header toolbar

**Why this matters.** Mid-session model switching is the single most-requested Opencode Desktop feature missing in Rhythm right now. Cancel-turn, token meter, and inline rename are quick wins that piggy-back on the same header surface.

**Reference.** `packages/app/src/pages/session.tsx` (model picker hookup), `packages/app/src/components/dialog-select-model.tsx`, `packages/ui/src/components/dock-prompt.tsx`.

| # | Issue | Likely files | Acceptance | Deps |
|---|---|---|---|---|
| M2-1 | **Backend: session.update endpoint** — PATCH `/agent-sessions/:id` with `{name?, providerId?, modelId?, agentMode?}`. Validates provider is authed. | `agent_sessions_controller.ts`, `agent_sessions_repository.ts`, migration if columns missing | vitest covers each field; rejects unknown providers | — |
| M2-2 | **Backend: forward model override on `session.input`** — when ws_gateway routes a prompt, prefer the session's override providerId/modelId before falling back to `resolveModelForAgent`. | `ws_gateway.ts`, `agent_model_resolver.ts` (new exported helper) | vitest extension in `agents_ws_e2e.test.ts` for the override path | M2-1 |
| M2-3 | **Flutter: model picker dropdown in header** — fetches `/opencode/auth/` for authed providers + `/opencode/models/:provider` for models; dropdown shows provider/model pairs; selecting calls PATCH. | new `lib/features/agents/views/_model_picker.dart`, `agents_view.dart` header row, new data source for models | dropdown loads, switch persists, next prompt routes through new model | M2-1, M2-2 |
| M2-4 | **Flutter: cancel-turn button + session.idle wiring** — show "Stop" when status is `working`, calls `POST /agent-sessions/:id/cancel` which invokes `opencodeClient.cancel(sdkId)`. | `agents_view.dart` header, `agent_sessions_controller.ts` (cancel endpoint), `opencode_client_service.ts` (wrap `client.session.abort`) | working state shows Stop; click ends turn; vitest for endpoint | M2-1 |
| M2-5 | **Flutter: inline rename + token/cost meter** — header title doubles as editable on click; small footer chip shows cumulative `tokens.total` + `cost` aggregated from `message.updated.info` events. | `agents_view.dart` header, `agents_controller.dart` reducer (sum tokens/cost per session) | rename saves; meter ticks on each `message.updated` | M2-1 |

**Validation.** Send a prompt to a claude-code session, switch the model mid-session via the dropdown to a different OpenRouter model, send another prompt, confirm the new provider/model is logged in `[AgentSessionsController] Routing ... via …`. Token meter updates per turn. Cancel works mid-stream.

---

## M3 — Details / inspector panel

**Why this matters.** Today the UI shows chat text only. Opencode's value is in surfacing tool calls (read/write/bash/grep), file diffs, and permission prompts — Rhythm currently throws all of those away. This milestone is the biggest visual transformation.

**Reference.** `packages/app/src/pages/session/session-side-panel.tsx`, `packages/app/src/pages/session/review-tab.tsx`, `packages/ui/src/components/message-part.tsx` (tool call + reasoning rendering), `packages/ui/src/components/diff-changes.tsx`, `packages/app/src/context/permission.tsx`.

| # | Issue | Likely files | Acceptance | Deps |
|---|---|---|---|---|
| M3-1 | **Backend: forward tool-call + reasoning parts verbatim** — `message.part.updated` is already forwarded with the full `part` object; today Flutter only renders `type:'text'`. Verify nothing strips other part types. Add vitest fixture for a real tool-call part shape (`bash`, `read`, `edit`, `write`). | `opencode_stream_bridge.ts`, `agents_ws_e2e.test.ts` | tests assert tool-call parts arrive intact | — |
| M3-2 | **Flutter: extend ChatPart to support tool-call parts** — discriminate by `type`: `text`, `tool` (with `name`, `args`, `output`, `status`), `reasoning`, `step-start`, `step-finish`. Reducer routes `message.part.updated` and `message.part.delta` field-by-field. | `lib/features/agents/models/chat_models.dart`, `agents_controller.dart` | unit tests for each part type | M3-1 |
| M3-3 | **Flutter: tool-call card widget (collapsible)** — header shows tool name + status (pending/ok/error); body shows args + output; "gathering context" group collapses consecutive `read/grep/glob/list` tool calls behind one expander. Mirror `message-part.tsx` PART_MAPPING. | new `lib/features/agents/views/_tool_call_part.dart`, `_chat_bubble.dart` updates | tool calls render inline in assistant bubble; collapsing works; visual smoke | M3-2 |
| M3-4 | **Backend: `GET /agent-sessions/:id/diff`** — wrap `client.session.diff` to return a list of `{path, before, after}`. | `agent_sessions_controller.ts`, `opencode_client_service.ts`, `opencode_engine.ts` | vitest with mocked SDK | — |
| M3-5 | **Flutter: side panel with tabs (Context / Changes / Terminal)** — replaces the empty space below the chat header. "Changes" tab fetches `/agent-sessions/:id/diff` and renders a diff list; "Context" tab shows model, provider, cwd, tokens, cost; "Terminal" shows captured bash output (later milestone, leave a placeholder). | new `lib/features/agents/views/_session_side_panel.dart`, `agents_view.dart` | tabs switch; diff renders for a session that edited files; visual smoke | M3-2, M3-4 |
| M3-6 | **Permissions: WS event + accept/deny UI** — opencode emits `permission.asked` events for bash commands etc.; the bridge already forwards generic events. Wire Flutter to parse them, surface an inline card with Accept/Deny, send the response via `POST /agent-sessions/:id/permission/:permissionId/{accept,deny}` which calls `client.session.permission.respond`. | `opencode_stream_bridge.ts` (verify forwarding), `agent_ws_message.dart` (PermissionAskedMessage), `agents_view.dart`, `agent_sessions_controller.ts` | manual smoke: trigger a bash tool, see permission card, click Accept, command runs | M3-2 |

**Validation.** Run an agent that does file edits (claude-code on a coding task). Verify: tool-call cards render inline; collapsible "gathering context" group hides read-only ops; the Changes tab shows the file diffs; a bash permission prompt surfaces an Accept/Deny card that actually drives the SDK.

---

## M4 — Composer upgrades

**Why this matters.** Today the composer is a plain text field. Opencode's composer accepts file drag-drop, image paste, slash commands, and `@`-mentions — all of which materially change how usable the agent is for coding work.

**Reference.** `packages/app/src/components/prompt-input/` (whole directory), especially `build-request-parts.ts` and the slash-command popover.

| # | Issue | Likely files | Acceptance | Deps |
|---|---|---|---|---|
| M4-1 | **Backend: accept structured parts in `session.input`** — extend the WS schema to allow `parts: [{type:'text'|'file'|'image', ...}]` instead of just `data`. ws_gateway translates to the SDK's `parts` array on `promptAsync`. | `ws_gateway.ts`, `agents_ws_e2e.test.ts` | vitest covers multi-part input; old `{data}` form still works | — |
| M4-2 | **Flutter: file drag-drop into composer** — accept dropped file paths, store as pending attachments above the text field with remove buttons; on send, include as `{type:'file', filePath}` parts. | `lib/features/agents/views/_composer.dart` (extract from agents_view), maybe `desktop_drop` plugin | drag file → chip appears → send → backend logs the part | M4-1 |
| M4-3 | **Flutter: slash-command popover** — typing `/` opens a popup of available commands from `client.command.list`. Selecting inserts the command name. Mirrors Opencode's `command.tsx` context. | new `_composer.dart`, new `lib/features/agents/data/commands_data_source.dart`, backend wraps `client.command.list` if not already exposed | typing `/` shows list; arrow keys + Enter selects; Esc closes | M4-2 |
| M4-4 | **Flutter: `@`-mentions for files** — typing `@` opens a fuzzy-find of project files (from the project's cwd tree). Selecting attaches a file part. | `_composer.dart`, new `lib/features/projects/data/project_files_data_source.dart` | typing `@foo` filters; select inserts file attachment | M4-2, M1 (project context) |

**Validation.** Drop a file onto the composer, see the chip, send a prompt referencing it — confirm the backend log shows a multi-part request body with the file path. Test slash and `@` flows manually.

---

## M5 — Settings surface

**Why this matters.** The current Settings tab handles AI accounts only. Opencode Desktop exposes provider management, keybinds, theme/font, and release notes — all of which Rhythm users currently can't touch.

**Reference.** `packages/app/src/components/dialog-settings.tsx`, `packages/app/src/components/settings-*.tsx`, `packages/app/src/components/dialog-release-notes.tsx`.

| # | Issue | Likely files | Acceptance | Deps |
|---|---|---|---|---|
| M5-1 | **Provider/model management UI** — list all providers from `/opencode/auth/` + `/opencode/models/:provider`. Add/remove keys, set default model per provider, mark preferred providers per agent kind. Backed by `agent_model_resolver` overrides table. | new `lib/features/settings/widgets/providers_section.dart`, backend overrides table + endpoints | add OpenRouter key via UI; default model survives restart | — |
| M5-2 | **Custom provider definitions** — UI for the `opencode.json` `provider` block: id, baseURL, model list. Writes through a new `/opencode/providers` PUT endpoint that updates the SDK config. | `providers_section.dart`, backend new endpoint, `opencode_plugin_config.ts` | add a custom openrouter-compatible provider, send a prompt to it | M5-1 |
| M5-3 | **Theme + font picker** — light is already the only theme; add dark mode token set, expose toggle. Mono font selector (Menlo / SF Mono / JetBrains Mono) for code blocks and chat output. | `lib/app/theme/app_theme.dart`, new `lib/features/settings/widgets/appearance_section.dart`, `shared_preferences` | toggle dark mode persists across restarts | — |
| M5-4 | **Keybinds editor** — list of in-app shortcuts (send, cancel, new session, switch session, etc.). Custom assignments stored in shared_preferences and consumed by Shortcuts/Actions wrappers. | new `lib/features/settings/widgets/keybinds_section.dart`, new `lib/app/core/keybinds/keybinds_service.dart`, agents_view.dart wiring | rebind "send" to Cmd+Enter, restart, still works | M2 (so Stop/Cancel can also be bound) |

**Validation.** All flows survive `flutter run` restart. Provider management can register a new OpenRouter key without editing `~/.local/share/opencode/auth.json` by hand.

---

## Cross-cutting (do whenever convenient)

These are smaller items that don't fit a milestone cleanly but should land before declaring parity:

- **C-1.** Workspace/server switching — UI to point Rhythm at a remote opencode server instead of the embedded one. Backend already supports `OPENCODE_BASE_URL`.
- **C-2.** Permission auto-respond rules — settings to auto-accept e.g. `read`, `glob`, `grep` tool calls.
- **C-3.** Session export — Markdown / JSON download of a session transcript.
- **C-4.** Search across sessions — full-text search in the sidebar panel.
- **C-5.** Pin / favorite sessions.
- **C-6.** Notification preferences — per-event toggle in Settings.

## Validation plan (per-milestone gates)

1. `ai-workflow checks --level pr` exit 0 after every issue.
2. New backend behavior → new vitest in the matching `__tests__/` file. Especially: every new event the bridge forwards needs a fixture in `agents_ws_e2e.test.ts` that mirrors the real SDK shape (no more "mock the contract I wish I had").
3. New Flutter widget → at least a build-and-pump test; if it has interaction, a `tester.tap` test.
4. After each milestone, manual UI smoke against the dev build (`flutter run -d macos`) — checklist in `docs/testing/manual-smoke.md` (extend per milestone).
5. `dart format --set-exit-if-changed` and `flutter analyze --no-fatal-infos` stay clean.

## Branch / PR strategy (proposed)

**Recommendation: one branch per milestone, one PR per milestone.** Each PR is 4–6 commits. Smaller than the current 39-commit monster, large enough to be a coherent reviewable unit. Naming: `m1-projects`, `m2-session-header`, etc. branched off `main` after PR #574 merges.

Alternative: one branch per issue → 25+ PRs, lots of overhead. Reject unless reviewer prefers granular history.
Alternative: one mega-branch for all 25 issues → review nightmare. Reject.

**Before starting M1: push and merge `opencode-engine-issue-564`** (PR #574 — currently 39 commits, all manual-smoke-verified). M1 should branch from a clean `main`.

## Open Questions

1. **Project model — store cwd directly or reference via VCS root?** Opencode Desktop ties projects to VCS roots (it watches `vcs.branch.updated` events). Rhythm has no VCS integration yet. Default proposal: store absolute cwd, treat VCS detection as a follow-up enhancement (display branch name + dirty indicator) inside M3.
2. **Mid-session model switching — does the SDK actually allow it cleanly?** `client.session.message` body accepts a `model` field per prompt, so per-turn switching works. But changing the persisted session model means future prompts use the new one without us repeating it — needs verification against `client.session.update` API.
3. **Dark mode scope.** Rhythm currently has light-only tokens. Dark mode is one issue (M5-3) but touches every existing screen for token review. Is that in scope, or skip dark mode for parity round 1?
4. **Permission UX — modal or inline card?** Opencode Desktop uses inline cards in the chat thread. Inline is less interrupting; modal is harder to miss. Default: inline cards (M3-6), with a settings toggle to make destructive permissions modal (M5).
5. **Settings architecture — keep growing the single `SettingsView`, or split into a dialog matrix like Opencode Desktop?** Opencode has separate dialogs for General / Models / Keybinds / etc. Default proposal: tabs inside `SettingsView`, not separate dialogs.
6. **C-1 (workspace switching) — does it block parity?** A user running the embedded server can't easily test against a remote one. Lower priority than M1–M5; can defer entirely.

## Data Safety / Risks

- M1's `agent_sessions.project_id` migration is additive (nullable column); rollback is trivial. The new `projects` table is independent.
- M2's PATCH endpoint can change a session's provider/model — must validate the target provider is authed to prevent silent prompt drops.
- M3-6 (permissions) is the most user-facing risk: an Accept-by-default UX would let an agent run arbitrary `bash` without consent. Default to **deny-on-timeout** if the user doesn't respond within a configurable window.
- M4 file drag-drop must validate file paths stay inside the session's project cwd (or explicitly outside-of-project with a warning) — prevent the agent from being handed `~/.ssh/id_rsa` by accident.
- M5-3 dark mode review must cover all screens, not just Agents — risk of unreadable text in Tasks / Projects / Rhythms if the tokens aren't applied universally.

## Estimated effort
- M1: 3–4 sessions
- M2: 2 sessions
- M3: 4–5 sessions
- M4: 3 sessions
- M5: 3 sessions

Roughly 15–17 focused work sessions total for full parity. Each milestone is independently shippable.
