# Issue #1579 — Electron native agent notifications

## Approved design

Electron main owns notification validation, text, lookup, dedupe, suppression,
withdrawal, limits, native objects, and click routing. The renderer sends IDs
and state only. Existing approval notification behavior is unchanged.

Safe defaults: fixed bodies; completion clicks open the session; no after-quit
activation; no Electron upgrade/native addon; visible Notification Center and
real OS click remain manual gates.

## U0 evidence

- Electron 40.10.2 with `contextIsolation: true` and `sandbox: true` transfers a
  bounded object `CustomEvent.detail` from the trusted main document through
  preload to ipcMain. A JSON-string fallback also works; use the object form.
- Foreign webContents and an event after navigation to an untrusted document
  fail the existing `ownsDocument` predicate. New IPC must explicitly apply it
  and require the exact main frame.
- Main `Notification.isSupported()` exists. Native permission request/status
  APIs do not. Renderer web notifications can be denied through request and
  check handlers. Never call this “macOS permission granted.”
- Real sandbox lookup `GET /agent-sessions/:localId?transcriptLimit=1` returns
  `{session,messages,transcriptPage}`. Existing anonymous local request is 200;
  invalid bearer is 401; owner bearer is 200; other-owner/unknown is 404.
  Astra decision 8eabf939-d30d-49e3-b365-4619d982b110 supersedes this
  boundary: main requires a nonempty main-owned sign-in token before fetching,
  but the first and only loopback request sends no Authorization header. This
  checks local session existence, not cloud ownership; never use a remote origin
  or fallback/retry. Response `session.id` must match the local UUID.

## Renderer event contract

Dispatch `CustomEvent('rhythm:agent-notifications', {detail})`. The detail is a
plain object under 2 KiB with exact keys and a version. Preload and main each
validate independently. No title, body, URL, API base, icon, sound, or bearer
crosses this boundary.

Variants:

```ts
{ v: 1, type: 'ask', family: 'permission'|'question', sessionId, requestId }
{ v: 1, type: 'resolve', family: 'permission'|'question', sessionId, requestId }
{ v: 1, type: 'completion', sessionId }
{ v: 1, type: 'viewing', sessionId: string|null, displayed: boolean }
{ v: 1, type: 'ready' }
```

Use the local persisted UUID for `sessionId`, permission `permissionID`, and
question `requestId` (not tool callId). Validate fields separately; accept only
bounded `[A-Za-z0-9_-]` IDs where repository formats permit it. Never validate a
concatenated internal key as one external ID.

`ownsDocument` authenticates only the trusted document, not a React component;
rate/concurrency/state caps remain mandatory.

## Main-process behavior

- Separate agent-notification state from approval reconciliation.
- Ask identity: auth generation + family + local session + request ID.
- Track all pending asks from the renderer snapshot/events, not only one live
  permission/question per session.
- Reserve before async lookup. A resolve, generation change, logout, trusted
  reload, server replacement, window/document disposal, or eviction invalidates
  continuations and click/close handlers before closing native objects.
- Bound retained targets to 100, lookups to 4 concurrent, admission/show rate,
  tombstone lifetime, and queued activation to one latest target.
- Keep native objects strongly referenced. OS dismissal is not resolution and
  does not permit re-notification of the same ask.
- Lookup uses the main-selected loopback API only and requires a main-owned sign-in
  token, but sends no bearer, `redirect:error`, 1.5 s timeout, bounded response.
  Missing token means no fetch/notification. 401/403/404 or ID mismatch retires
  the target. No remote fallback or retry. A successful
  empty name uses fixed “Agent session”; sanitize an authorized name to 60 chars.
- Permission text: `<name> — Permission requested` / fixed waiting body.
  Question text: `<name> — Question` / fixed waiting body. Completion uses fixed
  title/body. Renderer/agent text never enters an OS notification.
- Suppress an ask only when the main window is focused, visible, not minimized,
  and renderer says that exact Agents transcript is currently displayed. Recheck
  immediately before show. A suppressed ask is not recorded.
- Completion is never suppressed. One current completion presentation per
  session; replacement callbacks cannot affect the newer entry.
- Click validates current generation and exact entry, restores/shows/focuses the
  owned window, and queues one target until renderer sends `ready`. Route to
  `#/agents?sessionId=<id>&activation=<monotonic>` so repeat clicks retrigger.
  Click never approves, answers, resumes, or sends content.
- Deny renderer notifications in both permission request/check handlers; retain
  the prior deny policy for other permissions, except owned-app clipboard write
  needed by packaged Copy. Remove the fake renderer `Notification.requestPermission()` startup call. Native
  unsupported/show errors fail soft.

## Renderer behavior

- Add a visible bell per message, keyed `(sessionId,messageId)`, available only
  with live gateway and shell host. It has `aria-pressed` and Flutter-equivalent
  arm/disarm labels.
- Keep armed state/ref in the store context. Side effects never occur inside
  React state updater functions.
- On a genuine working-to-idle successful transition, consume every armed entry
  for that session into one completion event. Initial idle hydration, duplicate
  idle, errors, retries, unrelated sessions, reconciliation, and StrictMode replay
  must not fire. Re-arming a later turn must work.
- Emit ask/resolve events for all pending permissions/questions using stable IDs.
- `AgentsWorkspace` emits exact transcript viewing state and null/not displayed
  on route/surface/unmount; fixture mode emits no native events.
- Emit `ready` only after the session-opening consumer is installed.

## Owned files

Electron: `apps/electron/src/main.mjs`, `preload.cjs`, focused runtime/security
tests and packaged notification smoke. Web: one notification helper,
`store.tsx`, `Transcript.tsx`, `AgentsWorkspace.tsx`, focused Playwright tests.
Do not alter approval reconciliation, API server, fork, Flutter, route policy, or
dependencies.

## Automated acceptance

1. Closed schema rejects arrays, extra keys, bad IDs, oversize events, foreign
   sender/subframe/untrusted document; no lookup/show occurs.
2. Authenticated lookup validates envelope and matching ID. Missing auth, 401,
   403, 404, redirects, mismatch fail closed; no anonymous retry.
3. Ask dedupe, separate families, resolve-before/after lookup, suppression,
   bounded admission/concurrency/eviction, and generation cleanup are executable.
4. Completion bell/arming has StrictMode-safe one-shot/rearm/replacement behavior.
5. Two asks and repeated completion/click lifecycle preserve exact entry identity.
6. Repeat click gets activation 1 then 2; pre-ready click opens exactly once after
   `ready`; stale users/servers/entries cannot navigate.
7. Renderer web notifications denied; native unsupported/throw fail soft; existing
   approval and issue-1510 tests remain green.
8. Playwright proves permission/question/resolve/completion/viewing/ready events,
   allowed keys, keyboard-accessible bell, and fixture isolation.
9. Electron/web typecheck, builds, full focused suites, session-opening and dist
   smoke pass.
10. Packaged candidate + real sandbox automated path proves actual preload/main
    bridge, event arrival, show attempt/log, cancellation, and session routing.

## Manual/not tested

- Visible macOS Notification Center banner and sound.
- Real Notification Center click and System Settings/Focus behavior when AX access
  is unavailable.
- After-quit activation (explicitly unsupported).

Record these as `not_tested`, never PASS. Astra reviews code before integration.
