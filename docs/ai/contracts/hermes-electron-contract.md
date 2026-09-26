# Hermes ↔ Rhythm Electron contract

Workstream B2-phase1, 2026-09-18. Shared with B3. OpenCode remains Rhythm's
agent engine; this supervisor is additive and does not change the engine
selection described in `docs/dev-plans/hermes-port-plan.md`.

## Supervisor and configuration

`apps/electron/src/hermes-server.mjs` exports:

```js
createHermesSupervisor({
  env = process.env,
  spawn = child_process.spawn,
  fetch = globalThis.fetch,
  log,
  resolveBinary,
  showConsent,
})
// => { start, stop, getStatus, getSessionToken, onStatus, install, restart }
```

- `start(): Promise<Status>`, `restart(): Promise<Status>`,
  `install(): Promise<Status>`, `stop(): Promise<void>`.
- `getStatus(): Status`; `onStatus(callback): () => void` unsubscribes.
  Snapshots are copies; subscribe and fetch the current status when mounting.
- `getSessionToken(): string | undefined` is a main-process-only generation
  handle for `hermes-view.mjs`. It is never part of `Status`, IPC, preload,
  a URL, or a log.
- `RHYTHM_HERMES_ENABLED` defaults ON. Only the literal `"0"` disables it:
  no binary lookup, spawn, installer, or consent dialog; every operation returns
  the disabled status. B3 must hide its sidebar entry when `hermes.enabled` is false.
- `RHYTHM_HERMES_PORT` defaults to **9121**; no roaming or adoption. Invalid ports,
  ephemeral port 0, and Hermes Desktop's port 9119 are rejected (`invalid-port`).
- A busy port yields `state: 'failed', reason: 'port-in-use'`. No foreign process
  is stopped. Port probing checks both loopback families; the child binds IPv4.
- Binary discovery runs `/bin/zsh -l -c 'command -v hermes'`, then checks
  `~/.local/bin/hermes`. No binary yields `absent`. `hermes --version` contributes
  its first line when available; failure to obtain version is nonfatal.
- Launch is exactly `hermes dashboard --port <port> --host 127.0.0.1 --no-open`.
  `--skip-build` is appended only if
  `<install-dir>/hermes_cli/web_dist/index.html` exists.
  Resolve symlinks and the official quoted `exec ".../bin/hermes"` wrapper,
  then find the ancestor containing `hermes_cli`; fallback is
  `~/.hermes/hermes-agent`.
- Poll `GET http://127.0.0.1:<port>/api/health` at 500 ms intervals, bounded by a 60 s
  wall-clock budget. Redirects are not followed. `ready` requires a 2xx response
  whose JSON contains `ok: true`, a non-empty string `version`, and boolean
  `auth_required`. Non-2xx and malformed responses keep the supervisor in
  `starting`; timeout reports the last non-2xx status without a response body.
  The requested 2026-09-18 loopback probe on port 9122 was unavailable; the
  installed `hermes_cli/web_server.py:get_health` handler defines this shape as
  `{ "ok": true, "version": <string>, "auth_required": <boolean> }`.
- Immediately before each dashboard child spawn, mint
  `crypto.randomBytes(32).toString('base64url')`. Remove any inherited
  `HERMES_DASHBOARD_SESSION_TOKEN` from other child environments and pass the
  minted value only to the dashboard child as that environment variable.
  Hermes injects the same value into its own served HTML as
  `window.__HERMES_SESSION_TOKEN__`; Rhythm never copies it across IPC/preload.
- Timeout terminates the owned child and reports `readiness-timeout` plus the
  last 50 stderr lines (bounded and with credential-like diagnostics redacted).
  Unexpected exit/spawn failures also become `failed`. No automatic restart.
- Stop/quit cancels pending startup/consent, sends SIGTERM to owned children,
  waits 3 s, then SIGKILL if still alive. Wait up to another 3 s for confirmed
  exit; retain ownership and report `stop-failed` if exit is not observed.
  Never invoke Hermes's global `--stop` command, which stops other Hermes servers too.
- Repeated starts/installs/restarts are deduplicated. Restart stops the owned
  child and re-resolves the binary. Explicit `--smoke` and `--missing-dist`
  self-tests do not start, install, restart, or own Hermes. Interactive smoke
  leaves the external agent runtime unowned but supervises Hermes whenever
  `RHYTHM_HERMES_ENABLED !== '0'`.

```ts
type Status = {
  state: 'disabled' | 'absent' | 'starting' | 'ready' | 'failed' | 'stopped';
  port: number;
  url: string; // always http://127.0.0.1:<port>, no authentication query string
  reason?: string;
  pid?: number;
  version?: string;
  binaryPath?: string;
};
```

