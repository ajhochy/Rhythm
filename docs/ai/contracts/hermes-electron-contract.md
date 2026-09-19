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
// => { start, stop, getStatus, onStatus, install, restart }
```

- `start(): Promise<Status>`, `restart(): Promise<Status>`,
  `install(): Promise<Status>`, `stop(): Promise<void>`.
- `getStatus(): Status`; `onStatus(callback): () => void` unsubscribes.
  Snapshots are copies; subscribe and fetch the current status when mounting.
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
- Launch is exactly `hermes serve --port <port> --host 127.0.0.1`.
  `--skip-build` is appended only if `<install-dir>/web/dist/index.html` exists.
  Resolve symlinks and the official quoted `exec ".../bin/hermes"` wrapper,
  then find the ancestor containing `hermes_cli`; fallback is
  `~/.hermes/hermes-agent`. **This flag does not enable a dashboard on the
  installed Hermes version; see the source finding below.**
- Poll `GET http://127.0.0.1:<port>` at 500 ms intervals, bounded by a 60 s
  wall-clock budget. Any HTTP response means listening, including 401/403,
  redirects, 404, and 5xx. Redirects are not followed. `ready` means an owned
  child is listening, not that a dashboard page or authenticated session works.
- Timeout terminates the owned child and reports `readiness-timeout` plus the
  last 50 stderr lines (bounded and with credential-like diagnostics redacted).
  Unexpected exit/spawn failures also become `failed`. No automatic restart.
- Stop/quit cancels pending startup/consent, sends SIGTERM to owned children,
  waits 3 s, then SIGKILL if still alive. Wait up to another 3 s for confirmed
  exit; retain ownership and report `stop-failed` if exit is not observed.
  Never invoke `hermes serve --stop`, which stops other Hermes servers too.
- Repeated starts/installs/restarts are deduplicated. Restart stops the owned
  child and re-resolves the binary. Explicit `--smoke` and `--interactive-smoke`
  sessions do not start, install, restart, or own Hermes; their status stays
  stopped (or disabled), matching the existing non-owning runtime boundary.

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

## Installed Hermes source finding — B3 integration dependency

Read-only source inspection on 2026-09-18 found that **`hermes serve` does not
serve the dashboard, even when a built web dist exists**. The launch contract
above is preserved exactly; switching to `dashboard` was not silently done.

Evidence under `~/.hermes/hermes-agent/`:

- `hermes_cli/subcommands/dashboard.py:166–170`: `serve` sets
  `no_open=True, headless_backend=True` and explicitly never serves the SPA.
- `hermes_cli/main.py:12132–12137`: headless startup unconditionally sets
  `HERMES_SERVE_HEADLESS=1`, skipping the UI build.
- `hermes_cli/web_server.py:17902–17913`: headless mode mounts a catch-all
  returning **404 JSON** explaining the UI is disabled. Thus this supervisor's
  URL, **http://127.0.0.1:9121/**, is the backend root, not a dashboard URL on
  this installation. Prebuilding `web/dist` alone cannot change that.
- `hermes_cli/web_server.py:139`: actual dashboard default assets come from
  **`hermes_cli/web_dist`**, or explicit `HERMES_WEB_DIST`; this differs from
  the brief's `web/dist` existence condition. B2 retains that condition.
- For a separately launched `hermes dashboard --no-open --port <port>
  --host 127.0.0.1`, the browser UI is at **http://127.0.0.1:<port>/**
  (`web_server.py:18050–18073`). It must not share B2's occupied port.

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

B3 must not label a successful root HTTP probe as dashboard availability or
copy an injected Hermes token into Rhythm's renderer/bridge. A dashboard
embedding/authentication approach needs a revised joint contract; this worker
adds no proxy and exports no credentials. These findings are source evidence,
not a live dashboard/browser verification; this worker cannot launch servers.

## Verification boundary

Socket-free fake-OS lifecycle, real-filesystem installer-log/path, real-preload
VM, and real-main VM tests live in `apps/electron/test/hermes-server.test.mjs`.
Existing Electron rendered/preload and packaged-security receipt checks now
include the closed Hermes bridge. They are written for the orchestrator to run;
this worker does not launch Electron, Playwright, or Hermes. Production and
interactive-smoke ownership remain separately tested. Full `npm test` includes
socket binds and Electron launches and must run outside this worker's restriction.

