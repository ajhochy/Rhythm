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
- Branch strategy is **confirmed**: one branch + one PR per milestone (`m1-projects`, `m2-session-header`, `m3-inspector`, `m4-composer`, `m5-settings`), each off a clean `main` after PR #574 merges.

## Milestones

The plan is 5 milestones, **26 atomic issues** total (post-decision revision: M5 grew from 4→5 with the Servers tab). Each milestone is a self-contained shipping unit — if you stop after any milestone the app still works and is better than it was.

| # | Milestone | Issues | Why first | Why last |
|---|---|---|---|---|
| M1 | Sessions ↔ Projects (+ VCS) | 6 | Data-model change everything else inherits | — |
| M2 | Session header toolbar | 5 | Daily-value; dual-mode model switching | Depends on M1 for project context |
| M3 | Details / inspector panel | 6 | Unlocks diff review + tool-call visibility | Depends on backend forwarding more SDK events |
| M4 | Composer upgrades | 4 | Quality-of-life | Depends on file tree from M3 |
| M5 | Settings surface (+ dark mode + Servers) | 5 | Self-contained; can run in parallel with M3/M4 | — |

---

## M1 — Sessions ↔ Projects

**Why first.** Every other milestone (model picker per project, file tree scoped to project, diff review against a project repo, settings for project-specific overrides) assumes a session belongs to a project. Get the data model right once, then everything inherits.

**Reference.** `packages/app/src/pages/layout.tsx` (sidebar rail + panel), `packages/app/src/components/dialog-edit-project.tsx`, `packages/app/src/context/sync.tsx` (project store).

| # | Issue | Likely files | Acceptance | Deps |
|---|---|---|---|---|
| M1-1 | **Backend: `projects` table + CRUD with VCS detection** — id, name, cwd (absolute), icon (emoji/color), vcs_root (nullable), vcs_branch (nullable), vcs_dirty (bool, default false), vcs_checked_at, createdAt, archivedAt. Idempotent migration. VCS probe runs `git rev-parse --show-toplevel` + `git symbolic-ref HEAD` + `git status --porcelain` against the cwd at create/refresh; falls back to NULLs for non-git folders. New endpoint `POST /projects/:id/refresh-vcs` re-probes on demand. | `apps/api_server/src/database/migrations.ts`, new `repositories/projects_repository.ts`, new `controllers/projects_controller.ts`, new `services/vcs_probe.ts`, new `routes/projects_routes.ts`, `app.ts` | vitest CRUD + VCS probe (git repo, non-git folder, dirty tree); migration creates table if missing; GET `/projects` returns list with VCS fields | — |
| M1-2 | **Backend: `agent_sessions.project_id` FK + per-project listing** — nullable column, ALTER TABLE migration. `GET /agent-sessions?projectId=X`. | `migrations.ts`, `agent_sessions_repository.ts`, `agent_sessions_controller.ts` | vitest listActive filters by projectId; existing sessions get NULL project_id and remain visible | M1-1 |
| M1-3 | **Backend: auto-assign project on session create** — if request body omits projectId, look up project whose cwd matches (or is a prefix of) the session cwd; otherwise NULL. | `agent_sessions_controller.ts` | vitest covers prefix-match + no-match → NULL | M1-2 |
| M1-4 | **Flutter: Project model + repository + controller** — mirror existing pattern (model/repo/data-source/controller); model carries `vcsRoot`, `vcsBranch`, `vcsDirty`; ChangeNotifier holds `_projects` + `_selectedProjectId`; exposes `refreshVcs(id)` that calls `POST /projects/:id/refresh-vcs`. | `lib/features/projects/...` (new), `main.dart` MultiProvider entry | unit tests for controller CRUD + select + refreshVcs | M1-1 |
| M1-5 | **Flutter: sidebar rail + project panel with VCS chip** — 64px rail with project icons, click switches `_selectedProjectId`, panel shows sessions for that project (or "All sessions" pseudo-project). Header chip surfaces `branch · dirty?` for the selected project (hidden for non-git). New-session button picks up the rail's cwd by default. | `lib/features/agents/views/agents_view.dart` (replace existing `_SessionListPanel`), new `lib/features/agents/views/_projects_rail.dart`, new `lib/features/agents/views/_project_vcs_chip.dart` | sessions filter by project; switching rail repaints; VCS chip shows branch + dirty dot for git project, nothing for non-git; visual smoke | M1-2, M1-4 |
| M1-6 | **Flutter: edit-project dialog + new-project flow** — name, cwd picker (folder selector), emoji/icon. On save, server auto-probes VCS; dialog shows the detected branch (or "no git") as confirmation before close. | new `lib/features/projects/views/edit_project_dialog.dart`, `agents_view.dart` "+" button | dialog opens, saves, list refreshes; VCS detection result shown inline | M1-4 |