Main-only test/configuration seams also accept `installLogPath`, `checkPort`,
`hasBuiltWeb`, `graceMs`, `readyTimeoutMs`, `pollMs`, and `commandTimeoutMs`.
These never cross IPC. Injected `resolveBinary` returns a path or null;
`showConsent` accepts Electron MessageBoxOptions and returns `{response}`.

## Installation

Official one-line bootstrap, read from the installed checkout's README lines
40 and 227:

```sh
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

`install()` first presents this exact command through native
`dialog.showMessageBox`. Buttons are `Cancel`, `Install Hermes`; both
`defaultId` and `cancelId` are 0. Only response 1 consents. No shell, binary
lookup, log file, or installer runs on the cancelled path. No elevation.
After consent, run `/bin/zsh -l -c <the exact command>`, append stdout/stderr to
`<app.getPath('userData')>/hermes-install.log` (mode 0600), await completion,
re-resolve the binary, and start. Installer output stays in the main process
and its local log; it is not status data. Failed install yields `install-failed`.

## IPC and preload

Main handlers accept no renderer payload and require the owned top-level
`rhythm://app/index.html` document:

- `hermes:get-status` → `Status`
- `hermes:install` → `Promise<Status>`
- `hermes:restart` → `Promise<Status>`

Every change broadcasts `webContents.send('hermes:status', status)` to all
living windows; newly loaded main windows receive the current status too.
The existing frozen `window.rhythmShell` gains a frozen `hermes` object:

```ts
hermes: {
  enabled: boolean; // RHYTHM_HERMES_ENABLED !== '0' at preload time
  getStatus(): Promise<Status>;
  install(): Promise<Status>;
  restart(): Promise<Status>;
  onStatus(callback: (status: Status) => void): () => void;
}
```

Only Status snapshots cross these channels. No tokens, arbitrary command,
URL-fetch/proxy capability, filesystem capability, or Electron event objects
cross the Hermes bridge. `before-quit` waits for both existing agent-server
shutdown and Hermes shutdown; shutdown disables further install/restart intents.

## Installed Hermes source evidence

Read-only source inspection and orchestrator probes on 2026-09-18 established
that the supervisor must use `hermes dashboard`: `hermes serve` is a headless
backend and returns 404 at `/`, while the dashboard command serves the SPA and
public health/status endpoints.

Evidence under `~/.hermes/hermes-agent/`:

- `hermes_cli/subcommands/dashboard.py:166–170`: `serve` sets
  `no_open=True, headless_backend=True` and explicitly never serves the SPA.
- `hermes_cli/main.py:12132–12137`: headless startup unconditionally sets
  `HERMES_SERVE_HEADLESS=1`, skipping the UI build.
- `hermes_cli/web_server.py:17902–17913`: headless mode mounts a catch-all
  returning **404 JSON** explaining the UI is disabled. A `serve` process would
  therefore remain unusable for the view regardless of prebuilt assets.
- `hermes_cli/web_server.py:139`: dashboard assets come from
  **`hermes_cli/web_dist`**, or explicit `HERMES_WEB_DIST`; the supervisor's
  skip-build predicate uses that real installed path.
- For `hermes dashboard --port <port> --host 127.0.0.1 --no-open`, the browser
  UI is at **http://127.0.0.1:<port>/** (`web_server.py:18050–18073`).

Authentication is also **not “none on loopback”**:

- `web_server.py:533–545, 17953–17969`: on ordinary loopback, dashboard HTML
  injects an ephemeral per-server `window.__HERMES_SESSION_TOKEN__`.
- `web_server.py:654–684, 984–1003`: API calls require
  `X-Hermes-Session-Token` or `Authorization: Bearer …`; query-token support is
  narrowly scoped (e.g. file downloads). WebSockets use `?token=…`
  (`web_server.py:16471–16569`). No general token file is required for this
  dashboard browser flow. SSH session-token-file is a separate explicit CLI mode.
- With a configured non-loopback public URL or non-loopback binding, the auth
  provider's cookie/session flow applies instead; the legacy token is not
  injected (`web_server.py:772–786, 19553–19560, 17953–17969`).

B3 never copies the token into Rhythm's renderer bridge. It requires both the
`ready` status and the supervisor's matching main-only token generation, then
loads the clean dashboard URL in a unique in-memory partition. Main replaces any
page-authored Authorization header with its own Bearer only for that dashboard's
HTTP origin. Hermes's own HTML bootstrap
remains necessary because loopback `_ws_auth_reason` accepts browser WebSockets
only through `?token=...`, and the SPA refuses chat without its served
`window.__HERMES_SESSION_TOKEN__`. Hermes Desktop likewise extracts the served
global for local mode. No accepted loopback cookie handoff exists: the cookies
and single-use WS tickets in `dashboard_auth` apply to gated auth. There is no
proxy or Rhythm credential export, and detach clears the ephemeral session.