## View + intents

<!-- B3 appends the view and intent contract here. -->
## View + intents

### Native integration with B2

`main.mjs` registers B3 exactly once with
`registerHermesView({ ipcMain, getWindow: () => mainWindow })`. B3 does not
implement or replace `rhythmShell.hermes` or supervise a process.

**Required merge wiring:** after creating B2's supervisor, bind its native
status source to B3 (adapt B2's native names; the renderer contract stays unchanged):

```js
import { bindHermesViewSupervisor } from './hermes-view.mjs';
bindHermesViewSupervisor({
  getStatus: () => hermesSupervisor.getStatus(),
  onStatus: (callback) => hermesSupervisor.onStatus(callback),
});
```

The getter may return a snapshot or a promise. `onStatus` returns an unsubscribe
function and must publish failed/stopped/disabled transitions, including a port
change. No renderer can bind this source. Until B2 is bound, attach returns
`{ ok: false, reason: 'not-ready' }` and creates no view. Tests inject a native
getter; they do not claim this unmerged integration has run.

Only `state: 'ready'` with an HTTP root URL at `127.0.0.1`, with exactly the
supervisor's numeric port, permits attachment. The supervisor must start
**`hermes dashboard`**, not `hermes serve`: the latter deliberately serves no
SPA. Keep `HERMES_WEB_DIST` unset unless the selected distribution is explicitly
qualified against this contract; the native Desktop distribution has a different
router. B2 owns runtime health, installation consent, restart and version.

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

Therefore **load the ready dashboard URL directly in the dedicated view**.
Do not read local credential files, copy cookies, inject a Rhythm bearer, scrape
tokens into the parent, or invent an auth proxy. Loopback is not tokenless:
Hermes's HTML bootstrap performs the existing browser handoff. A remotely gated
Hermes auth flow is not qualified by B3; outbound navigation remains blocked.

### Isolation and lifetime

The manifest requires Electron `^33.2.0`; the installed lockfile dependency is
33.4.11. Its bundled declarations expose `WebContentsView`, `MessageChannelMain`,
`WebContents.postMessage` and `WebContents.close`. B3 uses a WebContentsView with
sandbox, context isolation and web security enabled, Node integration disabled,
and partition `persist:rhythm-hermes`. There are no additional arguments, shared
parent session, Node/page API, cookie copies or CSP bypasses.

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

**Reduction permitted by the worker brief:** no safe client-side draft hook
exists in the inspected dashboard. Its `web/src/pages/ChatPage.tsx:1238–1256`
`?learn=` hook sends a terminal command plus carriage return, starting a turn.
B3 does not use it, mutate React internals, inject JavaScript, or type into a PTY.
`new-chat` is validated but returns `{ ok: false, reason: 'unsupported-draft' }`
with zero navigation or submission. The toolbar remains the single intent
affordance and reports the limitation. It sends a labelled fixed summary of less than 4 KiB because dashboard/task counts are page-local, not in the shared store.
It never includes task titles, message bodies, session credentials or a URL.

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
When merging B2/B3, extend the closed bridge-key allowlists in
`src/security-smoke-receipt.mjs` and `test/electron-shell.test.mjs` to include
both `hermes` and `hermesView`, add the corresponding nested key/frozen receipts
in main's security-smoke diagnostics and tests, and include the two B3 node
test files in the canonical test script. Until updated, the full native security
smoke rejects the additional bridge key. B3 leaves these shared edits to the
orchestrator, consistent with the brief's registration-only main edit and named
file ownership, to avoid racing B2's bridge changes.

Packaging also has an explicit support-file copy list in
`apps/electron/scripts/package-mac.mjs:104–114`. The orchestrator must add
`hermes-view.mjs`, `hermes-view-preload.cjs`, `hermes-protocol.mjs`,
`hermes-theme.mjs` and `hermes-theme.css` to that list alongside B2's supervisor
files. Without that merge edit, a packaged app cannot resolve the new main import.
