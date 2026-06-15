# Instant new session — design (2026-06-13)

## Goal

Remove the friction from starting an agent session. Today "New session" opens a
modal that **requires** a title and shows a cwd field. Match OpenCode: one click
creates an untitled session in the current project's cwd, and the title fills in
automatically from the first message. Power-user options (explicit cwd, branch,
task link, name) stay reachable but optional.

Approved direction (user, 2026-06-13): instant create, auto-title, advanced
options behind a secondary affordance (option **a** — a small control next to the
primary button, not an inline header field).

## Behavior

1. **Primary "New session" button** → creates immediately, no dialog:
   `createSession(agentId: null, cwd: <selected project cwd, else $HOME>, name: '')`,
   then selects it and focuses the composer. (Sessions are already agent-less;
   the model is chosen in the composer per #602.)
2. **Auto-title**: when OpenCode generates the session title (after the first
   exchange) it emits `session.updated { info: Session{ title } }`. The bridge
   currently has NO handler for this. Add one: map `info.title` → the Rhythm
   session `name`, persist it, and broadcast `SessionUpdatedMessage` so the list
   updates live.
3. **Display placeholder**: an empty `name` renders as **"New session"** in the
   list/header until the auto-title arrives. (Fallback: if the server title is
   still empty after the first user turn, show the first user message snippet,
   ~40 chars — display-only, no persistence.)
4. **Advanced affordance**: keep the existing `_NewSessionDialog` (title, cwd,
   branch, task) reachable via a small secondary control next to "New session"
   (a "⋯"/options button). The dialog itself is unchanged; it just stops being
   the only path.

## Architecture / files

**Server**
- `opencode_stream_bridge.ts` — new `case 'session.updated'`: read
  `event.properties.info`, if `title` is non-empty and differs, call a repo
  method to update the session `name`, then `broadcastSessionUpdated(updated)`.
- `@types/opencode-ai-sdk.d.ts` — add `EventSessionUpdated { type:'session.updated',
  properties:{ info: Session } }` to the `Event` union (real shape; `Session`
  already has `title`).
- `agent_sessions_controller.ts` / `opencode_client_service.createSession` —
  allow an empty/whitespace name (don't require a title); opencode auto-titles.
- `agent_sessions_repository.ts` — `updateName(id, name)` if not already present.

**Flutter**
- `agents_controller.createSession` — make `name` optional (default `''`).
  `SessionUpdatedMessage` handling already upserts the session; ensure the name
  from the server update replaces the placeholder.
- `agents_view.dart` — primary "New session" button calls instant-create +
  `selectSession`; add the secondary "⋯" control that opens `_NewSessionDialog`.
  Session-list/header render: show "New session" when `name` is empty (+ optional
  first-message snippet fallback).

## Error handling

- No selected project → cwd falls back to `$HOME`.
- createSession failure → existing error surfacing (the controller already sets
  `error`); surface inline, do not crash the button.

## Testing

- **vitest**: bridge `session.updated` → updates name + broadcasts (spy/real
  Session shape); createSession accepts empty name.
- **flutter (real-surface)**: tapping the primary "New session" button creates a
  session WITHOUT opening the dialog and selects it (pump the real AgentsView /
  session-list surface); a `SessionUpdatedMessage` carrying a title replaces the
  "New session" placeholder; the secondary "⋯" control opens `_NewSessionDialog`.

## Out of scope

- Renaming sessions by hand (separate feature). Persisting the first-message
  snippet as the real title (server auto-title is authoritative). Changing the
  dialog's contents.
