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
