# Colony native receiver and owned runtime — implementation contract

Date: 2026-09-24. Candidate `/private/tmp/rhythm-colony-native-receiver`, branch `codex/colony-native-receiver`, base `60c30bf9`. Planning and RED tests only. Parent accepted upstream worker source at `569cf72`; upstream worktree is frozen. No product edits or commit/push in this slice.

## Intent and constraints

User outcome: an actual Bot Crossing tab inside Rhythm, showing the existing 3D scene and local agent inventory, with persistence and all completed work stacked into the mega PR for one smoke test. This slice connects the already implemented upstream artifact/worker/preload to Electron. A status-only substitute is not completion.

Scope: verified artifact worker role, packaged-only runtime selection, private owned process lifetime, exact native document/frame channel, local asset serving, main/preload registration and the host tab boundaries. No API/engine takeover, TCP service, ambient Node fallback, shell action delegates, terminal resume/new session, cloud upload, real-profile qualification or release in this implementation slice. No static/VM claim substitutes for native frame proof.

Hard constraints: preserve standalone upstream behavior; source reads only after opt-in and first tab use; explicit enabled source paths supplied by main, never scene; profile-owned data only; sandbox/context isolation/web security on, Node off; unknown/missing sources diagnosed without invented metadata; 64 KiB controls, 1 MiB complete frames, 250 records/page, 32 MiB aggregate state/inventory, 32 pending requests. Existing upstream protocol is authoritative for the closed method schema.

Design tension: COL-03 repeated-open coalescing versus immutable document lifetime. Parent confirmed repeated opens within one active document share a child; tab departure/reload revokes and disposes, and later return creates a fresh worker only after confirmed previous exit. No resurrected port or hidden orphan.

Smallest vertical proof: actual pinned Electron WebContentsView loads verified Bot assets, authenticates real preload readiness, scans one synthetic Hermes SQLite row through the real Node worker, and round-trips owned state. Then hostile actual sibling/foreign/stale frames and refusal paths. No external service is needed.

## Current source facts

- `colony-desktop-artifact.mjs` currently requires only renderer/host/preload and does not return workerPath. It checks tree/SRI, symlinks and pinned metadata before returning paths.
- `main.mjs` registers only Hermes view; scheme registrations happen before app readiness. Host account transitions and shutdown already have owned-runtime disposal barriers to extend.
- `agent-server.mjs:findNode` has fallback behavior and is not reusable for Colony. Packaging places Node at `Resources/node/bin/node`.
- `preload.cjs` has a narrow Hermes attachment wrapper; `Shell.tsx`, `App.tsx`, and `pages/hermes` supply existing host-tab patterns. Colony needs its own wrapper/routes/state, not shared Hermes credentials or lifecycle.
- No Colony config pin module is present in this receiver base. Integration must introduce the pin from parent-approved clean upstream source; never infer it from whatever manifest the app happens to find.
- Upstream ready now includes `capabilities:['inventory-v1','state-v1']`; preload emits `colony:scene-ready` only after exposing its closed wrapper. It waits at most 10 seconds for its only lifetime port. Worker startup must precede loading scene, or the native side must stay within that budget.

## Product seams and ordered implementation

### 1. Required worker and runtime (`colony-desktop-artifact.mjs`, new `colony-service.mjs`)

Resolver adds required verified `files.worker` and returns absolute `workerPath`. Existing fixture manifests must gain actual sealed worker files; do not weaken refusal assertions. Packaging/reseal must require all four roles. Main never imports scanner modules or host action delegates.

`resolveColonyNode({isPackaged,resourcesPath,developmentNodePath}) -> Promise<absolute path>`:

- packaged mode accepts only resourcesPath/node/bin/node, a regular executable, not a symlink; missing/invalid is an actionable unavailable result;
- development accepts only an explicitly trusted absolute runtime path; packaged mode ignores this option even when provided;
- no PATH lookup, login shell, `findNode`, developer checkout lookup or Node auto-install;
- worker handshake proves version/capability before any inventory request. Pin minimum Node SQLite capability through packaging and handshake contract; successful process launch alone is insufficient.

`createColonyService(options) -> {start({documentId}),request(envelope),stop(),dispose(),status()}`. Options include artifactRoot/expectedSourceCommit/expectedElectronMajor, isPackaged/resourcesPath/developmentNodePath, dataDir, immutable sources, enabled callback, startupTimeoutMs (production 8 seconds), stopTimeoutMs (production 2 seconds), maxRestarts (2), and test boundary spawnChild. `parentEnvironment` exists only as a trusted injection for sanitization tests; production builds a strict small allowlist, not spread process.env.

Construction does no artifact/source reads or child creation. Disabled start refuses before resolution. Ten concurrent starts share one promise/child. Result `{state:'ready',pid,capabilities}`; status includes null pid when confirmed absent and a bounded user-facing reason. Entry point and runtime are absolute verified paths. Spawn with shell false, fixed argv `[workerPath]`, explicit IPC stdio, no inherited execArgv or NODE_OPTIONS/NODE_PATH; HOME/TMPDIR belong to Colony runtime scratch, PATH empty, locale fixed. No credential variables.