## Verification boundary

Socket-free fake-OS lifecycle, real-filesystem installer-log/path, real-preload
VM, and real-main VM tests live in `apps/electron/test/hermes-server.test.mjs`
and `apps/electron/test/main-runtime.test.mjs`.
Existing Electron rendered/preload and packaged-security receipt checks now
include the closed Hermes bridge. They are written for the orchestrator to run;
this worker does not launch Electron, Playwright, or Hermes. Production and
interactive-smoke ownership remain separately tested. Full `npm test` includes
socket binds and Electron launches and must run outside this worker's restriction.

## View + intents

### Native integration with B2

`main.mjs` registers B3 exactly once with
`registerHermesView({ ipcMain, getWindow: () => mainWindow })`. B3 does not
implement or replace `rhythmShell.hermes` or supervise a process.

After creating the supervisor, main binds that exact native instance to the
view controller; the renderer contract stays unchanged:

```js
import { bindHermesViewSupervisor } from './hermes-view.mjs';
bindHermesViewSupervisor({
  getStatus: () => hermesSupervisor.getStatus(),
  getSessionToken: () => hermesSupervisor.getSessionToken(),
  onStatus: (callback) => hermesSupervisor.onStatus(callback),
});
```

The status getter may return a snapshot or a promise. `getSessionToken()` is
synchronous and main-only. `onStatus` returns an unsubscribe
function and must publish failed/stopped/disabled transitions, including a port
change. No renderer can bind this source. Until B2 is bound, attach returns
`{ ok: false, reason: 'not-ready' }` and creates no view. Tests inject the
native boundaries and verify that main binds the created supervisor instance.

Only `state: 'ready'` with an HTTP root URL at `127.0.0.1`, exactly the
supervisor's numeric port, and a current in-memory session token permits
attachment. Keep `HERMES_WEB_DIST` unset unless the selected distribution is
explicitly qualified against this contract. B2 owns runtime health,
installation consent, restart, token generation and version.

### Authentication evidence (read-only inspection, 2026-09-18)

The installed runtime at `~/.hermes/hermes-agent` implements:

- `hermes_cli/main.py:12137` builds `web/`; `hermes_cli/web_server.py:139` serves
  `hermes_cli/web_dist` by default (`HERMES_WEB_DIST` can override it).
- `hermes_cli/web_server.py:533–554` creates an ephemeral dashboard session token,
  optionally pinned by `HERMES_DASHBOARD_SESSION_TOKEN` or the SSH one-shot token.
- `hermes_cli/web_server.py:17885–17970` injects
  `window.__HERMES_SESSION_TOKEN__` in the normal loopback dashboard HTML.
  When Hermes's own auth gate is configured, it omits that token and uses its
  own login/cookie flow instead.
- `web/src/lib/api.ts:29–41,110–121,223–249` consumes the injected token using
  `X-Hermes-Session-Token` for API calls and Hermes's own WebSocket auth path.
- The fork at `~/Documents/hermes-rhythm-plugin/apps/desktop/electron/dashboard-token.ts`
  independently confirms the server HTML is authoritative: Desktop extracts
  that same injected token. Its token-discovery helper is not needed when loading
  the server's own HTML directly.

Therefore **load `status.url` directly in the dedicated view**.
Do not read local credential files, copy cookies, inject a Rhythm bearer, scrape
tokens into the parent, or invent an auth proxy. Loopback is not tokenless:
Hermes's HTML bootstrap performs the existing browser handoff. A remotely gated
Hermes auth flow is not qualified by B3; outbound navigation remains blocked.

### Isolation and lifetime

The manifest requires Electron `^33.2.0`; the installed lockfile dependency is
33.4.11. Its bundled declarations expose `WebContentsView`, `MessageChannelMain`,
`WebContents.postMessage` and `WebContents.close`. B3 uses a WebContentsView with
sandbox, context isolation and web security enabled, Node integration disabled,
and a unique in-memory partition named `rhythm-hermes-<generation>` for every
attach. The name never uses `persist:` and is never reused. There are no
additional arguments, shared parent session, Node/page API, cookie copies or
CSP bypasses. Detach unregisters request hooks and permission/download handlers,
clears storage and cache, closes connections, removes view listeners, and closes
the view so no session state survives the attachment.

Only the owned `rhythm://app/index.html#/hermes` main frame can attach. Bounds
and intents also require a native attachment handle, held privately in the
parent preload. The renderer's public API cannot select a URL, partition or
document generation. Every attach creates a new handle. Parent reload/route
exit, view detach, window close and supervisor loss destroy the view. A pending
attach is invalidated if its parent reloads while readiness is being checked.

