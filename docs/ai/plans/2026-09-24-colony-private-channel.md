# Colony private channel and renderer transport

Bounded planning-agent + acceptance-contract output, 2026-09-24. Baseline Bot Crossing commit `857c8b0` in `/private/tmp/bot-crossing-colony-artifact`. No product edits in this planning slice. Rhythm receiver candidate is stale and was not edited.

## Intent, scope and constraints

The user wants a real Bot Crossing tab inside Rhythm, with the same scene, task/project inventory and persistent archive/preferences, stacked onto the mega PR. The next vertical path is: locally opted-in first tab open → verified artifact → owned private scanner child → bounded data channel → scene renders real normalized inventory → state save survives reopening.

In scope: shared protocol, renderer transport, child startup and source filtering, native document-bound receiver, visible status/retry and disabled unsupported actions. No standalone fallback, TCP listener in embedded mode, arbitrary URL/path/native command from the scene, provider credentials, new sessions, terminal resume, harness state mutation, process takeover, merge or release. Existing standalone HTTP remains supported.

Tension: the current renderer expects the complete `{threads, projects, warnings}` shape, while the embedded service currently pages a flat thread array. Preserve data and generations instead of making a nominal tab that renders an empty project model. Another tension: frame identity is supplied by Electron at attachment time, but MessagePort events themselves do not authenticate a frame; bind the receiving closure to the exact live document and revoke it on navigation.

Clarification interview: parent dispatch already supplies the user decisions and precise scope; no additional user choice is needed for this bounded technical plan. Prior art was read locally rather than starting a new swarm: Rhythm `hermes-view.mjs` and `hermes-view-preload.cjs`, installed Electron `electron.d.ts` MessageChannelMain/WebFrameMain APIs, current standalone scene client and scanner. Do not copy Hermes' broader webview/network permissions into Colony.

## Concrete seams

### 1. Versioned request/response module

New upstream `server/embedded-protocol.mjs` exports:

```
createProtocolSession({ service, documentId }) -> { handle(envelope), dispose() }
request = { v: 1, documentId, id, method, payload }
success = { v: 1, documentId, id, ok: true, result }
failure = { v: 1, documentId, id, ok: false, error: { code, message } }
```

`documentId` and correlation `id` are bounded ASCII identifiers, 1–64 characters. Session document ID comes only from the owning native receiver. The protocol never accepts a path, host identity, source configuration or `dataDir` in scene payloads. A mismatched document ID cannot cause a service call. The worker-side protocol is a second check; it does not replace native sender validation.

Allowlisted methods for this slice:

- `state.read {}`
- `state.write {state, baseUpdatedAt}`
- `state.begin {baseUpdatedAt, totalBytes, sha256}`
- `state.chunk {transferId, index, data}`
- `state.commit {transferId}` / `state.cancel {transferId}`
- `state.readChunk {transferId, offset}` / `state.readCancel {transferId}`
- `inventory.page {generation?, cursor?, collection?, limit?}`
- `inventory.cancel {generation}`

Validate exact allowed keys and types per method. Reject duplicate outstanding IDs, non-JSON data, unknown envelope properties and unsupported versions/methods before service calls. Bound inflight requests to 32. Correlate replies to the exact pending request; unsolicited/replayed/mismatched replies must not settle another call. Structured errors use `invalid_request`, `unsupported_version`, `unsupported_method`, `revoked`, `oversize`, `state_conflict`, `unavailable`; internal stacks and incidental paths never enter errors.

Measure UTF-8 bytes of the **complete serialized envelope**, not just payload/result: controls ≤64 KiB; `state.chunk` and every response ≤1 MiB. An overlarge service response yields a small `oversize` error and never a truncated success. Page construction must reserve or receive the trusted complete envelope overhead; maximum-length IDs must be included in boundary tests. Chunk data may remain 512 KiB raw/base64 frames, and reconstructed state/snapshot stays ≤32 MiB aggregate. Chunk digest/length/order and final atomic commit remain enforced by the existing service. Handle expiry/cancel/errors by releasing transfers in `finally`, preserving previously saved state.

### 2. Snapshot shape that the scene can actually use

