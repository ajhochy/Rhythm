# Current Plan — Rhythm Agents UI ↔ Opencode Server (May 2026)

## Status
Active. Replaces the previous "no active plan" placeholder. Stacks on `opencode-engine-issue-564` (29 unpushed commits, draft PR #574).

## Goal (one sentence)
Make the Rhythm Flutter Agents page reliably round-trip chat messages with the local opencode server — visible assistant output in the chat window after every user prompt — and mirror Opencode Desktop's UX (single in-place transcript with parts, sessions sidebar, details panel) so future agent features inherit a proven UI pattern.

## In Scope
- Diagnose and fix why assistant messages do not render in the chat window after a prompt is sent.
- Restructure the Flutter Agents view to mirror Opencode Desktop's "message thread with parts" model (in-place delta updates, tool-call rendering, role-styled bubbles).
- Wire the existing stream-bridge events (`output`, `output.flush`, `session.status`, `error`) into the new message-thread state.
- Smoke-test the full path via OpenRouter (the only provider the user can hit right now).
- Sessions sidebar polish (timestamps, agent badge, current-session highlight).

## Non-Goals (deferred)
- OAuth flows for Codex and Anthropic direct providers (low priority per user; OpenRouter is the test path).
- Persisting user-input messages to DB (Outstanding Issue #5 in project-state — separate follow-up).
- Mid-session model switcher (nice-to-have, not blocking).
- Markdown rendering inside message bubbles (separate polish issue once wiring is solid).
- Production-grade error-recovery UI beyond a simple error banner per session.

## Constraints
- Must stack onto `opencode-engine-issue-564`; the auth rework already lives here and the user's smoke test environment is set up against it.
- The user wants extensive research before any code edit — this plan is the research output.
- Flutter desktop is the shipping client (`apps/desktop_flutter/`). The Electron/React directories are reference only and are NOT a port target.
- `flutter analyze --no-fatal-infos`, `dart format --set-exit-if-changed`, `tsc --noEmit`, and `vitest` must remain green.
- Local agent server stays on `localhost:4001`; production API stays on `https://api.vcrcapps.com`. No coupling.

## Diagnosis — Why Messages Don't Render Right Now

Cite-evidence first; speculation second.

### What the backend already does correctly
1. `ws_gateway.ts:85–135` correctly resolves model+cwd for follow-up prompts (commit `40d4fee`). **Verified correct.** That bug is closed at the code level.
2. `opencode_stream_bridge.ts:221–239` broadcasts every `message.part.delta` to all WS clients as `{type: 'output', id: localSessionId, data: part.delta, replay: false}`. Delta data is on the wire.
3. `opencode_stream_bridge.ts:283–319` on `session.idle` persists the accumulated assistant message to the `agent_session_messages` table and broadcasts `{type: 'session.status', id, status: 'idle'}`.
4. `agent_model_resolver.ts:20–52` falls through correctly for the OpenRouter-only auth case (`claude-code` → `openrouter / anthropic/claude-sonnet-4.6`).

### Where the round-trip breaks (both sides — confirmed by reading the code)
**Backend broadcasts**: `event`, `output`, `output.flush`, `session.status`, `session.created`, `error`. **Never `transcript.append`** (confirmed: `grep "type:" opencode_stream_bridge.ts`).
**Flutter `_onWsMessage` handles**: `SessionsList`, `SessionCreated`, `SessionClosed`, `SessionStatus`, `Output`, `TriggerFired`, `NotificationPush`. **No case for `TranscriptAppendMessage`, `output.flush`, or `error`** (`agents_controller.dart:347–415`).
**OutputMessage routing**: appended to `_liveOutputBuffer[id]` (line 383–388), never to `_transcript`. The view does render `_LiveOutputBlock` when the buffer is non-empty (`agents_view.dart:914`), so *if* deltas flow the user sees streaming text — but it never finalizes into a chat message, and nothing clears the live buffer on idle.

Secondary risk: if deltas don't flow at all (SSE subscription race or cwd filter mismatch in `streamSession()`), the user sees nothing — matching the report exactly. Issue #590 will instrument and confirm which case. Evidence:

- `agents_controller.dart:347+` `_onWsMessage` — `OutputMessage` case appends to `_liveOutputBuffer`, not to `_transcript`. Only `TranscriptAppendMessage` is appended to `_transcript`.
- Searches in `opencode_stream_bridge.ts` show `broadcast({type: 'output', ...})` for delta chunks (line 221–239) but no `broadcast({type: 'transcript.append', ...})` during the LLM turn.
- On `session.idle` (line 283–319) the bridge persists the message to DB and emits `session.status` — but does **not** emit a `transcript.append` to flush the accumulated content into the Flutter transcript model.

The result for the user: tokens may flow into a hidden/empty "live output block" widget but never appear as a finalized assistant message in the chat. If the live-output widget is conditionally rendered (or its scroll viewport is empty when no working session is selected), the user sees nothing. Even when the live block does render, the message vanishes after `session.idle` because nothing moves the buffer into the transcript.

This is an **architectural seam**, not a one-line bug. Two valid fixes:
- **A. Minimal**: emit `transcript.append` from the stream bridge on `session.idle` (and clear the live buffer); leaves the "live block" widget as a streaming preview.
- **B. Architectural (recommended)**: collapse the live-output buffer into the transcript itself — represent in-progress assistant messages as a transcript entry whose `text` field grows as deltas arrive, mirroring Opencode Desktop's "parts that mutate" pattern. Removes the split entirely.

Recommendation: **B**, because the user explicitly asked to base our UI on Opencode Desktop's, and the Opencode model is a single message thread with parts. The minimal fix would entrench an awkward UI that we'd have to undo anyway.

### Secondary risks identified during research
- **Race condition** (`opencode_stream_bridge.ts:streamSession` fire-and-forget at `agent_sessions_controller.ts:117–124`): if the WS client connects *after* the SSE subscription emits its first events, those events may not be broadcast back. SSE replay is enabled, so likely benign — but verify during smoke.
- **Reverse session ID lookup is O(n)** (`opencode_stream_bridge.ts:175–184`). Fine for a handful of concurrent sessions; flag for follow-up if session count grows.
- **`session.idle` may not fire on session.error** — the stream bridge `session.error` path marks the session in `errorSessions` and broadcasts `error`, but the accumulated `pendingText` is never flushed. User sees neither the partial message nor a useful "what happened" surface.

## Prior Art — Opencode Desktop Reference (confirmed)

Source: `https://github.com/anomalyco/opencode/tree/dev/packages/desktop` + shared code in `packages/app/`.

- **Stack:** Electron + Solid.js + TypeScript + Vite + Tailwind.
- **Transport (to canonical opencode REST API):** `GET/POST /api/v1/sessions/{id}/messages`, `GET /api/v1/sessions/{id}`, `PATCH /api/v1/sessions/{id}`, `GET /api/v1/sessions`. Streaming: server emits `message.part.delta` events that the client applies via `session.optimistic.add(messageID, partIndex, delta)`. Our Rhythm backend wraps the same protocol via `@opencode-ai/sdk` and re-broadcasts deltas over our own WS.
- **Layout (desktop):** 3-pane — sidebar rail (64px: projects/sessions/workspace/settings) + sidebar panel (244–300px resizable: session details / project tree) + main pane (`MessageTimeline` + bottom `Composer`).
- **Data model:**
  ```ts
  interface Message { id; sessionID; role: 'user'|'assistant'; parts: Part[]; createdAt }
  interface Part { type: 'text'|'tool_call'|'tool_result'|'reasoning'; text?; toolID?; input?; output?; delta? }
  ```
- **Key component files we'll mirror in Flutter:**
  - `packages/app/src/pages/session.tsx` — top-level session page (MessageTimeline + SessionSidePanel + TerminalPanel)
  - `packages/app/src/pages/layout.tsx` — 3-column app shell
  - `packages/ui/src/components/message-part.tsx` — `PART_MAPPING` dynamic renderer per part type (text / tool_call / tool_result / reasoning)
  - `packages/ui/src/components/message-nav.tsx` — message list with compact/normal modes, keyboard nav
  - `packages/app/src/components/prompt-input/` — composer (text, file drag-drop, slash commands, `usePrompt`)
  - `packages/app/src/components/prompt-input/build-request-parts.ts` — builds `{model, providerID, parts:[{type:'text', text}, ...]}`
  - `packages/app/src/context/sync.tsx` — API client + optimistic delta application
- **Delta handling pattern (the part we're missing):**
  ```ts
  // on message.part.delta
  optimisticMessage.parts[partIndex].text += deltaChunk;
  // Solid.js reactivity re-renders the same bubble in place
  ```
  No separate "live output" widget. Deltas mutate the active assistant message bubble; on stream end the bubble is just a finalized message.

## UI Port Mapping (target Flutter files)

| Opencode Desktop element | Target Flutter file | Data source / state |
|---|---|---|
| Sessions sidebar (chat list w/ timestamps + agent badge + active-state) | `apps/desktop_flutter/lib/features/agents/views/_session_list_panel.dart` (extract from `agents_view.dart`) | `AgentsController.sessions` / `resumable` / `selectedSessionId` |
| Chat thread (message list, in-place delta mutation, parts) | `apps/desktop_flutter/lib/features/agents/views/agent_chat_thread.dart` (new) | New `AgentChatController` exposing `List<ChatMessage>` where each message has `List<MessagePart>`; deltas mutate the last assistant message's last part |
| Message bubble (user vs assistant; renders parts) | `apps/desktop_flutter/lib/features/agents/views/_message_bubble.dart` (new) | `ChatMessage` model |
| Tool-call card (collapsible, shows name/args/output) | `apps/desktop_flutter/lib/features/agents/views/_tool_call_part.dart` (new) | `MessagePart.toolCall` variant — render placeholder for now if backend doesn't emit yet |
| Send box / composer | `apps/desktop_flutter/lib/features/agents/views/_composer.dart` (extract from `agents_view.dart`) | Calls `AgentsController.sendInput()` (existing) |
| Details / inspector panel (right side: model, cwd, session id, raw event log toggle) | `apps/desktop_flutter/lib/features/agents/views/_session_details_panel.dart` (new) | `AgentSession` + new "raw events" debug stream from `AgentsRepository` |
| Status bar (thinking / idle / error chips) | `apps/desktop_flutter/lib/features/agents/views/_status_bar.dart` (new) | `_working[id]` + last `error` per session |
| Provider/model picker (header) | Defer — for now show resolved provider/model read-only in details panel | `agent_model_resolver` echoes back into session response (small backend change) |

New models:
- `apps/desktop_flutter/lib/features/agents/models/chat_message.dart` — `id`, `role` (`user`/`assistant`/`system`/`tool`), `parts`, `createdAt`, `status` (`streaming`/`complete`/`error`)
- `apps/desktop_flutter/lib/features/agents/models/message_part.dart` — sealed union: `TextPart(text)`, `ToolCallPart(name, args, output)`, `ErrorPart(message)`
- New controller: `AgentChatController` (separate from `AgentsController`, scoped to a single selected session) so the thread can rebuild independently of the session list.

## Issue Table

Issues are stacked on `opencode-engine-issue-564`. Each one should land as its own commit (or small commit cluster) on the same branch. Order matters.

| Order | Title | Goal | Likely files | Tests / evaluation | Dependencies |
|---|---|---|---|---|---|
| 1 | **#590 — Diagnose & confirm the missing-render seam (no code)** | Add temporary `console.log` / `print` instrumentation on both sides, run an OpenRouter smoke prompt, capture the WS traffic, and prove the diagnosis above. Output: a short note in `docs/ai/decisions.md` confirming the seam. No production code changes. | `opencode_stream_bridge.ts` (temp logs), `agents_controller.dart` (temp prints) | Manual smoke: send one prompt, observe WS frames + Flutter state. Revert temp logs before commit. | none |
| 2 | **#591 — Backend: emit `transcript.append` on `session.idle` with the accumulated message** | Smallest correct fix: when the stream bridge persists an assistant message on idle, also `broadcast({type:'transcript.append', id, role:'output', text: accumulated})` so the existing Flutter code path renders it. Unblocks the user while UI rework is in progress. | `apps/api_server/src/services/opencode_stream_bridge.ts` | New vitest: assert `broadcast` called with `transcript.append` after a synthetic `session.idle` event. Manual smoke: assistant message appears in transcript after each turn. | #590 |
| 3 | **#592 — Backend: surface partial output + error message when `session.error` fires mid-turn** | When `session.error` arrives, flush whatever's in `pendingText` as a `transcript.append` (role: `output`, marked partial), then broadcast a separate `error` frame with the extracted message. Today partial output is lost and the user sees nothing. | `opencode_stream_bridge.ts` (`session.error` case ≈ line 332+) | vitest: simulate error mid-stream, assert both the partial text frame and the error frame are broadcast. | #591 |
| 4 | **#593 — Flutter: introduce `ChatMessage` / `MessagePart` models + `AgentChatController`** | New types and a per-session chat controller. Does NOT yet replace `_TranscriptPanel` — runs alongside it. Bridges existing `OutputMessage` deltas and `TranscriptAppendMessage` into the new model. | `lib/features/agents/models/chat_message.dart` (new), `models/message_part.dart` (new), `controllers/agent_chat_controller.dart` (new) | Unit tests for delta accumulation (`AgentChatController.applyDelta` produces an updating last-part). | #591 (proves data path) |
| 5 | **#594 — Flutter: replace `_TranscriptPanel` + `_LiveOutputBlock` with the new chat thread widget** | The visible UI swap. Wire `AgentChatController` into a new `agent_chat_thread.dart`, extract composer + status bar. Delete the live-output block. | `lib/features/agents/views/agents_view.dart` (slim down), `agent_chat_thread.dart` (new), `_composer.dart` (new), `_status_bar.dart` (new), `_message_bubble.dart` (new) | `flutter analyze` clean. Manual smoke: open session, send prompt via OpenRouter, watch assistant text stream into a single message bubble that finalizes on idle. | #593 |
| 6 | **#595 — Flutter: extract sessions sidebar + add timestamps / agent badge / active-state** | Cosmetic but informative. Pull the session-list rendering out of `agents_view.dart` into its own file, add `createdAt` timestamp display, highlight the active session, group active vs resumable with clearer headers. | `agents_view.dart`, `_session_list_panel.dart` (new) | `flutter analyze` clean. Visual smoke. | #594 |
| 7 | **#596 — Flutter: details/inspector panel (right side)** | New right-hand panel showing session id, agent kind, resolved provider/model, cwd, and a togglable raw-event log (read from a new `rawEventsStream` in `AgentsRepository`). Adds debugging value during smoke. | `_session_details_panel.dart` (new), `agents_repository.dart` (expose raw stream), `agents_data_source.dart` (tap into incoming JSON before `parse`) | `flutter analyze`. Manual: select session, panel populates; toggle raw log, see frames live. | #595 |
| 8 | **#597 — Backend: echo resolved `providerID`/`modelID` in session create response** | Small DTO change so the details panel can render the active route. | `agent_sessions_controller.ts`, `dtos/agent_session.ts`, Flutter `AgentSession` model | vitest update for response shape. Flutter model update. | #596 |

Total: 8 issues. Issues #591 and #592 (backend) can land first to unblock smoke; the Flutter UI work (#593–#597) stacks on top.

## Validation Plan

### Smoke environment
- Branch: `opencode-engine-issue-564`
- API server: `apps/api_server` running locally on `:4001` (spawned by Flutter)
- Auth: **OpenRouter API key registered** via Settings → AI Accounts (the only authed provider for this test pass)
- Test agent kind: `claude-code` → resolves to `openrouter / anthropic/claude-sonnet-4.6`

### Expected WS event sequence for one prompt
1. Outbound `{v:1, type:'session.input', id, data}`
2. Inbound stream:
   - `{type:'output', id, data:'<delta>', replay:false}` × N (delta chunks)
   - (post-#591) `{type:'transcript.append', id, role:'output', text:'<full assistant msg>'}` on idle
   - `{type:'session.status', id, status:'idle'}` (or `{type:'session.status', id, working:false}` — verify naming)
3. UI: message bubble appears with streaming text that finalizes on idle.

### Per-issue acceptance gates
- **#590**: a short writeup in `docs/ai/decisions.md` titled "Why the chat transcript was empty" with copied WS log excerpts proving the seam.
- **#591**: vitest covering the new broadcast; manual smoke shows assistant messages staying in the transcript.
- **#592**: vitest covering error path; manual smoke with deliberately broken provider auth shows partial text + error.
- **#593**: unit tests pass for `AgentChatController.applyDelta`, `applyTranscriptAppend`, `applyStatus`.
- **#594**: full manual smoke — create session, send 3 prompts in a row, see all 3 turns render correctly.
- **#595–#597**: visual / analyze-only.

### Required commands (per repo testing-guide)
```bash
cd apps/api_server && npm test
cd apps/api_server && npx tsc --noEmit
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
cd apps/desktop_flutter && dart format . --set-exit-if-changed
cd apps/desktop_flutter && flutter run -d macos    # manual smoke
```

## Open Questions (must answer before coding-agent runs)

1. **Where is the Opencode Desktop UI source?** Is it `github.com/sst/opencode/packages/web`? `packages/desktop`? A separate `sst/opencode-app` repo? Without a concrete pointer we are mirroring the *concept* (parts-based message thread) without copying the exact components. If you (the user) can provide a path or repo URL, we can do a second targeted research pass before #594.
2. **Branch strategy:** the diagnosis (#590) is read-only. The fix (#591) and UI rework (#593–#597) need to land somewhere. Should they all stack on `opencode-engine-issue-564` (existing draft PR #574), or should we cut a new branch off this one for the UI work and open a second PR? Defaulting to "stack on existing branch" since auth rework + chat UI rework belong in the same shipping unit, but flagging for confirmation.
3. **Confirm OpenRouter is currently authed** in the local app and not still rate-limited (Outstanding Issue #3 in project-state). If still rate-limited, smoke for #591 will surface 429s and the UI must show the error correctly — we can use that as the test for #592.

## Data Safety / Risks
- Temp instrumentation in #590 must be reverted before commit. Logs may include user prompts — do not commit log output containing personal data.
- DB schema is unchanged across all issues. Existing migrations stand.
- No production-API changes (only `localhost:4001` api_server). Production endpoint `https://api.vcrcapps.com` is untouched.
- `agent_session_messages` continues to persist only assistant turns. Outstanding Issue #5 (user-input persistence) remains a separate follow-up.

## Branch / PR Recommendation
**Continue on `opencode-engine-issue-564`.** The auth rework, the existing stream bridge, and these UI changes are one coherent shipping unit. Pushing first (the branch is 29 commits ahead of remote) before adding more is the lower-risk play — the user should `git push origin opencode-engine-issue-564` so PR #574 reflects current local state before #590 begins.
