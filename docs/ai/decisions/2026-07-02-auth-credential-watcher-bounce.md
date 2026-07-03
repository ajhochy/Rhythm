---
tags: [decision, rhythm]
---

# Reload provider credentials on auth change via api_server-side watch+bounce (#856)

## Context

Switching Claude accounts (or any provider re-auth) writes fresh credentials
to `~/.local/share/opencode/auth.json`. The long-running opencode engine
subprocess only loads that file once, in `OpencodeClientService.restoreAuth()`
during `initialize()` — it has no code path that re-reads it later. Every
call against the stale in-memory token 401s until the user force-quits and
relaunches the whole app.

## Decision

Implemented the issue's explicitly lowest-risk first cut: an api_server-side
`fs.watch` + debounced change-detection, NOT an in-engine/fork change.

**`apps/api_server/src/services/auth_credential_watcher.ts`** (new):
- `decideReload(previous, next, lastAcceptedReloadAtMs, debounceMs)` — a pure
  function (no fs/timers) implementing the accept/reject rules: no baseline
  yet → no reload (establishes baseline only); unchanged content → no reload;
  changed content outside the debounce window since the last accepted reload
  → reload; changed content inside the debounce window → suppressed
  (`'debounced'`).
- `AuthCredentialWatcher` — the stateful wrapper. All fs/timer access is
  behind an injectable `AuthCredentialWatcherDeps` seam (`readFile`, `watch`,
  `now`, `setTimer`, `clearTimer`), mirroring the existing `StalePortDeps`
  injectable-dependency pattern already used in `opencode_client_service.ts`
  for testability without touching a real filesystem/timers. `fs.watch`'s
  multi-event-per-write behavior is settled with a short debounce
  (`settleMs`, default 150ms) before re-reading; genuine content changes are
  further gated by `debounceMs` (default 500ms) against the last ACCEPTED
  reload, so two writes from a single credential rotation collapse to one
  bounce.

**`OpencodeClientService.reloadCredentials()`** (new method,
`opencode_client_service.ts`): sets `status = 'reloading'`, calls the
existing `dispose()` then `initialize()` — a full graceful restart of the
`opencode serve` subprocess, which re-runs `restoreAuth()` against the fresh
file. `dispose()` has the side effect of setting `_shuttingDown = true`
(shared with the real app-shutdown path); `reloadCredentials()` resets it to
`false` immediately after, so the bounce is never mistaken for a permanent
shutdown by a concurrent `ensureReady()` call. Guarded: a no-op when
`_shuttingDown` is already true (app is genuinely tearing down).

**`EngineStatus`** gained a `'reloading'` member; `statusMessage` returns
`'Reloading credentials…'` for it, and `isReady` correctly returns `false`
during the bounce — this is the "brief reloading-credentials state instead of
opaque 401s" UX the issue asked for. No new route was added to surface this;
it flows through the existing `statusMessage`/`isReady` surface already
consumed by `app.ts`'s status route.

**`server.ts`** wiring: inside the existing `env.agentExecutionEnabled`
block, right after kicking off `opencodeClient.initialize()`, a new
`AuthCredentialWatcher` is constructed pointed at
`~/.local/share/opencode/auth.json` with `onReload` calling
`opencodeClient.reloadCredentials()`. Declared nullable alongside
`agentSchedulerJob`/`memoryVaultSyncJob` so the shutdown handler's
`authCredentialWatcher?.stop()` stays valid in the `'cloud'` role (where the
engine — and this watcher — never starts). Watcher start failures are
caught and logged non-fatally, matching every other optional startup step in
this file.

## Alternatives considered

- **In-engine/fork patch** (opencode itself re-reads auth.json on a signal or
  interval): explicitly ruled out by the issue as higher-risk; would also
  touch the vendored `apps/opencode_fork` subtree, which AGENTS.md restricts
  to `mcp-scope-*` work.
- **Poll auth.json on a timer instead of `fs.watch`**: rejected — `fs.watch`
  reacts immediately to the write that actually causes the problem (account
  switch), whereas polling adds latency and constant wake-ups for a file that
  changes rarely.
- **Just re-run `restoreAuth()` without a full dispose/init**: rejected. The
  issue's own diagnosis is that the SDK client and its underlying subprocess
  hold the stale token in memory beyond what `restoreAuth()`'s `setAuth`/
  `setOAuthCredentials` calls can override for an already-established
  session; a clean restart is the documented fix path or a full app restart
  works today only because the whole state is torn down and rebuilt (which is
  exactly what `dispose()+initialize()` also does, without needing the whole
  Electron/Flutter shell to restart too).

## Consequences

- A bounce briefly drops any in-flight opencode operation (existing behavior
  for a full app restart already implies this; a bounce is materially
  faster). `isReady` correctly reports `false` for the duration so callers
  polling status see a real reflection of engine availability rather than a
  stale "ready".
- **Desired UX message state** (per the issue's ask): `statusMessage` returns
  `'Reloading credentials…'` while `status === 'reloading'`. No Flutter-side
  UI change was made in this pass — the desktop client already polls
  `statusMessage`/`isReady` via the existing status surface, so it will
  display this message without further api_server changes, but a follow-up
  should verify (or add) a UI treatment more prominent than the generic
  "server not ready" copy the client currently shows for `isReady === false`.
- **Follow-up (out of scope here):** no end-to-end integration test spawns a
  real opencode engine and rewrites its actual `auth.json` — the pure
  decision logic and the `OpencodeClientService.reloadCredentials()`
  orchestration are unit-tested separately (with `initialize()`/`dispose()`
  spied/mocked), which is the standard test seam already used throughout
  this file for the same reason (real SDK spawn is not exercised in the unit
  suite). A manual smoke — switch Claude accounts while the app is running
  and confirm the next agent call succeeds without a restart — is
  recommended before closing #856 for good.