**Validation.** Manual smoke: create a project pointing at `~/Documents/Rhythm` (a git repo) — confirm the branch chip renders and the dirty dot reflects working-tree state. Create a second project at a non-git folder — confirm no chip renders and CRUD still works. Create a session inside each, send a prompt, see the session listed under that project rail icon. Existing sessions without a project show under "All sessions".

---

## M2 — Session header toolbar

**Why this matters.** Mid-session model switching is the single most-requested Opencode Desktop feature missing in Rhythm right now. Cancel-turn, token meter, and inline rename are quick wins that piggy-back on the same header surface.

**Reference.** `packages/app/src/pages/session.tsx` (model picker hookup), `packages/app/src/components/dialog-select-model.tsx`, `packages/ui/src/components/dock-prompt.tsx`.

| # | Issue | Likely files | Acceptance | Deps |
|---|---|---|---|---|
| M2-1 | **Backend: session.update endpoint (session-level default)** — PATCH `/agent-sessions/:id` with `{name?, providerId?, modelId?, agentMode?}`. Validates provider is authed. Persists override columns on `agent_sessions`. | `agent_sessions_controller.ts`, `agent_sessions_repository.ts`, migration if columns missing | vitest covers each field; rejects unknown providers | — |
| M2-2 | **Backend: per-turn model override on `session.input` + session-default routing** — ws_gateway resolves model in this priority: (a) per-turn `modelOverride: {providerId, modelId}` field on the WS `session.input` payload, (b) session's persisted providerId/modelId from M2-1, (c) `resolveModelForAgent` fallback. Per-turn override applies to this prompt only and is **not** persisted. | `ws_gateway.ts`, `agent_model_resolver.ts` (new exported helper) | vitest extensions in `agents_ws_e2e.test.ts` covering all three precedence paths; per-turn override must NOT mutate the session row | M2-1 |
| M2-3 | **Flutter: model picker dropdown in header (dual-mode)** — fetches `/opencode/auth/` for authed providers + `/opencode/models/:provider` for models; dropdown shows provider/model pairs. Two actions per row: **Set as default** (calls PATCH, persists) and **Just this turn** (stages the choice as a transient `modelOverride` consumed by the next `session.input` only). Header chip shows the active default; pending per-turn override renders as a temporary badge cleared after send. | new `lib/features/agents/views/_model_picker.dart`, `agents_view.dart` header row, new data source for models, `agents_controller.dart` (per-turn override staging state) | dropdown loads; "Set as default" persists across restart; "Just this turn" routes one prompt then reverts; visual smoke | M2-1, M2-2 |
| M2-4 | **Flutter: cancel-turn button + session.idle wiring** — show "Stop" when status is `working`, calls `POST /agent-sessions/:id/cancel` which invokes `opencodeClient.cancel(sdkId)`. | `agents_view.dart` header, `agent_sessions_controller.ts` (cancel endpoint), `opencode_client_service.ts` (wrap `client.session.abort`) | working state shows Stop; click ends turn; vitest for endpoint | M2-1 |
| M2-5 | **Flutter: inline rename + token/cost meter** — header title doubles as editable on click; small footer chip shows cumulative `tokens.total` + `cost` aggregated from `message.updated.info` events. | `agents_view.dart` header, `agents_controller.dart` reducer (sum tokens/cost per session) | rename saves; meter ticks on each `message.updated` | M2-1 |

