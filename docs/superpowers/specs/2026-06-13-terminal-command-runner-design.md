# Terminal command-runner — design (2026-06-13)

## Goal

Make the Agents-tab **Terminal** tab usable: replace the placeholder ("Captured
bash output will appear here.") with a working command-runner — the user types a
shell command, it runs in the session's working directory, and the output renders
terminal-style in the tab. Repeatable, with scrollback for the session.

**Non-goal (deferred to [#708](https://github.com/ajhochy/Rhythm/issues/708)):**
full interactive PTY (vim/top/REPLs, ANSI cursor, tab-completion, resize). This
spec is the one-shot command-runner only, which respects the locked "no PTY"
decision (PR #574 removed PTY).

## Key SDK fact

`client.session.shell({ path:{id}, body:{ command, agent, model } })` returns
`200: AssistantMessage` — it runs the command and creates a message in the
session whose parts (command output) stream through the EXISTING SSE→WS bridge
(`message.part.updated`). It requires an agent + model. So no new streaming infra
is needed; the work is routing this message's output into the Terminal tab and
keeping it out of the chat transcript.

## Architecture

1. **Server**
   - `OpencodeClientService.runShell(sdkId, command)`: resolves the session's
     model via the existing `agent_model_resolver` (first authed route) + default
     opencode agent `build`; calls `client.session.shell(...)`. Throws `AppError`
     on SDK error or when no model can be resolved (never silent).
   - Route `POST /agent-sessions/:id/shell { command }` → `{ messageId }` (the id
     of the created AssistantMessage). 400 on empty command; 502 on SDK error.

2. **Stream** — unchanged. The created message's parts arrive via the existing
   bridge `message.part.updated` relay.

3. **Flutter controller** (`AgentsController`)
   - `_terminalMessageIds: Map<String, Set<String>>` (per session) — ids of
     messages created by the Terminal tab.
   - `_terminalCommandByMessage: Map<String, String>` — the typed command, for
     echo above its output.
   - `runShellCommand(sessionId, command)`: POSTs the route, records the returned
     messageId + command, notifies. On error: records an error line for the tab.
   - `terminalEntriesFor(sessionId)`: ordered list of `{ command, messageId }` for
     rendering.

4. **Flutter Terminal tab** (`_session_side_panel.dart` Terminal case)
   - Replace `_PlaceholderTab` with a `TerminalTab` widget: scrollable log of
     entries (each = the typed command as a header + the message's parts via the
     M2-3 `TerminalOutputView`), newest at bottom; a command `TextField` at the
     bottom (Enter runs; disabled while a command is in flight). Empty state:
     "Run a command to get started."

5. **Transcript stays clean** — the main transcript builder
   (`chatMessagesFor` consumer in `agents_view.dart`) filters OUT message ids in
   `_terminalMessageIds[session]`, so shell runs don't appear in the chat.

## Components / boundaries

- `runShell` wrapper: one job — call `session.shell` with resolved model; throws
  loudly. Testable via SDK spy.
- shell route: validates input, delegates to wrapper, returns messageId.
- `AgentsController` terminal state: owns terminal message-id tracking + command
  echo; pure state, no UI.
- `TerminalTab` widget: renders entries + input; depends only on the controller's
  terminal getters + `TerminalOutputView`.

## Error handling

- Empty command → no-op (client guards) / 400 (server).
- No authed model → `AppError 502`, surfaced as an error line in the tab.
- SDK error → `AppError 502`, surfaced inline (never a silent no-op).

## Testing

- **vitest**: shell route invokes `session.shell` with `{command, model}` (spy,
  real model shape); empty command → 400; SDK error → 502.
- **flutter (real-surface)**: pump the mounted `SessionSidePanel`, select Terminal
  tab, assert the input is present; with a recorded terminal message + its parts,
  assert `TerminalOutputView` renders the output in the tab; assert the transcript
  EXCLUDES terminal-originated messages.

## Out of scope

- Interactive programs / PTY (#708). Multiple concurrent commands. Command
  cancellation (v2). Persisting terminal scrollback across app restarts.
