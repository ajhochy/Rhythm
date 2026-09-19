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