**Validation.** Send a prompt to a claude-code session, **Set as default** to a different OpenRouter model via the dropdown, send another prompt, confirm the new provider/model is logged in `[AgentSessionsController] Routing ... via …` and survives a session reload. Then use **Just this turn** to send one prompt with a third model; confirm only that prompt routes through it and the session reverts to the persisted default for the following prompt. Token meter updates per turn. Cancel works mid-stream.

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
| M3-6 | **Permissions: WS event + inline accept/deny card + deny-on-timeout** — opencode emits `permission.asked` events; bridge already forwards generic events. Wire Flutter to parse them, surface an **inline card** in the chat thread (NOT a modal) with Accept/Deny, send the response via `POST /agent-sessions/:id/permission/:permissionId/{accept,deny}` which calls `client.session.permission.respond`. **Deny-on-timeout** after a configurable window (default 60s) — the card shows a countdown; if the user doesn't respond, the bridge auto-denies and the card collapses to a "Denied (timeout)" stub. A settings toggle (lands in M5-1/M5-3) can elevate destructive tools (`bash`, `write`, `edit`) to a modal instead of inline; M3-6 reads the toggle but defaults to inline-for-everything until M5 ships the toggle UI. | `opencode_stream_bridge.ts` (verify forwarding + auto-deny on timeout), `agent_ws_message.dart` (PermissionAskedMessage), new `lib/features/agents/views/_permission_card.dart`, `agents_view.dart`, `agent_sessions_controller.ts` | manual smoke: trigger a bash tool, see inline permission card, click Accept, command runs; second smoke: ignore the card, after 60s confirm auto-deny stub renders and the SDK receives a deny response | M3-2 |

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

**Architecture.** Settings stays a single `SettingsView` with a left-rail **tab list** (no separate dialogs): `AI Accounts | Providers | Appearance | Keybinds | Servers | About`. Each issue below ships one tab.

| # | Issue | Likely files | Acceptance | Deps |
|---|---|---|---|---|
| M5-1 | **Providers tab — provider/model management UI + destructive-permission modal toggle** — list all providers from `/opencode/auth/` + `/opencode/models/:provider`. Add/remove keys, set default model per provider, mark preferred providers per agent kind. Backed by `agent_model_resolver` overrides table. Also exposes the **"Require modal for destructive tools" toggle** consumed by M3-6 (default off → inline cards for everything). | new `lib/features/settings/widgets/providers_section.dart`, `lib/features/settings/views/settings_view.dart` (tab scaffold), backend overrides table + endpoints, `shared_preferences` key for the modal toggle | add OpenRouter key via UI; default model survives restart; toggling modal flips M3-6 permission card behavior on next event | — |
| M5-2 | **Providers tab — custom provider definitions** — UI for the `opencode.json` `provider` block: id, baseURL, model list. Writes through a new `/opencode/providers` PUT endpoint that updates the SDK config. | `providers_section.dart`, backend new endpoint, `opencode_plugin_config.ts` | add a custom openrouter-compatible provider, send a prompt to it | M5-1 |
| M5-3 | **Appearance tab — full dark mode across every screen + font picker** — add dark-mode token set to `app_theme.dart`, expose system/light/dark toggle. **Token audit pass over every existing screen**: Tasks, Projects, Rhythms, Weekly Planner, Messages, Facilities, Dashboard, Integrations, Imports, Agents, Settings. Each screen must read from `Theme.of(context).colorScheme` (or the new token constants) — no hard-coded hex. Mono font selector (Menlo / SF Mono / JetBrains Mono) for code blocks and chat output. | `lib/app/theme/app_theme.dart`, new `lib/features/settings/widgets/appearance_section.dart`, every `lib/features/*/views/*.dart` that currently hard-codes a color, `shared_preferences` | dark-mode toggle persists across restarts; every screen passes a manual contrast walk in both themes; `flutter analyze` clean | — |
| M5-4 | **Keybinds tab — keybinds editor** — list of in-app shortcuts (send, cancel, new session, switch session, switch project, etc.). Custom assignments stored in shared_preferences and consumed by Shortcuts/Actions wrappers. | new `lib/features/settings/widgets/keybinds_section.dart`, new `lib/app/core/keybinds/keybinds_service.dart`, agents_view.dart wiring | rebind "send" to Cmd+Enter, restart, still works | M2 (so Stop/Cancel can also be bound) |
| M5-5 | **Servers tab — workspace / remote opencode server switching (folds in C-1)** — UI to point Rhythm at a remote opencode server instead of the embedded one. Backend already honors `OPENCODE_BASE_URL`; surface a settings field that writes to a new `opencode_server_url` shared_preferences key, plumb it through `OpencodeClientService` initialization, restart the embedded server when switching back to local. Show connection status (green/red dot + base URL). | new `lib/features/settings/widgets/servers_section.dart`, `apps/api_server/src/services/opencode_client_service.ts`, `lib/app/core/server/agent_server_controller.dart`, `shared_preferences` | switch to a remote URL → next session created hits remote SDK; switch back to local → embedded server resumes | M5-1 (for tab scaffold) |

