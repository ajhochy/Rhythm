# Current Plan — OpenCode parity in the Agents tab (2026-06-12)

## Status

Active. **Replaces** the PR #617 bug-fix sprint plan (completed; preserved in git history).
Planning-only run: this document + `docs/ai/generated-issues/opencode-m*-*.md`.
No implementation in this run. GitHub issues will be created by the orchestrator after review.

## Goal (one sentence)

Bring Rhythm's Agents tab to functional + UI parity with OpenCode v1.14.49's client feature
set, on the existing embedded-SDK architecture, by first eliminating the root causes that
made the previous attempt rot (dual transcript stores, duck-typed SDK access, in-memory
sentinels), then layering rendering parity, session features, and input/config features —
each issue building on the last.

## Architecture decision (locked — do not relitigate)

- `@opencode-ai/sdk` v1.14.49 embedded in-process in `apps/api_server` (opencode server on :4096).
- SSE → WS bridge (`opencode_stream_bridge.ts` → `ws_gateway.ts`) to Flutter.
- Native Flutter UI (consume opencode's server API + reimplement client UI natively).
- PTY is dead (removed in PR #574/#571); `pty_runner.ts` removal is part of M1.
- VERIFIED: the embedded SDK exposes every endpoint needed for the gaps:
  `/session/{id}/diff`, `/revert`, `/unrevert`, `/summarize`, `/todo`, `/fork`, `/share`,
  `/command`, `/message` (list), `/children`, `/permissions/{permissionID}`, `/mcp`,
  `/provider`, `/config`, `/file/status`.

## Root causes of the prior failure (each is explicitly fixed by an M1 issue)

| # | Root cause (postmortem-mined) | Fixed by |
|---|---|---|
| 1 | Dual transcript stores (`_chatMessagesBySession` in-memory parts vs `_transcriptsBySession` SQLite plain text) with two render branches — every reconnect silently downgrades; every feature wired twice | OPC-M1-2, OPC-M1-3 |
| 2 | Duck-typed SDK access (`diffSession` doesn't exist; permission-respond probe; command cast) → silent no-ops | OPC-M1-1 |
| 3 | C2 contract failures — tests asserting injected values production never produces | Validation plan rule 2 (every contract test uses real SDK event/response shapes captured from v1.14.49) |
| 4 | Provider-id vs agent-id conflation papered with duplicated maps | OPC-M1-1 (single server-side mapping, exported constant consumed by capabilities route) |
| 5 | In-memory sentinels (`erroredSessions` 5s setTimeout, `__pending__` rows) leaking across turns | OPC-M1-4 |

## Milestones

Sequencing rule: within a milestone, issues are ordered; an issue may start only when its
dependencies are merged. M1 is strictly serial after the first two (which can parallel).

### M1 — Foundation (fixes root causes; nothing else lands first)

| Order | Issue file | Title | Goal | Likely files | Tests | Depends on |
|---|---|---|---|---|---|---|
| 1 | `opencode-m1-1-typed-sdk-wrappers.md` | Typed SDK wrappers replace all duck-typing | Every SDK call goes through a typed `OpencodeClientService` method that throws loudly on missing SDK surface; fixes the `diffSession` bug class and the silent permission no-op | `apps/api_server/src/services/opencode_client_service.ts`, `@types/opencode-ai-sdk.d.ts`, `controllers/agent_sessions_controller.ts` | vitest | — |
| 2 | `opencode-m1-2-structured-parts-persistence.md` | Persist structured messages/parts server-side | Single durable source of truth: stream bridge writes full part-typed message rows; REST returns them | `apps/api_server/src/database/migrations.ts`, `repositories/agent_session_messages_repository.ts`, `services/opencode_stream_bridge.ts`, `controllers/agent_sessions_controller.ts` | vitest | — |
| 3 | `opencode-m1-3-flutter-rehydration-single-path.md` | Flutter rehydrates parts from REST; legacy plain-text path deleted; **mini-bubble overlay deleted** | One render path (main view only — bubble removed per user decision 2026-06-12); reconnect/restart no longer downgrades; stuck-detection uses parts state; trigger flow surfaces via Agents tab + notification | `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`, `views/agents_view.dart`, `app/core/agents/agent_bubble_overlay.dart` (delete), `overlay_controller.dart`, `agent_trigger_watcher.dart`, `features/agents/data/*` | flutter test | M1-2 |
| 4 | `opencode-m1-4-stream-sentinel-cleanup.md` | Stream lifecycle + sentinel cleanup, dead code removal | Real `stopStream`, no time-based sentinels, `pty_runner.ts` deleted | `apps/api_server/src/services/opencode_stream_bridge.ts`, `controllers/agent_sessions_controller.ts`, `services/pty_runner.ts` (delete), `agents_controller.dart` | vitest + flutter test | M1-3 |
| 5 | `opencode-m1-5-resume-continuity.md` | Resume with real conversation continuity | `resume()` re-attaches to the persisted SDK session id and rehydrates; no more fresh-session amnesia | `apps/api_server/src/controllers/agent_sessions_controller.ts`, `services/opencode_engine.ts`, `migrations.ts` (persist sdk session id), `agents_controller.dart` | vitest + flutter test | M1-2, M1-3 |

### M2 — Rendering parity

| Order | Issue file | Title | Goal | Likely files | Tests | Depends on |
|---|---|---|---|---|---|---|
| 6 | `opencode-m2-1-markdown-rendering.md` | Markdown rendering in chat bubbles | Assistant text parts render as markdown (code blocks, lists, links), selectable | `agents_view.dart`, new `views/_markdown_message_body.dart`, `pubspec.yaml` | flutter test | M1-3 |
| 7 | `opencode-m2-2-reasoning-block-and-delta-fix.md` | Reasoning collapsible block + non-text delta fix | `_appendChatDelta` routes deltas by part field; reasoning renders as a collapsed "Thinking…" block | `agents_controller.dart` (≈line 1322), `agents_view.dart` (≈line 1881) | flutter test | M1-3 |
| 8 | `opencode-m2-3-tool-specific-renderers.md` | Tool-specific renderers | edit/write→unified diff widget, bash→terminal-style output, todowrite→checklist, task→child-session chip; generic card stays the fallback | `agents_view.dart`, new `views/_tool_renderers/*.dart`, new `views/_unified_diff_view.dart` | flutter test | M2-1 |
| 9 | `opencode-m2-4-retry-status-tokens-cost.md` | Retry surfacing + token/cost display | Retry parts shown inline; per-message token/cost; session totals in sidebar/header | `opencode_stream_bridge.ts`, `agents_controller.dart`, `agents_view.dart`, message model | vitest + flutter test | M1-2, M1-3 |

### M3 — Session features

| Order | Issue file | Title | Goal | Likely files | Tests | Depends on |
|---|---|---|---|---|---|---|
| 10 | `opencode-m3-1-changes-tab-real-diff.md` | Changes tab via real GET /session/{id}/diff | Fix the always-empty Changes tab using the typed diff wrapper | `agent_sessions_controller.ts` (362-383), `opencode_client_service.ts`, `agents_view.dart`, `agents_controller.dart` | vitest + flutter test | M1-1, M2-3 |
| 11 | `opencode-m3-2-revert-unrevert.md` | Undo: revert/unrevert UI | Per-message revert affordance + session-level unrevert, with confirmation | `opencode_client_service.ts`, `agent_sessions_controller.ts`, `agents_view.dart`, `agents_controller.dart` | vitest + flutter test | M3-1 |
| 12 | `opencode-m3-3-compaction-summarize.md` | Compaction (summarize) with UI affordance | Manual "Compact session" action + compaction part rendering + context-usage hint | `opencode_client_service.ts`, `agent_sessions_controller.ts`, `agents_view.dart` | vitest + flutter test | M1-1, M1-3 |
| 13 | `opencode-m3-4-structured-command-dispatch.md` | Slash commands via POST /session/{id}/command | Popover selection dispatches the structured command endpoint instead of text-prefix injection | `opencode_client_service.ts`, `ws_gateway.ts` or REST route, `views/_slash_command_popover.dart`, `agents_controller.dart` | vitest + flutter test | M1-1 |
| 14 | `opencode-m3-5-todo-panel.md` | Session todo panel | Live todo list (todo.updated events + GET /session/{id}/todo) in a collapsible side panel | `opencode_stream_bridge.ts`, `agent_sessions_controller.ts`, `agents_view.dart`, `agents_controller.dart` | vitest + flutter test | M1-2, M2-3 |
| 15 | `opencode-m3-6-subagent-child-sessions.md` | Subagent child-session navigation | task tool chip opens the child session's transcript (GET /session/{id}/children); breadcrumb back to parent | `agent_sessions_controller.ts`, `opencode_client_service.ts`, `agents_controller.dart`, `agents_view.dart` | vitest + flutter test | M2-3 |

### M4 — Input & config

| Order | Issue file | Title | Goal | Likely files | Tests | Depends on |
|---|---|---|---|---|---|---|
| 16 | `opencode-m4-1-real-file-attachments.md` | Real image/file attachments (FilePart) | Paperclip sends FilePart with data URI (bytes), not "[image] /path" text; thumbnails in transcript | `agents_controller.dart`, `agents_view.dart`, `ws_gateway.ts`, `opencode_client_service.ts` | vitest + flutter test | M1-3 |
| 17 | `opencode-m4-2-session-fork.md` | Session fork | Fork from a message → new session appears in list with copied transcript | `opencode_client_service.ts`, `agent_sessions_controller.ts`, `agents_controller.dart`, `agents_view.dart` | vitest + flutter test | M1-5 |
| 18 | `opencode-m4-3-mcp-config-ui.md` | MCP server management UI | Settings section: list/connect/disconnect MCP servers via SDK /mcp | `opencode_client_service.ts`, new `routes/opencode_mcp_routes.ts`, `features/settings/widgets/mcp_section.dart` (new) | vitest + flutter test | M1-1 |
| 19 | `opencode-m4-4-custom-agent-selection.md` | Custom agent/mode selection | If SDK config exposes custom agents, surface an agent picker per session; otherwise ship the documented built-in set only | `opencode_client_service.ts`, `agents_capabilities_routes.ts`, `agents_view.dart`, `agents_controller.dart` | vitest + flutter test | M1-1 |

## Explicitly out of scope (with justification)

| Feature | Why excluded |
|---|---|
| Share server (`/session/{id}/share`) | Publishes session content to opencode's public share infrastructure — church staff sessions can contain congregant PII and internal data. Recommend shipping with share **disabled**; revisit only if a self-hosted share target exists. |
| Themes / keybinds | Rhythm has its own design system (`RhythmColorRoles` tokens) and macOS conventions (`KeybindsService`). Porting OpenCode's TUI theming would fork the design system for one tab. |
| LSP / formatter status | TUI affordance for a code-editing terminal context; Rhythm sessions run against task cwds, not an open editor. No UI surface where this earns its complexity. |
| PTY terminal pane | PTY architecture removed in PR #574; reintroducing a terminal contradicts the locked decision. Bash tool output gets terminal-style *rendering* (M2-3) instead. |
| TUI remote-control routes | Drive opencode's own TUI — meaningless when the client is native Flutter. |
| Workspaces / worktrees | Rhythm sessions are keyed to a single cwd per session; worktree management is a power-developer feature with no church-staff use case. Fork (M4-2) covers the "try a variant" need. |

## Validation plan

1. Every issue gets a contract (`docs/ai/contracts/issue-N.json` per `docs/contract-schema.md`)
   via `acceptance-contract` before coding; red-proven before implementation, green after.
2. **Real-shape rule (root cause 3):** contract tests must use SDK event/response shapes
   captured from v1.14.49 (real provider ids like `anthropic`/`openai`, real part-type unions),
   never invented values. Mocks of class methods must preserve `this`-binding semantics.
3. `ai-workflow checks --level pr` exits 0 per issue (flutter analyze, dart format, tsc, vitest);
   full `flutter test` green.
4. Server↔SDK plumbing: at least one vitest asserting the SDK spy is invoked with the expected
   shape (`spy.mock.calls` inspection). Flutter UI: at least one widget test exercising the
   user-visible path.
5. Milestone-end manual smoke against `flutter run -d macos` (packaged-DMG smoke at M2 and M4
   boundaries, since reconnect/restart behavior — the M1 deliverable — only fully manifests
   across real app restarts).
6. Manual merge only; PR per milestone-cluster or per issue at orchestrator's discretion.

## Branch / PR strategy

- One branch per issue (`opc-m1-1-typed-sdk-wrappers`, …) off `main`; PR per issue, sequenced.
- M1 must fully merge before M2 starts — every M2+ issue assumes the single transcript path.
- M3 issues 10/12/13 and M4 issues 16/18/19 are parallelizable once their deps merge.

## Estimated effort

- M1: 5 issues, the heart of the work — **4-6 sessions** (M1-2/M1-3 are the big ones).
- M2: 4 issues — **3-4 sessions** (tool renderers are the most UI work).
- M3: 6 issues — **4-5 sessions**.
- M4: 4 issues — **3-4 sessions**.
- Total: **~14-19 focused sessions**, re-smoke baked in at milestone boundaries.

## Open questions — resolutions (user, 2026-06-12)

1. **Parts storage shape (M1-2): RESOLVED** — `parts_json TEXT` column on
   `agent_session_messages` (one row per message, parts as a JSON array). No normalized table.
2. **Markdown package (M2-1): RESOLVED** — `gpt_markdown` (streaming-delta-friendly).
3. **Mini-bubble scope (M1-3): RESOLVED** — **delete the mini-bubble overlay entirely**
   ("good idea, but doesn't really seem that helpful"). M1-3 deletes `agent_bubble_overlay.dart`
   + wiring; the trigger flow surfaces via the Agents tab list + existing desktop notification.
   No replacement surface designed in M1-3 — follow-up issue if it feels under-surfaced.
4. **Cost display (M2-4): RESOLVED** — keep dollars on (cost primary, token breakdown in
   tooltip), as planned.
5. **Custom agents (M4-4): OPEN** — awaiting user decision after explanation of what OpenCode
   custom agents are and what the no-authoring-UI scope means.
6. **Vague-criteria flags:** "terminal-style output" (M2-3) and "renders as markdown" (M2-1)
   were pinned to concrete testable assertions in the issue files; review during PR/issue read.