Each view document gets a MessageChannelMain. `hermes:port` transfers one port
to the isolated view preload, which acknowledges via the internal
`hermes:view:document-ready` IPC. Main checks the exact view WebContents,
`event.senderFrame === view.webContents.mainFrame`, the origin and the current
generation. View navigation closes the old port before any new document can act;
same-document navigation replaces the port too. View-originated port messages
never perform native actions. No document bridge is exposed to the page.

Permission grants, downloads, popups and child-frame navigation are denied.
Partition requests are limited to the ready HTTP origin and its matching `ws:`
origin. Other loopback services, external URLs and filesystem URLs are blocked.
The view's bounds are DOM CSS pixels multiplied by the parent's zoom factor,
rounded and clipped to the native content rectangle. The child zoom follows
the parent. Host observation covers resize and ancestor/window scroll.

### Intent schema and supported reduction

Only these closed version-one DTOs pass `parseHermesIntent`, up to **64 KiB of
complete serialized UTF-8 JSON**. Unknown fields/types/versions, malformed IDs,
control characters, blank context and oversize payloads are rejected without
navigation or state writes; no truncation occurs at the native boundary.

```ts
type Intent =
  | { v: 1; type: 'navigate-session'; sessionId: string }
  | { v: 1; type: 'new-chat'; context: string };
```

The dashboard served by `hermes dashboard` is **not** `apps/desktop`:
`web/src/main.tsx:14` uses BrowserRouter, whereas Desktop uses HashRouter.
`web/src/pages/SessionsPage.tsx:540` opens an existing session with
`/chat?resume=<encoded-id>`; B3 mirrors that exact route via main-process
`loadURL`. This resumes the chat surface without sending a prompt.

The inspected dashboard has no query parameter that safely prefills without
sending: `web/src/pages/ChatPage.tsx:1238–1256` shows `?learn=` appends a carriage
return and starts a turn. B3 therefore sends the validated `new-chat` DTO only
over the current document-bound MessagePort. The isolated preload navigates the
BrowserRouter to `/chat`, polls for
`.hermes-chat-xterm-host .xterm-helper-textarea`, normalizes CR/LF/tab runs to
spaces, and dispatches one bubbling, cancellable `input` event after setting the
editable value. It never dispatches Enter, a key event, or submit. The toolbar
sends a labelled fixed summary of less than 4 KiB because dashboard/task counts
are page-local, not in the shared store. It never includes task titles, message
bodies, session credentials or a URL.

### Public B3 preload API

`rhythmShell.hermesView` is independent of B2's `rhythmShell.hermes`:

- `attach(): Promise<{ok: boolean, reason?: string}>`
- `setBounds({x, y, width, height}): Promise<boolean>`
- `detach(): Promise<boolean>`
- `sendIntent(intent): Promise<{ok: boolean, reason?: string}>`

Public methods map to `hermes:view:attach`, `hermes:view:bounds`,
`hermes:view:detach`, `hermes:intent`. The preload wraps the last three with the
private attachment handle. Stale async attach completions are immediately
detached using their own handle, so they cannot detach a newer view.

### Theme and verification boundary

`hermes-theme.css` overrides the served dashboard's Nous `--foreground`,
`--midground`, `--background` and text/theme tokens first, plus its shadcn
aliases. `insertCSS(..., {cssOrigin: 'user'})` on `dom-ready` lets the required
Rhythm palette override Hermes ThemeProvider inline values without changing CSP.
Light/dark variants follow `prefers-color-scheme`. The style is under 150 lines
and is never inserted when the feature is disabled.

Node tests cover the protocol, frame identity, real controller lifecycle with
fake native boundaries, private preload, port revocation, supervisor loss,
zoom/clipping, navigation restrictions and CSS insertion. Browser specs cover
all UI states, the one bounded action, transitions/teardown and narrow RTL/a11y.
The worker is prohibited from sockets and launching Electron/Playwright;
real pinned-runtime behavior and rendered evidence remain orchestrator checks.
The closed bridge-key allowlists include both `hermes` and `hermesView`, with
separate nested key/frozen receipts in the source and packaged security smokes.
The canonical Electron test script includes both B3 node suites.

Packaging has an explicit support-file copy list in
`apps/electron/scripts/package-mac.mjs`. It includes `hermes-server.mjs` plus
`hermes-view.mjs`, `hermes-view-preload.cjs`, `hermes-protocol.mjs`,
`hermes-theme.mjs` and `hermes-theme.css`, so packaged main/preload imports
resolve without falling back to workspace files.