**Validation.** All flows survive `flutter run` restart. Provider management can register a new OpenRouter key without editing `~/.local/share/opencode/auth.json` by hand. Dark-mode toggle exercises every screen in both themes without hard-coded color regressions. Servers tab roundtrip (local → remote → local) preserves session creation.

---

## Cross-cutting (do whenever convenient)

These are smaller items that don't fit a milestone cleanly but should land before declaring parity:

- **C-1.** ~~Workspace/server switching — UI to point Rhythm at a remote opencode server instead of the embedded one.~~ **Folded into M5-5** (per Q5 decision).
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

## Branch / PR strategy (confirmed)

**One branch + one PR per milestone.** Each PR is 4–6 commits. Naming: `m1-projects`, `m2-session-header`, `m3-inspector`, `m4-composer`, `m5-settings`. Each branched off `main` after the prior milestone's PR merges (M2 off post-M1-merged `main`, etc.).

**Before starting M1: push and merge `opencode-engine-issue-564`** (PR #574 — currently 42 commits, all manual-smoke-verified). M1 should branch from a clean `main`.

## Resolved Questions (2026-05-14)

| # | Question | Decision |
|---|---|---|
| 1 | Project model — cwd vs VCS root | **Absolute cwd + VCS detection in M1.** M1-1 stores `vcs_root`, `vcs_branch`, `vcs_dirty`, `vcs_checked_at`; sidebar surfaces branch/dirty chip from day one. Non-git folders are still valid projects with NULL VCS fields. |
| 2 | Mid-session model switching mechanics | **Both** session-level persist + per-turn override. M2-1 PATCH persists session default; M2-2 ws_gateway honors a per-turn `modelOverride` on `session.input` that does NOT mutate the session row; M2-3 dropdown exposes both as separate actions. |
| 3 | Dark mode scope | **Full dark mode across every screen** in M5-3. Token audit over Tasks, Projects, Rhythms, Weekly Planner, Messages, Facilities, Dashboard, Integrations, Imports, Agents, Settings. |
| 4 | Permission UX modality | **Inline cards default** with **deny-on-timeout** (60s). M5-1 ships a "Require modal for destructive tools" toggle that elevates `bash`/`write`/`edit` to a modal. |
| 5 | Settings architecture | **Tabs inside `SettingsView`** (AI Accounts \| Providers \| Appearance \| Keybinds \| Servers \| About). No separate dialogs. |
| 6 | C-1 workspace switching priority | **Folded into M5 as M5-5 (Servers tab).** Not a separate milestone. |

## Data Safety / Risks

- M1's `agent_sessions.project_id` migration is additive (nullable column); rollback is trivial. The new `projects` table is independent.
- M2's PATCH endpoint can change a session's provider/model — must validate the target provider is authed to prevent silent prompt drops.
- M3-6 (permissions) is the most user-facing risk: an Accept-by-default UX would let an agent run arbitrary `bash` without consent. Default to **deny-on-timeout** if the user doesn't respond within a configurable window.
- M4 file drag-drop must validate file paths stay inside the session's project cwd (or explicitly outside-of-project with a warning) — prevent the agent from being handed `~/.ssh/id_rsa` by accident.
- M5-3 dark mode review must cover all screens, not just Agents — risk of unreadable text in Tasks / Projects / Rhythms if the tokens aren't applied universally.

## Estimated effort (post-decision revision)

- M1: 3–4 sessions (VCS probe adds ~½ session vs original)
- M2: 3 sessions (dual-mode switching adds ~1 session vs original)
- M3: 4–5 sessions
- M4: 3 sessions
- M5: 5–6 sessions (full-screen dark-mode audit + M5-5 Servers tab vs original 3)

Roughly **18–21 focused work sessions** total for full parity. Each milestone is independently shippable.