Extend the injected scanner result to `{threads, projects, warnings, scannedAt}` while retaining flat-array compatibility for current upstream service fixtures. A snapshot generation contains all collections. `inventory.page` defaults `collection` to `threads`; `projects` and `warnings` are the only other values. A page is `{generation, collection, records, nextCursor, scannedAt}`. All collection pages use one generation and scan timestamp. Only the first request without a generation triggers a scan; later pages never rescan. Bound all collections together to 32 MiB, each page to 250 records and its whole response envelope to 1 MiB. A single too-large record is an explicit error, not clipped data. `inventory.cancel` releases the complete snapshot; disposal rejects in-progress results.

Renderer `fetchThreads()` first pages threads, then projects and warnings with the same generation; assembles the exact existing shape, enforcing its own response/aggregate limits; always releases the generation. On a failed later page it returns no partial new snapshot, letting current `poll()` retain last-good data with an explicit stale status. A cancelled/disposed scan cannot update the scene.

### 3. Actual `src/game/api.js` adapter

The pinned preload exposes ONLY:

```
globalThis.colonyEmbedded = Object.freeze({
  product: 'colony', protocolVersion: 1,
  request(method, payload = {}) -> Promise<result>
})
```

`request` contains no generic ipcRenderer, filesystem, process, URL or native API. It owns its MessagePort, correlation IDs, limits and expiry. The page does not receive the raw port. Presence of an invalid/incompatible bridge fails closed; it must not fall back to HTTP. Bridge absence keeps standalone HTTP unchanged. Install the API synchronously in preload; request waits only for a bounded authenticated document port handshake, never discovers a service.

Keep the actual exported `fetchState`, `saveState`, `fetchThreads`, `openThread`, `newSession`, `revealFolder` so current callers remain valid. Refactor the shared client read/adopt/three-way merge loop rather than duplicating it:

- A save before a successful initial state read sends zero writes.
- A large read downloads sequential chunks, checks lengths and SHA-256 before parse/adopt, then cancels the download.
- A small save uses `state.write`; large saves use begin/chunk/commit. Threshold includes the full request envelope.
- On `state_conflict`, fetch the latest full state, call the existing `mergeState(baseSnapshot, local, remote)`, adopt remote base and retry at most three times. Preserve opaque state and archive removal rules.
- On revoked/closed bridge, reject pending operations and forbid fallback network activity; reopening gets a new client/document base.
- In embedded mode, opening/new-session/reveal actions fail locally with an understandable unavailable reason and no privileged request. Disable/hide their UI controls and terminal shortcuts. Later verified native intents may re-enable only supported actions.

`src/main.js` also has a direct `fetch('/api/checkout?...')` at line 187. Move this behind a new `fetchCheckout(id)` export: standalone keeps its route; embedded can return the already-scanned checkout record by opaque ID, with unknown/stale Git status explicit. Do not accept arbitrary cwd or issue on-demand shell commands from the renderer. Main's periodic/focus polling must obey receiver visibility, and pagehide/disposal must cancel active snapshot/transfer work.

### 4. Worker and scanner ownership (COL-03)

New upstream absolute `server/embedded-worker.mjs` accepts only a private parent IPC channel. No HTTP import, listener, port scan or bind. Boot handshake verifies protocol version/product and confirms ready before any source detection. Main supplies explicit absolute owned `dataDir`, enabled source configuration and a generation/nonce over the private parent channel; renderer cannot alter them. Worker constructs service without scanning. First inventory request initiates the first read.

Do NOT call current global `scanThreads()` for embedded scanning: it calls `detectedHarnesses()` for every source. Instead extract/create an instance-scoped read-only scanner with a closed source registry. Load/detect/scan only enabled adapters; preserve current deduplication/project identity and last-good diagnostics. Current adapters capture HOME/source env overrides at module import. Set only an allowlisted child environment before import, or refactor those adapters to explicit constructor paths; never mutate Rhythm's process environment. Source changes restart the owned worker with a new configuration epoch. Failures are reported per enabled source while healthy rows remain visible.

`createProjectResolver` currently runs Git via execFile. Add an explicit disabled-Git mode or verified executable option. Default embedded discovery without a verified Git executable must retain task paths with unknown repository status; do not invoke macOS Git stubs that trigger developer-tools installation. No downloads or install prompts.

Rhythm supervisor proposed signature:

```
createColonyService({ artifact, nodeExecutable, dataDir, sources, spawn, clock })
  -> { start(), request(envelope), dispose(), status() }
```

