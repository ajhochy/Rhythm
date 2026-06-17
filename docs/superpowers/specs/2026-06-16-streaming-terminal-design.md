# Agent Inspector — Streaming / Interactive Terminal (Spec B)

Date: 2026-06-16
Status: Approved for planning
Scope: `apps/api_server` (PTY proxy + REST) + `apps/desktop_flutter` (xterm terminal). No production-data changes.

## Summary

Make the agents **Terminal tab** a real **interactive terminal** (a live shell
running in the session's working directory), replacing the current
type-one-command runner. The agent's own shell output (half **a**) already
streams live into the chat transcript via `message.part.delta`; Spec B's new
capability is the **interactive PTY** (half **b**).

Spec B of the two-part inspector effort. **Spec A** (collapse, Context, Changes)
shipped separately ([PR #728]).

## Spike findings (verified against opencode 1.14.40)

The PTY I/O transport is **undocumented in the SDK types** but was confirmed by
probing a live `opencode serve`:

- `POST /pty {command, cwd}` → `{ id, pid, status, ... }` (create).
- **Interactive I/O = a WebSocket upgrade on `ws://<engine>/pty/{id}/connect`** —
  returns HTTP 101; on the localhost-trusted engine it works **without** the
  `connect-token`. **stdout** arrives as **text WS frames** (raw terminal bytes,
  incl. `\r\n`/ANSI); **stdin** is sent as **text WS frames**. The first frame is
  a **binary** control frame `\x00{"cursor":0}` (resume-cursor protocol) — the
  proxy swallows it.
- `PATCH /pty/{id} {size:{rows,cols}}` (resize); `DELETE /pty/{id}` (kill).
- Lifecycle events `pty.created/updated/exited/deleted` ride the SSE `/event`
  stream (the stream bridge does not relay them today; Spec B does not need them
  because the proxy WS closing already signals exit).
- SDK methods: `client.pty.create/update/remove/get/list/connect` exist;
  `connect()` returns a boolean and is NOT the I/O path — the WS upgrade is.

## Architecture

```
Flutter xterm (Terminal tab)
   ⇄  ws://localhost:4001/ws/pty/:id      (api_server PTY proxy — byte pipe)
   ⇄  ws://127.0.0.1:4096/pty/:id/connect (opencode engine)
   + REST create/resize/kill  →  opencode SDK (client.pty.*)
```

Flutter only talks to the api_server (the embedded-opencode host on :4001);
opencode (:4096) is not reachable from Flutter. The api_server therefore runs a
**dedicated, near-transparent PTY WebSocket proxy** — chosen over multiplexing on
the existing chat WS to isolate high-volume terminal bytes from chat control and
match opencode's own one-WS-per-PTY model.

`OPENCODE_ENGINE_PORT = 4096` is already a constant in `opencode_client_service.ts`.

## Components

### 1. Backend — PTY SDK wrappers (`opencode_client_service.ts`)
- `createPty({ cwd, command? }): Promise<{ id, pid, status }>` → `client.pty.create({ body: { command: command ?? undefined, cwd } })`.
- `resizePty(id, cols, rows): Promise<void>` → `client.pty.update({ path: { id }, body: { size: { rows, cols } } })`.
- `removePty(id): Promise<void>` → `client.pty.remove({ path: { id } })` (best-effort; swallow not-found).
- All throw `AppError` on SDK error envelopes, matching the existing `addMcp`/`listMcp` wrappers.

### 2. Backend — PTY lifecycle routes
- `POST /agent-sessions/:id/pty` → resolve the session's `cwd` (from the persisted session row / `opencodeSessionMap`), call `createPty({ cwd })`, return `{ ptyId }`.
- `PATCH /pty/:id { cols, rows }` → `resizePty`.
- `DELETE /pty/:id` → `removePty`.
- Mounted on the local agent server; AGENT_LOCAL localhost bypass (same posture as the other agent endpoints).

### 3. Backend — dedicated PTY proxy WebSocket (`/ws/pty/:id`)
A new `ws` server (or a path branch on the existing upgrade handler) at
`/ws/pty/:id`. On a Flutter client connecting:
- Dial `ws://127.0.0.1:${OPENCODE_ENGINE_PORT}/pty/:id/connect`.
- **opencode → client:** forward each frame to the Flutter socket. Swallow the
  initial binary `\x00{...cursor...}` control frame (first byte `0x00`); forward
  text frames verbatim (these are the terminal bytes).
- **client → opencode:** forward each Flutter frame as stdin (text) to opencode.
- Close handling: if either socket closes/errors, close the other and tear down.
  When the opencode socket closes (PTY exit), close the Flutter socket with a
  normal code so the UI can show "[process exited]".
- One opencode WS per Flutter PTY connection; track for cleanup. No buffering
  beyond the OS/socket — frames forwarded as they arrive (isolated WS avoids
  head-of-line coupling with chat).

### 4. Flutter — interactive Terminal tab (`_terminal_tab.dart`)
- Add the `xterm` package (xterm.dart) to `pubspec.yaml`.
- Replace the one-shot command runner with an xterm `TerminalView`/`Terminal`:
  - On tab open for a session with no live PTY: `POST /agent-sessions/:id/pty` →
    get `ptyId`; connect a `WebSocketChannel` to
    `ws://localhost:4001/ws/pty/:id`.
  - Wire: `terminal.onOutput` (user keystrokes) → `ws.sink.add(data)` (stdin);
    incoming ws frames → `terminal.write(data)`; `terminal.onResize(w,h)` →
    `PATCH /pty/:id {cols:w, rows:h}` (debounced).
  - On dispose / session switch / tab leave: close the WS and `DELETE /pty/:id`
    (no orphan shells). Track the active `ptyId` per session in the controller.
  - States: connecting (spinner), connected (terminal), exited (show
    "[process exited]" + a "New terminal" action that re-creates the PTY),
    error (engine-not-ready/create-failed → message + retry).
- Keep the panel gated on `selectedSession != null` (existing condition).

### 5. Half (a) — verify agent shell output streams live
No new transport. Confirm the agent's `bash` tool output renders **incrementally**
in the chat transcript (it arrives as `message.part.delta`). If the transcript
already shows tool output live, this is a no-op verification; if a tool part only
renders on completion, ensure the delta path updates it live. This is a
verify/small-polish item, not a build component. The agent's tool shell and the
user's interactive PTY are intentionally **separate** streams (the Terminal tab
is the user's shell; agent runs show in the transcript).

## Error handling

- `createPty` when the engine isn't ready → REST returns a clear error; the tab
  shows "Terminal unavailable — agent engine not ready" + retry.
- PTY exit / opencode WS close → proxy closes the Flutter WS; tab shows
  "[process exited]" + "New terminal".
- Proxy dial failure (opencode unreachable) → close the Flutter WS with an error
  code; tab surfaces it.
- Cleanup: dispose/session-switch always `DELETE`s the PTY and closes the WS;
  the proxy also kills its opencode socket when the Flutter side drops, so a
  closed tab does not leak a shell.

## Testing

- **Backend proxy** (`apps/api_server`): integration test with a **fake opencode
  WS server** — assert client→opencode frames forward as stdin, opencode→client
  text frames forward verbatim, the leading binary cursor frame is swallowed, and
  closing either side tears down the other. SDK wrapper unit tests
  (`createPty/resizePty/removePty`) against a mocked SDK client (success + error
  envelope). Route test: `POST /agent-sessions/:id/pty` returns `{ptyId}` and
  creates with the session cwd (mock the service).
- **Flutter** (mounted, per this inspector's orphaned-widget history): pump the
  Terminal tab in the real surface with a fake PTY transport (injectable WS/
  channel + fake create/kill); assert typing routes bytes to stdin, incoming
  bytes render in the terminal, resize sends a resize, and dispose kills the PTY.

## File structure (touch list)

- `apps/api_server/src/services/opencode_client_service.ts` — PTY SDK wrappers.
- `apps/api_server/src/routes/pty_routes.ts` (NEW) + mount in `app.ts` — lifecycle REST.
- `apps/api_server/src/services/pty_proxy.ts` (NEW) + wire into the server's WS upgrade handling (alongside `ws_gateway`) — the `/ws/pty/:id` proxy.
- `apps/api_server/src/__tests__/pty_proxy.test.ts`, `pty_wrappers.test.ts` (NEW).
- `apps/desktop_flutter/pubspec.yaml` — add `xterm`.
- `apps/desktop_flutter/lib/features/agents/views/_terminal_tab.dart` — interactive terminal.
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — PTY lifecycle helpers (create/kill/track ptyId per session) + data-source calls.
- `apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart` — PTY REST + proxy WS URL.
- `apps/desktop_flutter/test/features/agents/inspector_terminal_*_test.dart` (NEW).

## Non-goals

- No connect-token / multi-user PTY auth hardening (localhost-only, AGENT_LOCAL).
- No relaying of `pty.*` SSE lifecycle events (the proxy WS close signals exit).
- No scrollback persistence across reconnects (the cursor/resume protocol is
  swallowed; a fresh PTY per connect is acceptable).
- No multiplexing PTY over the chat WS.
