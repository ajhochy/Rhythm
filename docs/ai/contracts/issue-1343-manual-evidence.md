# Issue #1343 packaged/debug evidence contract

This feasibility issue is a release blocker if any row fails. Evidence must be
captured from both a Flutter **debug** build and a locally packaged **release**
app. A source review, unit test, or screenshot alone is not sufficient. Record
the exact macOS version, hardware architecture, build command, app path, probe
fixture, observed event log, and pass/fail result in `docs/ai/runs/`.

The probe is disposable. It must be unreachable from normal production UI and
must not introduce a permanent bridge/WebView dependency unless the ADR records
a go decision supported by every row below.

| Evidence ID | Required observation (repeat in debug and packaged release) | Failure condition |
|---|---|---|
| 1343-M1 | On every macOS version declared supported by Rhythm, open the trusted shell, wait for its ready event, load the benign iframe fixture, and record WebKit/AppBridge versions. | Shell or official AppBridge cannot initialize, ready times out, or supported-version coverage is missing. |
| 1343-M2 | The hostile iframe fixture attempts `window.parent`, `window.top`, and direct `window.webkit.messageHandlers` access. The outer event log records every attempt as denied and records no Dart-channel delivery. | Any iframe obtains the outer bridge/channel, reads shell state, or triggers a Dart message directly. |
| 1343-M3 | Send valid, missing, stale, and foreign boot nonces from the bound iframe; also send the valid nonce from a replaced/foreign frame and origin. Only the valid bound-frame message is accepted, with deterministic denial reasons logged for the rest. | Any invalid/replayed nonce, foreign frame, or foreign origin is accepted, or denial is ambiguous. |
| 1343-M4 | In view A set a cookie and localStorage marker; verify neither appears in concurrent view B. Quit the app completely, relaunch, and verify neither marker returns. Capture the selected `WKWebsiteDataStore` persistence state. | Cookies/storage cross views or survive restart, or the data store is persistent. |
| 1343-M5 | Fixtures attempt inline/undeclared script, external HTTPS, localhost, RFC1918/link-local targets, top-frame navigation, popup, download, form submission, `file:` access, and undeclared schemes. Capture CSP console output plus navigation/network delegate denials. | Any request leaves the view, navigation/download opens, or an undeclared script executes. |
| 1343-M6 | Exercise exactly-at-limit and over-limit content, bridge messages, concurrent views, requested width/height, and lifetime. Close the view and then close the parent window. Record resize clamps, deterministic over-limit denials, process/view counts, deinit/teardown events, and absence of callbacks after teardown. | A limit is unbounded, over-limit input is accepted, the WebView/process remains owned after teardown, or a post-teardown callback reaches Flutter. |
| 1343-M7 | Verify the dated ADR under `docs/ai/decisions/` names the tested macOS/build matrix, official AppBridge version/source, dependency disposition, all evidence links, and a single explicit `GO` or `NO-GO`. A go requires M1–M6 to pass in both builds; otherwise it must be no-go and downstream production hosting remains blocked. | ADR is missing/ambiguous, chooses a permanent dependency without passing evidence, or claims go with any missing/failing row. |

For no-go, retain the evidence and remove/disable the disposable launcher. For
go, the ADR must still state that this probe is not the production host and
grants no MCP execution authority.

## Disposable fixture access

The native probe is a standalone executable and is not referenced by the
Flutter Runner target or normal application UI. Build it from the repository
root with writable compiler caches:

```bash
CLANG_MODULE_CACHE_PATH=/private/tmp/rhythm-mcp-apps-clang-cache \
SWIFT_MODULECACHE_PATH=/private/tmp/rhythm-mcp-apps-swift-cache \
xcrun swiftc -D DEBUG -framework Cocoa -framework WebKit \
  apps/desktop_flutter/macos/Runner/McpAppIsolationProbePolicy.swift \
  apps/desktop_flutter/macos/RunnerTests/McpAppIsolationProbeLauncher.swift \
  -o /private/tmp/rhythm-mcp-app-isolation-probe
```

Running the executable without the explicit opt-in must exit 64. The only
supported launch command is:

```bash
RHYTHM_MCP_APPS_ISOLATION_PROBE=1 \
  /private/tmp/rhythm-mcp-app-isolation-probe 2>&1 | tee /private/tmp/rhythm-mcp-app-probe.log
```

For M2–M6, use the fixture embedded in
`McpAppIsolationProbeLauncher.swift`, inspect the `MCP_APP_PROBE` event log,
and replace its inner fixture locally with each hostile payload described in
the matrix. Do not commit captured machine/user data. A packaged-release run
cannot use this DEBUG launcher by design; it requires a separate disposable
Release probe target created and removed by the socket/UI-capable orchestrator.

## Evidence status on 2026-08-10

- Automated policy contract: five of five cases pass on macOS 26.5.2 arm64,
  Xcode 26.5, Swift 6.3.2.
- Standalone DEBUG launcher: compiles. Disabled-by-default invocation exits 64
  with the expected refusal.
- Interactive DEBUG observations M1–M6: not run in this managed worker.
- Packaged Release observations M1–M6: not run; no Release target or permanent
  dependency was added.
- Official AppBridge: not resolved or installed because dependency resolution
  is unavailable offline. No version is claimed.

Therefore the evidence matrix is incomplete and the decision is **NO-GO**.
See `docs/ai/decisions/2026-08-10-mcp-app-isolation-probe-no-go.md`.