Require absolute verified packaged Node and worker paths; missing payload is unavailable, with no PATH or checkout fallback. Serialize starts: ten opens share one promise/child. Proposed startup deadline 10 seconds; at most two automatic restarts after the original child in a 60-second window, then explicit manual retry. Dispose closes request queues/ports and stops only its owned child, TERM then bounded KILL if necessary. No PID-name lookup, port reclamation or borrowed-service termination. Use handle identity and generation; never act on a stale child record after replacement. Test independent live sentinel children survive every lifecycle transition.

### 5. Rhythm native receiver

Parent updates `/private/tmp/rhythm-colony-private-bridge` to current integration before editing. Reuse the accepted resolver, not a new loading path. Resolve/reseal verification occurs before privileged host import or worker spawn. If artifact validation fails, show its actionable error and stop before a scene appears.

Use a WebContentsView with its own partition and fixed `rhythm-colony://app/index.html` origin. Register a standard secure custom scheme without `bypassCSP`. Serve only verified manifest members under the artifact root; deny traversal, arbitrary network requests/navigation/new windows/downloads/permissions. Keep sandbox true, contextIsolation true, nodeIntegration false, webSecurity true and webviewTag false. Serve actual Vite JS/GLB assets, not a placeholder UI. No bearer tokens or parent DOM bridge.

Authenticate parent attach using actual IPC `event.sender === owningWindow.webContents`, `event.senderFrame === owningWindow.webContents.mainFrame`, exact current Rhythm Colony route and current opt-in/configuration epoch. Authenticate scene-ready using the actual scene webContents/mainFrame and exact artifact URL. Allocate a fresh document UUID and MessageChannelMain; transfer one port with `WebFrameMain.postMessage` to that exact scene frame. Capture trusted frame object and document epoch in the receiver closure. Port messages alone never establish sender identity.

Before each service request and before delivering each reply, verify captured view/frame/document epoch is still active, not destroyed, enabled and currently attached. Revoke and close ports on scene main-frame navigation/reload, parent route departure, disable, configuration change, webContents destruction, app quit or view replacement. Reject all pending requests, dispose generation transfers and stop the owned worker when leaving/disabling the feature. Reload starts a new handshake; an old frame/port may never regain access. Native hostile-frame tests must use real Electron sender frames, not caller-supplied booleans.

## Ordered implementation table

| Order | Slice | Files | Behavioral evidence | Dependency |
|---|---|---|---|---|
| 1 | Protocol + actual renderer state transport | upstream embedded-protocol, game/api, service inventory collections | new RED files plus existing state/service contracts; no HTTP in embedded client | accepted shared store |
| 2 | Explicit read-only scanner + private worker | upstream embedded-worker, scan, harness registry/config, projects | packaged Node sanitized fixtures; source-disabled open count zero; before/after fixture hashes; no listener | 1 |
| 3 | Native supervisor and document receiver | Rhythm colony-service/view/protocol/scheme modules, main/preload; upstream embedded-preload | concurrent starts, sentinels, payload refusal, real Electron hostile frames/reload/revocation | 1–2 + resolver |
| 4 | Actual tab, visibility and capability UI | Rhythm tab/menu/settings; upstream main/HUD | pinned Electron opens actual scene/assets, projects/tasks displayed, archive persists; disabled actions inert | 3 |
| 5 | Clean build/pin and combined smoke | upstream artifact and Rhythm pin/build config | clean exact-source sealed artifact, packaged arm64/x64, single mega smoke | 4 |

## Executable RED and evidence limits

Current worktree adds `test/embedded-renderer-transport.test.mjs` (five tests driving actual `src/game/api.js` against a fake preload boundary and real synthetic state service) and `test/embedded-protocol-contract.test.mjs` (four tests for the proposed parser/session with real synthetic service). Command:

`node --test test/embedded-renderer-transport.test.mjs test/embedded-protocol-contract.test.mjs`

Observed **9 failed, 0 passed**. Four fail explicit missing-protocol-seam assertions; five expose current actual renderer HTTP requests or lack of local privileged-action refusal. Log `/private/tmp/colony-private-channel-contract-red.log`. These are executable contracts, not unconditional pytest-style fail stubs; after the missing seam is present, they drive valid and hostile envelopes, actual saved bytes, conflict merging, complete state transfer and disposal.

They do NOT prove native sender/frame authenticity, process ownership, packaged Node, real scanner filtering, rendered scene, secure-origin network rejection or installed packaging. Those acceptance criteria remain unverified and require slices 2–5. The protocol overflow test explicitly covers response-envelope overhead; renderer fixture tests use maximum-length correlation metadata when measuring requests.