Validate ready type/version/product/document ID and both capabilities, then open request admission. Unknown/duplicate IDs, wrong generation and malformed/oversize complete messages fail closed before forwarding. Request waiters are bounded and rejected on crash/stop. Startup failure terminates only its captured child; no PID/port searches. Graceful parent dispose, then TERM/KILL only the owned ChildProcess if needed. Do not treat disconnect, a successful kill() return, or elapsed time as confirmed exit. Disposal failure is sticky and blocks any later launch. Two retries after the first attempt per service epoch; exhausted state stays visible until a deliberate new service/configuration epoch, not an automatic infinite loop. New document requires stop then start.

### 2. Fixed assets and native receiver (new `colony-view.mjs`)

`createColonyAssetHandler(verifiedArtifact) -> async (Request) => Response` serves only `rhythm-colony://app/index.html` and verified files below the renderer directory. Never expose server/worker/preload/manifest paths, file URLs, traversal/encoded separators, arbitrary hosts or non-GET methods. Recheck served bytes against the sealed digest, so changed-after-verification files do not gain authority. Return restrictive CSP including connect-src self, frame-src none, object-src none; no bypassCSP. Public assets/GLB remain usable. Dedicated ephemeral session blocks non-scene network, permissions, downloads, popups, webviews and navigation.

`bindColonySceneChannel({ipcMain,contents,frame,documentId,service,MessageChannelMain}) -> {dispose()}` is the narrow native boundary used by `registerColonyView`, not a parallel test-only implementation. It captures actual WebContents + WebFrameMain + document epoch and fixed committed URL. It receives `colony:scene-ready` with exact `{v:1,product:'colony'}`. Reject unknown keys/version, foreign sender, same-WebContents sibling, detached/stale frame, old epoch or second readiness. Queue at most one readiness arriving before load/worker readiness; revalidate the exact actual frame and committed URL immediately before transfer. Transfer one port via the captured `frame.postMessage('colony:port',{v:1,documentId},[port])`, never broad webContents/window broadcast.

Every frame request is checked locally against the exact closed protocol/version/document/size before child dispatch; validate complete child responses too. The source worker's validation is a second boundary. Close both channel ends and reject outstanding work on reload/navigation/render crash/host disposal/disable/account transition. No new port can reactivate an old preload. `colony:revoke` informs the scene where possible, but closed transport/child refusal enforce the boundary regardless.

`registerColonyView({ipcMain,electron,getWindow,getArtifactRoot,getUserDataPath,getSources,enabled,isPackaged,resourcesPath,developmentNodePath,expectedSourceCommit,expectedElectronMajor}) -> {disposeCurrent(),dispose()}` owns view + service. Only exact host main frame at `rhythm://app/index.html#/colony` may use `colony:view:attach`, `bounds`, `detach`; attachment tokens remain internal to outer preload. Host cannot choose arbitrary paths, IDs, runtime args or channel names. Clamp bounds to current window geometry/zoom. Refusal returns `{ok:false,reason}` without creating partial content. Attach returns `{ok:true,attachment}` after current epoch is ready. Serialize attach/dispose; keep sticky teardown barrier.

### 3. Actual tab and capability-driven UI boundary

Main registers scheme before app readiness and native view after readiness; includes Colony in account-transition and shutdown disposal barriers. Outer preload exposes only frozen `colonyView` attach/bounds/detach/status/explicit opt-in/settings operations with internal epoch/attachment tracking. It never exposes raw ports, source paths, credentials or worker methods to the Rhythm host renderer.

Host product label is **Bot Crossing**; route remains `/colony`. Expose the tab when the shell supports it, independently of whether the user has opted in. First visit shows a clear local read-only discovery explanation and enabled-source choices; no scan occurs until explicit enable plus first use. Source configuration is resolved in main from trusted per-profile local preferences and passed as absolute paths before imports. Missing artifact/runtime or handshake failure yields a useful error and Retry, never another source or blank partial scene. Loading is visible until native scene attaches. Layout reports actual bounds through ResizeObserver; tab departure detaches. Disable/source/account changes revoke before replacing configuration.

Use actual upstream scene, preserved art/camera/selection. Since embedded protocol currently supports inventory/state only, new-session/open/reveal/terminal controls must be absent or disabled with a clear explanation, verified by behavior tests at actual scene render sites. Do not add command delegates to satisfy buttons. Source toggles/filter/theme/visibility/camera intents require versioned closed DTOs and dedicated behavior tests before being exposed; they are not implied by a successful channel.

Rendered host tab/capability behavior tests are the next UI slice; this plan designs their boundary but does not pretend the native fixtures render the actual Rhythm React tab. Required next UI contracts: Shell destination and App route compose the real Colony page; explicit opt-in produces zero calls beforehand; error/Retry is accessible; layout forwards bounds; unmount/disabling invokes detach; unsupported scene actions cannot dispatch. A real full-app tab smoke remains mandatory after composition.

## Acceptance matrix

| Issue | This contract evidence | Remaining whole-issue gate |
|---|---|---|
| COL-02 / #1527 AC1 | worker-role refusal and authenticated worker path; existing resolver suite retained | full issue refusal suite rerun after four-role fixture update |
| AC2 | runtime absence and fail-closed attach design | actual React tab error/Retry composition |
| AC3 | real Electron assets + real upstream worker synthetic inventory/state fixture authored | fixture must run with clean built actual artifact and packaged-node qualification |
| AC4/5 | real same-URL foreign WebContents and same-WebContents sibling/reloaded WebFrameMain fixtures; fixed asset/network/sandbox assertions | native hostile methods/budgets and full pinned runtime completion, not VM-only proof |
| AC6 | existing upstream page/chunk fixtures remain required | native large snapshot/archive/interrupt pass |
| COL-03 / #1528 AC1 | construction/disabled zero child; 10 starts/repeated same-document start coalesce | full startup/UI opt-in source-read receipt |
| AC2 | actual unrelated process sentinel preserved, sticky owned-child shutdown | packaged listener/process receipt, crash/retry/quit matrix |
| AC3 | no packaged runtime fallback, capability refusal | actual packaged Node binary/version/SQLite proof |
| AC4 | retry exhaustion; upstream explicit-source diagnostics contracts | native multi-source locked/malformed fixture matrix |

## RED files and execution

- `apps/electron/test/colony-native-service-contract.test.mjs`: 9 checks, actual subprocess service fixtures when implementation exists, one fake unkillable process boundary to prove sticky ownership failure.
- `apps/electron/test/colony-native-assets-contract.test.mjs`: 3 checks over actual handler/verified fixture bytes, no network.
- `apps/electron/test/colony-native-frame-contract.test.mjs`: 5 actual Electron acceptance outcomes, supported by `test/support/colony-native-electron-fixture.mjs`. No fake frame objects. Separate hostile receiver fixture permits subframe preload only in its attack surface to exercise same-WebContents sibling IPC; actual production-view preferences are independently asserted.
- `test/support/colony-native-fixture.mjs`: disposable sealed service-boundary fixtures, not a replacement for the actual upstream artifact in native tests.

Command: `node --test apps/electron/test/colony-native-service-contract.test.mjs apps/electron/test/colony-native-frame-contract.test.mjs apps/electron/test/colony-native-assets-contract.test.mjs`.

Current outcome: **17 failed / 0 passed**, all assertion RED from missing worker-role return/refusal or absent product seams. `/private/tmp/colony-native-contracts-red.log`. No actual Electron or children launched during this RED: native harness first asserts the missing product export. The fixture is authored, not yet executed or claimed as native proof.

After implementation, native runner requires `COLONY_NATIVE_ARTIFACT` (clean built actual Bot artifact) and `COLONY_NATIVE_SOURCE_COMMIT` (explicit expected pin). It copies the artifact to a disposable root, creates one Hermes SQLite fixture, uses pinned Electron 40.10.2 without a DevTools/TCP port, isolates HOME/userData/sessionData, and hashes the source afterward. Native receipt records individual checks. Synthetic service tests prove process ownership but do not certify packaged architecture/signing. Never supply real profile roots.

## Review and implementation gate

No product changes until parent approves this plan/RED. First implementation reruns RED. GitNexus impact required before existing symbols (resolver/main/preload/Shell/App). Implement runtime/receiver first, focused tests, then source/UI composition with additional behavior contracts, then one bounded full relevant gate and actual native receipt. Preserve the parent-controlled final clean upstream pin/artifact rebuild sequence; do not pin a dirty planning checkout. Human merge/release remains separate.

## Paused implementation checkpoint

Parent approved implementation after the 17 RED receipt. Source now includes native service/runtime selection, closed local channel validation, view/document receiver and verified asset handler; resolver requires/returns worker. Upstream runtime metadata prerequisite was separately reviewed/committed by parent as `a30b4c924be4344d444f1826e1dec88fb138a4ad` and rebuilt clean at `/private/tmp/bot-crossing-colony-artifact/build/rhythm-embedded`.

Final focused service/assets: 14/14; existing resolver: 37/37; Electron typecheck: pass. Actual Electron fixture attempted twice, both timed out before app.whenReady; the diagnostic stage identified a top-level ESM readiness wait. Fixture now invokes async run() without holding module evaluation, syntax-checked but deliberately not rerun at the user-requested pause. Thus no native frame or receiver PASS. No main/preload/UI composition, packaged-runtime gate, broad suite, commit or push. Resume with the existing native command before expanding work; review source/lifecycle behavior against the plan and preserve sticky ownership failure.
