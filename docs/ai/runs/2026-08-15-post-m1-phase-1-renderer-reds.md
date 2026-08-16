---
date: 2026-08-15
repo: Rhythm
branch: unavailable
pr: null
issues: [post-m1-phase-1]
status: blocked
tags: [run, Rhythm]
---

# Post-M1 Phase 1 renderer RED repairs

## Files

- `apps/web/src/components/Shell.tsx` — routes the responsive More menu through the shared Menu component and restores focus to the trigger whenever a menu closes.
- `apps/web/src/store.tsx` — hydrates and persists fixture sessions through the existing localStorage boundary; live sessions remain gateway-owned.
- `docs/ai/runs/2026-08-15-post-m1-phase-1-renderer-reds.md` — this run record.

Manifest-covered files touched: `apps/web/src/components/Shell.tsx`, `apps/web/src/store.tsx`.

## Checks

### Supplied baseline

The task supplied an assertion-level baseline of `5 passed, 3 failed`, with c2c, c2d, and c3b RED. The local before run below could not reproduce assertions because Chrome aborted before page creation.

### Phase 1 fixture — before

Command:

```bash
cd apps/web && npx playwright test --config tests/post-m1-phase-1-fixture-playwright.config.ts --reporter=line
```

Verbatim output:

```text
[WebServer] (node:90989) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)


Running 8 tests using 1 worker

(node:90991) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[1/8] tests/post-m1-phase-1-navigation.redspec.ts:6:1 › post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics
  1) tests/post-m1-phase-1-navigation.redspec.ts:6:1 › post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-dEv7TJ --remote-debugging-pipe --no-startup-window
    <launched> pid=90992
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-dEv7TJ --remote-debugging-pipe --no-startup-window
      - <launched> pid=90992
      - [pid=90992] <gracefully close start>
      - [pid=90992] <kill>
      - [pid=90992] <will force kill>
      - [pid=90992] exception while trying to kill process: Error: kill EPERM
      - [pid=90992] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=90992] starting temporary directories cleanup
      - [pid=90992] finished temporary directories cleanup
      - [pid=90992] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-navigation-1c495-able-current-page-semantics/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-navigation-1c495-able-current-page-semantics/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-navigation-1c495-able-current-page-semantics/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:90997) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[2/8] tests/post-m1-phase-1-navigation.redspec.ts:38:1 › post-m1-p1-c2c: wide menu activation returns focus deterministically to its trigger
  2) tests/post-m1-phase-1-navigation.redspec.ts:38:1 › post-m1-p1-c2c: wide menu activation returns focus deterministically to its trigger 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-PzAx1l --remote-debugging-pipe --no-startup-window
    <launched> pid=90998
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-PzAx1l --remote-debugging-pipe --no-startup-window
      - <launched> pid=90998
      - [pid=90998] <gracefully close start>
      - [pid=90998] <kill>
      - [pid=90998] <will force kill>
      - [pid=90998] exception while trying to kill process: Error: kill EPERM
      - [pid=90998] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=90998] starting temporary directories cleanup
      - [pid=90998] finished temporary directories cleanup
      - [pid=90998] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-navigation-50876-ministically-to-its-trigger/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-navigation-50876-ministically-to-its-trigger/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-navigation-50876-ministically-to-its-trigger/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:91007) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[3/8] tests/post-m1-phase-1-navigation.redspec.ts:50:1 › post-m1-p1-c2d: narrow overflow activation returns focus deterministically to More
  3) tests/post-m1-phase-1-navigation.redspec.ts:50:1 › post-m1-p1-c2d: narrow overflow activation returns focus deterministically to More 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-cgmE2p --remote-debugging-pipe --no-startup-window
    <launched> pid=91012
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-cgmE2p --remote-debugging-pipe --no-startup-window
      - <launched> pid=91012
      - [pid=91012] <gracefully close start>
      - [pid=91012] <kill>
      - [pid=91012] <will force kill>
      - [pid=91012] exception while trying to kill process: Error: kill EPERM
      - [pid=91012] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=91012] starting temporary directories cleanup
      - [pid=91012] finished temporary directories cleanup
      - [pid=91012] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-navigation-ee316-s-deterministically-to-More/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-navigation-ee316-s-deterministically-to-More/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-navigation-ee316-s-deterministically-to-More/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:91034) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[4/8] tests/post-m1-phase-1-readiness.redspec.ts:4:1 › post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes
  4) tests/post-m1-phase-1-readiness.redspec.ts:4:1 › post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-kMD2ZP --remote-debugging-pipe --no-startup-window
    <launched> pid=91035
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-kMD2ZP --remote-debugging-pipe --no-startup-window
      - <launched> pid=91035
      - [pid=91035] <gracefully close start>
      - [pid=91035] <kill>
      - [pid=91035] <will force kill>
      - [pid=91035] exception while trying to kill process: Error: kill EPERM
      - [pid=91035] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=91035] starting temporary directories cleanup
      - [pid=91035] finished temporary directories cleanup
      - [pid=91035] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-readiness.-fc397-exposing-application-routes/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-readiness.-fc397-exposing-application-routes/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-readiness.-fc397-exposing-application-routes/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:91044) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[5/8] tests/post-m1-phase-1-settings.redspec.ts:6:1 › post-m1-p1-c3a: the theme setting persists through renderer reload
  5) tests/post-m1-phase-1-settings.redspec.ts:6:1 › post-m1-p1-c3a: the theme setting persists through renderer reload 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-PV8FEF --remote-debugging-pipe --no-startup-window
    <launched> pid=91048
    [pid=91048] <process did exit: exitCode=null, signal=SIGABRT>
    [pid=91048] starting temporary directories cleanup
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-PV8FEF --remote-debugging-pipe --no-startup-window
      - <launched> pid=91048
      - [pid=91048] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=91048] starting temporary directories cleanup
      - [pid=91048] <gracefully close start>
      - [pid=91048] <kill>
      - [pid=91048] <skipped force kill spawnedProcess.killed=false processClosed=true>
      - [pid=91048] finished temporary directories cleanup
      - [pid=91048] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-settings.r-44e7a-sts-through-renderer-reload/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-settings.r-44e7a-sts-through-renderer-reload/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-settings.r-44e7a-sts-through-renderer-reload/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:91051) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[6/8] tests/post-m1-phase-1-settings.redspec.ts:17:1 › post-m1-p1-c3b: an edited session setting persists through renderer reload
  6) tests/post-m1-phase-1-settings.redspec.ts:17:1 › post-m1-p1-c3b: an edited session setting persists through renderer reload 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-86PqZl --remote-debugging-pipe --no-startup-window
    <launched> pid=91052
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-86PqZl --remote-debugging-pipe --no-startup-window
      - <launched> pid=91052
      - [pid=91052] <gracefully close start>
      - [pid=91052] <kill>
      - [pid=91052] <will force kill>
      - [pid=91052] exception while trying to kill process: Error: kill EPERM
      - [pid=91052] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=91052] starting temporary directories cleanup
      - [pid=91052] finished temporary directories cleanup
      - [pid=91052] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-settings.r-6a94f-sts-through-renderer-reload/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-settings.r-6a94f-sts-through-renderer-reload/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-settings.r-6a94f-sts-through-renderer-reload/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:91058) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[7/8] tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3c: update failure is bounded, actionable, and redacted
  7) tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3c: update failure is bounded, actionable, and redacted 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-4QN5HN --remote-debugging-pipe --no-startup-window
    <launched> pid=91061
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-4QN5HN --remote-debugging-pipe --no-startup-window
      - <launched> pid=91061
      - [pid=91061] <gracefully close start>
      - [pid=91061] <kill>
      - [pid=91061] <will force kill>
      - [pid=91061] exception while trying to kill process: Error: kill EPERM
      - [pid=91061] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=91061] starting temporary directories cleanup
      - [pid=91061] finished temporary directories cleanup
      - [pid=91061] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-settings.r-a2633-ded-actionable-and-redacted/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-settings.r-a2633-ded-actionable-and-redacted/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-settings.r-a2633-ded-actionable-and-redacted/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:91077) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[8/8] tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3d: provider failure is bounded, actionable, and redacted
  8) tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3d: provider failure is bounded, actionable, and redacted 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-ivUbpQ --remote-debugging-pipe --no-startup-window
    <launched> pid=91085
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-ivUbpQ --remote-debugging-pipe --no-startup-window
      - <launched> pid=91085
      - [pid=91085] <gracefully close start>
      - [pid=91085] <kill>
      - [pid=91085] <will force kill>
      - [pid=91085] exception while trying to kill process: Error: kill EPERM
      - [pid=91085] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=91085] starting temporary directories cleanup
      - [pid=91085] finished temporary directories cleanup
      - [pid=91085] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-settings.r-be796-ded-actionable-and-redacted/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-settings.r-be796-ded-actionable-and-redacted/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-settings.r-be796-ded-actionable-and-redacted/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


  8 failed
    tests/post-m1-phase-1-navigation.redspec.ts:6:1 › post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics 
    tests/post-m1-phase-1-navigation.redspec.ts:38:1 › post-m1-p1-c2c: wide menu activation returns focus deterministically to its trigger 
    tests/post-m1-phase-1-navigation.redspec.ts:50:1 › post-m1-p1-c2d: narrow overflow activation returns focus deterministically to More 
    tests/post-m1-phase-1-readiness.redspec.ts:4:1 › post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes 
    tests/post-m1-phase-1-settings.redspec.ts:6:1 › post-m1-p1-c3a: the theme setting persists through renderer reload 
    tests/post-m1-phase-1-settings.redspec.ts:17:1 › post-m1-p1-c3b: an edited session setting persists through renderer reload 
    tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3c: update failure is bounded, actionable, and redacted 
    tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3d: provider failure is bounded, actionable, and redacted 

```

### Phase 1 fixture — after

Command:

```bash
cd apps/web && npx playwright test --config tests/post-m1-phase-1-fixture-playwright.config.ts --reporter=line
```

Verbatim output:

```text
[WebServer] (node:94813) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)


Running 8 tests using 1 worker

(node:94819) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[1/8] tests/post-m1-phase-1-navigation.redspec.ts:6:1 › post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics
  1) tests/post-m1-phase-1-navigation.redspec.ts:6:1 › post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-f3K7IB --remote-debugging-pipe --no-startup-window
    <launched> pid=94820
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-f3K7IB --remote-debugging-pipe --no-startup-window
      - <launched> pid=94820
      - [pid=94820] <gracefully close start>
      - [pid=94820] <kill>
      - [pid=94820] <will force kill>
      - [pid=94820] exception while trying to kill process: Error: kill EPERM
      - [pid=94820] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=94820] starting temporary directories cleanup
      - [pid=94820] finished temporary directories cleanup
      - [pid=94820] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-navigation-1c495-able-current-page-semantics/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-navigation-1c495-able-current-page-semantics/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-navigation-1c495-able-current-page-semantics/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:94826) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[2/8] tests/post-m1-phase-1-navigation.redspec.ts:38:1 › post-m1-p1-c2c: wide menu activation returns focus deterministically to its trigger
  2) tests/post-m1-phase-1-navigation.redspec.ts:38:1 › post-m1-p1-c2c: wide menu activation returns focus deterministically to its trigger 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-k9cYNS --remote-debugging-pipe --no-startup-window
    <launched> pid=94827
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-k9cYNS --remote-debugging-pipe --no-startup-window
      - <launched> pid=94827
      - [pid=94827] <gracefully close start>
      - [pid=94827] <kill>
      - [pid=94827] <will force kill>
      - [pid=94827] exception while trying to kill process: Error: kill EPERM
      - [pid=94827] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=94827] starting temporary directories cleanup
      - [pid=94827] finished temporary directories cleanup
      - [pid=94827] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-navigation-50876-ministically-to-its-trigger/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-navigation-50876-ministically-to-its-trigger/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-navigation-50876-ministically-to-its-trigger/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:94831) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[3/8] tests/post-m1-phase-1-navigation.redspec.ts:50:1 › post-m1-p1-c2d: narrow overflow activation returns focus deterministically to More
  3) tests/post-m1-phase-1-navigation.redspec.ts:50:1 › post-m1-p1-c2d: narrow overflow activation returns focus deterministically to More 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-sOMTvZ --remote-debugging-pipe --no-startup-window
    <launched> pid=94832
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-sOMTvZ --remote-debugging-pipe --no-startup-window
      - <launched> pid=94832
      - [pid=94832] <gracefully close start>
      - [pid=94832] <kill>
      - [pid=94832] <will force kill>
      - [pid=94832] exception while trying to kill process: Error: kill EPERM
      - [pid=94832] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=94832] starting temporary directories cleanup
      - [pid=94832] finished temporary directories cleanup
      - [pid=94832] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-navigation-ee316-s-deterministically-to-More/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-navigation-ee316-s-deterministically-to-More/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-navigation-ee316-s-deterministically-to-More/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:94833) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[4/8] tests/post-m1-phase-1-readiness.redspec.ts:4:1 › post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes
  4) tests/post-m1-phase-1-readiness.redspec.ts:4:1 › post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-KW0EF1 --remote-debugging-pipe --no-startup-window
    <launched> pid=94834
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-KW0EF1 --remote-debugging-pipe --no-startup-window
      - <launched> pid=94834
      - [pid=94834] <gracefully close start>
      - [pid=94834] <kill>
      - [pid=94834] <will force kill>
      - [pid=94834] exception while trying to kill process: Error: kill EPERM
      - [pid=94834] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=94834] starting temporary directories cleanup
      - [pid=94834] finished temporary directories cleanup
      - [pid=94834] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-readiness.-fc397-exposing-application-routes/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-readiness.-fc397-exposing-application-routes/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-readiness.-fc397-exposing-application-routes/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:94841) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[5/8] tests/post-m1-phase-1-settings.redspec.ts:6:1 › post-m1-p1-c3a: the theme setting persists through renderer reload
  5) tests/post-m1-phase-1-settings.redspec.ts:6:1 › post-m1-p1-c3a: the theme setting persists through renderer reload 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-lgBcik --remote-debugging-pipe --no-startup-window
    <launched> pid=94842
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-lgBcik --remote-debugging-pipe --no-startup-window
      - <launched> pid=94842
      - [pid=94842] <gracefully close start>
      - [pid=94842] <kill>
      - [pid=94842] <will force kill>
      - [pid=94842] exception while trying to kill process: Error: kill EPERM
      - [pid=94842] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=94842] starting temporary directories cleanup
      - [pid=94842] finished temporary directories cleanup
      - [pid=94842] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-settings.r-44e7a-sts-through-renderer-reload/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-settings.r-44e7a-sts-through-renderer-reload/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-settings.r-44e7a-sts-through-renderer-reload/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:94843) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[6/8] tests/post-m1-phase-1-settings.redspec.ts:17:1 › post-m1-p1-c3b: an edited session setting persists through renderer reload
  6) tests/post-m1-phase-1-settings.redspec.ts:17:1 › post-m1-p1-c3b: an edited session setting persists through renderer reload 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-wn98Yn --remote-debugging-pipe --no-startup-window
    <launched> pid=94844
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-wn98Yn --remote-debugging-pipe --no-startup-window
      - <launched> pid=94844
      - [pid=94844] <gracefully close start>
      - [pid=94844] <kill>
      - [pid=94844] <will force kill>
      - [pid=94844] exception while trying to kill process: Error: kill EPERM
      - [pid=94844] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=94844] starting temporary directories cleanup
      - [pid=94844] finished temporary directories cleanup
      - [pid=94844] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-settings.r-6a94f-sts-through-renderer-reload/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-settings.r-6a94f-sts-through-renderer-reload/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-settings.r-6a94f-sts-through-renderer-reload/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:94847) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[7/8] tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3c: update failure is bounded, actionable, and redacted
  7) tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3c: update failure is bounded, actionable, and redacted 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-8Eyz6y --remote-debugging-pipe --no-startup-window
    <launched> pid=94848
    [pid=94848] <process did exit: exitCode=null, signal=SIGABRT>
    [pid=94848] starting temporary directories cleanup
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-8Eyz6y --remote-debugging-pipe --no-startup-window
      - <launched> pid=94848
      - [pid=94848] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=94848] starting temporary directories cleanup
      - [pid=94848] <gracefully close start>
      - [pid=94848] <kill>
      - [pid=94848] <skipped force kill spawnedProcess.killed=false processClosed=true>
      - [pid=94848] finished temporary directories cleanup
      - [pid=94848] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-settings.r-a2633-ded-actionable-and-redacted/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-settings.r-a2633-ded-actionable-and-redacted/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-settings.r-a2633-ded-actionable-and-redacted/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:94950) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[8/8] tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3d: provider failure is bounded, actionable, and redacted
  8) tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3d: provider failure is bounded, actionable, and redacted 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-KEfbAp --remote-debugging-pipe --no-startup-window
    <launched> pid=95038
    [pid=95038] <process did exit: exitCode=null, signal=SIGABRT>
    [pid=95038] starting temporary directories cleanup
    Call log:
      - <launching> /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-KEfbAp --remote-debugging-pipe --no-startup-window
      - <launched> pid=95038
      - [pid=95038] <process did exit: exitCode=null, signal=SIGABRT>
      - [pid=95038] starting temporary directories cleanup
      - [pid=95038] <gracefully close start>
      - [pid=95038] <kill>
      - [pid=95038] <skipped force kill spawnedProcess.killed=false processClosed=true>
      - [pid=95038] finished temporary directories cleanup
      - [pid=95038] <gracefully close end>


    Error Context: test-results/post-m1-phase-1-settings.r-be796-ded-actionable-and-redacted/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/post-m1-phase-1-settings.r-be796-ded-actionable-and-redacted/trace.zip
    Usage:

        npx playwright show-trace test-results/post-m1-phase-1-settings.r-be796-ded-actionable-and-redacted/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


  8 failed
    tests/post-m1-phase-1-navigation.redspec.ts:6:1 › post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics 
    tests/post-m1-phase-1-navigation.redspec.ts:38:1 › post-m1-p1-c2c: wide menu activation returns focus deterministically to its trigger 
    tests/post-m1-phase-1-navigation.redspec.ts:50:1 › post-m1-p1-c2d: narrow overflow activation returns focus deterministically to More 
    tests/post-m1-phase-1-readiness.redspec.ts:4:1 › post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes 
    tests/post-m1-phase-1-settings.redspec.ts:6:1 › post-m1-p1-c3a: the theme setting persists through renderer reload 
    tests/post-m1-phase-1-settings.redspec.ts:17:1 › post-m1-p1-c3b: an edited session setting persists through renderer reload 
    tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3c: update failure is bounded, actionable, and redacted 
    tests/post-m1-phase-1-settings.redspec.ts:44:3 › post-m1-p1-c3d: provider failure is bounded, actionable, and redacted 

```

Result: blocked before assertions. Chrome exited with `SIGABRT`; an equivalent temporary bundled-Chromium run isolated the root cause to macOS sandbox denial: `bootstrap_check_in … Permission denied (1100)`.

### TypeScript

Command:

```bash
cd apps/web && npx tsc -p tsconfig.app.json --noEmit
```

Verbatim output:

```text

```

Result: exit 0 with no output.

### Shell/responsive/navigation regression suite — before

This command was not run before product edits. The task states these tests already cover the shell and must remain green, but no verbatim pre-edit output was provided. No result is fabricated here.

### Shell/responsive/navigation regression suite — after

Command:

```bash
cd apps/web && npx playwright test tests/shell.spec.ts tests/responsive-a11y.spec.ts tests/navigation-validation.spec.ts --reporter=line
```

Verbatim output:

```text
[WebServer] (node:96830) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)

[WebServer] (node:96832) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)


Running 16 tests using 1 worker

(node:96833) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[1/16] tests/navigation-validation.spec.ts:5:3 › child navigation and accessible resizing › moves parent → child → grandchild and returns one parent at a time
  1) tests/navigation-validation.spec.ts:5:3 › child navigation and accessible resizing › moves parent → child → grandchild and returns one parent at a time 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-sABolX --remote-debugging-pipe --no-startup-window
    <launched> pid=96834
    [pid=96834][err] [0815/145135.680489:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=96834][err] [0815/145135.682677:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=96834][err] [0815/145135.683322:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.96834: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-sABolX --remote-debugging-pipe --no-startup-window
      - <launched> pid=96834
      - [pid=96834][err] [0815/145135.680489:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=96834][err] [0815/145135.682677:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=96834][err] [0815/145135.683322:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.96834: Permission denied (1100)
      - [pid=96834] <gracefully close start>
      - [pid=96834] <kill>
      - [pid=96834] <will force kill>
      - [pid=96834] exception while trying to kill process: Error: kill EPERM
      - [pid=96834] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=96834] starting temporary directories cleanup
      - [pid=96834] finished temporary directories cleanup
      - [pid=96834] <gracefully close end>


    Error Context: test-results/navigation-validation-chil-28cf6-eturns-one-parent-at-a-time/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/navigation-validation-chil-28cf6-eturns-one-parent-at-a-time/trace.zip
    Usage:

        npx playwright show-trace test-results/navigation-validation-chil-28cf6-eturns-one-parent-at-a-time/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:96921) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[2/16] tests/navigation-validation.spec.ts:24:3 › child navigation and accessible resizing › resizes all panels from the keyboard with clamps and live values
  2) tests/navigation-validation.spec.ts:24:3 › child navigation and accessible resizing › resizes all panels from the keyboard with clamps and live values 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-Lijxee --remote-debugging-pipe --no-startup-window
    <launched> pid=96922
    [pid=96922][err] [0815/145136.915960:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=96922][err] [0815/145136.917814:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=96922][err] [0815/145136.918358:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.96922: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-Lijxee --remote-debugging-pipe --no-startup-window
      - <launched> pid=96922
      - [pid=96922][err] [0815/145136.915960:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=96922][err] [0815/145136.917814:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=96922][err] [0815/145136.918358:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.96922: Permission denied (1100)
      - [pid=96922] <gracefully close start>
      - [pid=96922] <kill>
      - [pid=96922] <will force kill>
      - [pid=96922] exception while trying to kill process: Error: kill EPERM
      - [pid=96922] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=96922] starting temporary directories cleanup
      - [pid=96922] finished temporary directories cleanup
      - [pid=96922] <gracefully close end>


    Error Context: test-results/navigation-validation-chil-d667b-with-clamps-and-live-values/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/navigation-validation-chil-d667b-with-clamps-and-live-values/trace.zip
    Usage:

        npx playwright show-trace test-results/navigation-validation-chil-d667b-with-clamps-and-live-values/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:96963) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[3/16] tests/navigation-validation.spec.ts:58:3 › attachment and @mention validation › adds, classifies, removes, rejects, and recovers deterministically
  3) tests/navigation-validation.spec.ts:58:3 › attachment and @mention validation › adds, classifies, removes, rejects, and recovers deterministically 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-nfqMZi --remote-debugging-pipe --no-startup-window
    <launched> pid=96969
    [pid=96969][err] [0815/145138.185214:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=96969][err] [0815/145138.186599:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=96969][err] [0815/145138.187170:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.96969: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-nfqMZi --remote-debugging-pipe --no-startup-window
      - <launched> pid=96969
      - [pid=96969][err] [0815/145138.185214:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=96969][err] [0815/145138.186599:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=96969][err] [0815/145138.187170:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.96969: Permission denied (1100)
      - [pid=96969] <gracefully close start>
      - [pid=96969] <kill>
      - [pid=96969] <will force kill>
      - [pid=96969] exception while trying to kill process: Error: kill EPERM
      - [pid=96969] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=96969] starting temporary directories cleanup
      - [pid=96969] finished temporary directories cleanup
      - [pid=96969] <gracefully close end>


    Error Context: test-results/navigation-validation-atta-a6fde--recovers-deterministically/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/navigation-validation-atta-a6fde--recovers-deterministically/trace.zip
    Usage:

        npx playwright show-trace test-results/navigation-validation-atta-a6fde--recovers-deterministically/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:96970) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[4/16] tests/navigation-validation.spec.ts:87:3 › attachment and @mention validation › @mention wraps keyboard selection, removes the token, and recovers after Escape
  4) tests/navigation-validation.spec.ts:87:3 › attachment and @mention validation › @mention wraps keyboard selection, removes the token, and recovers after Escape 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-LHbehM --remote-debugging-pipe --no-startup-window
    <launched> pid=96971
    [pid=96971][err] [0815/145139.431132:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=96971][err] [0815/145139.432788:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=96971][err] [0815/145139.433259:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.96971: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-LHbehM --remote-debugging-pipe --no-startup-window
      - <launched> pid=96971
      - [pid=96971][err] [0815/145139.431132:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=96971][err] [0815/145139.432788:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=96971][err] [0815/145139.433259:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.96971: Permission denied (1100)
      - [pid=96971] <gracefully close start>
      - [pid=96971] <kill>
      - [pid=96971] <will force kill>
      - [pid=96971] exception while trying to kill process: Error: kill EPERM
      - [pid=96971] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=96971] starting temporary directories cleanup
      - [pid=96971] finished temporary directories cleanup
      - [pid=96971] <gracefully close end>


    Error Context: test-results/navigation-validation-atta-3c5cf-n-and-recovers-after-Escape/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/navigation-validation-atta-3c5cf-n-and-recovers-after-Escape/trace.zip
    Usage:

        npx playwright show-trace test-results/navigation-validation-atta-3c5cf-n-and-recovers-after-Escape/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97028) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[5/16] tests/navigation-validation.spec.ts:102:3 › attachment and @mention validation › @mention surfaces unsafe and missing-file failures without stale chips
  5) tests/navigation-validation.spec.ts:102:3 › attachment and @mention validation › @mention surfaces unsafe and missing-file failures without stale chips 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-hUWfrP --remote-debugging-pipe --no-startup-window
    <launched> pid=97033
    [pid=97033][err] [0815/145140.715701:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97033][err] [0815/145140.717444:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97033][err] [0815/145140.717996:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97033: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-hUWfrP --remote-debugging-pipe --no-startup-window
      - <launched> pid=97033
      - [pid=97033][err] [0815/145140.715701:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97033][err] [0815/145140.717444:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97033][err] [0815/145140.717996:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97033: Permission denied (1100)
      - [pid=97033] <gracefully close start>
      - [pid=97033] <kill>
      - [pid=97033] <will force kill>
      - [pid=97033] exception while trying to kill process: Error: kill EPERM
      - [pid=97033] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97033] starting temporary directories cleanup
      - [pid=97033] finished temporary directories cleanup
      - [pid=97033] <gracefully close end>


    Error Context: test-results/navigation-validation-atta-08ef2-ailures-without-stale-chips/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/navigation-validation-atta-08ef2-ailures-without-stale-chips/trace.zip
    Usage:

        npx playwright show-trace test-results/navigation-validation-atta-08ef2-ailures-without-stale-chips/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97044) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[6/16] tests/responsive-a11y.spec.ts:17:3 › compact desktop keeps the complete Agents workspace reachable without page overflow
  6) tests/responsive-a11y.spec.ts:17:3 › compact desktop keeps the complete Agents workspace reachable without page overflow 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-XO5fpB --remote-debugging-pipe --no-startup-window
    <launched> pid=97052
    [pid=97052][err] [0815/145142.520520:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97052][err] [0815/145142.525386:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97052][err] [0815/145142.526271:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97052: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-XO5fpB --remote-debugging-pipe --no-startup-window
      - <launched> pid=97052
      - [pid=97052][err] [0815/145142.520520:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97052][err] [0815/145142.525386:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97052][err] [0815/145142.526271:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97052: Permission denied (1100)
      - [pid=97052] <gracefully close start>
      - [pid=97052] <kill>
      - [pid=97052] <will force kill>
      - [pid=97052] exception while trying to kill process: Error: kill EPERM
      - [pid=97052] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97052] starting temporary directories cleanup
      - [pid=97052] finished temporary directories cleanup
      - [pid=97052] <gracefully close end>


    Error Context: test-results/responsive-a11y-compact-de-281a3-hable-without-page-overflow/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/responsive-a11y-compact-de-281a3-hable-without-page-overflow/trace.zip
    Usage:

        npx playwright show-trace test-results/responsive-a11y-compact-de-281a3-hable-without-page-overflow/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97054) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[7/16] tests/responsive-a11y.spec.ts:17:3 › tablet portrait keeps the complete Agents workspace reachable without page overflow
  7) tests/responsive-a11y.spec.ts:17:3 › tablet portrait keeps the complete Agents workspace reachable without page overflow 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-v5Hxwj --remote-debugging-pipe --no-startup-window
    <launched> pid=97058
    [pid=97058][err] [0815/145143.922502:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97058][err] [0815/145143.932349:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97058][err] [0815/145143.933394:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97058: Permission denied (1100)
    [pid=97058] <process did exit: exitCode=null, signal=SIGTRAP>
    [pid=97058] starting temporary directories cleanup
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-v5Hxwj --remote-debugging-pipe --no-startup-window
      - <launched> pid=97058
      - [pid=97058][err] [0815/145143.922502:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97058][err] [0815/145143.932349:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97058][err] [0815/145143.933394:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97058: Permission denied (1100)
      - [pid=97058] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97058] starting temporary directories cleanup
      - [pid=97058] <gracefully close start>
      - [pid=97058] <kill>
      - [pid=97058] <skipped force kill spawnedProcess.killed=false processClosed=true>
      - [pid=97058] finished temporary directories cleanup
      - [pid=97058] <gracefully close end>


    Error Context: test-results/responsive-a11y-tablet-por-66b99-hable-without-page-overflow/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/responsive-a11y-tablet-por-66b99-hable-without-page-overflow/trace.zip
    Usage:

        npx playwright show-trace test-results/responsive-a11y-tablet-por-66b99-hable-without-page-overflow/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97070) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[8/16] tests/responsive-a11y.spec.ts:17:3 › mobile-ish keeps the complete Agents workspace reachable without page overflow
  8) tests/responsive-a11y.spec.ts:17:3 › mobile-ish keeps the complete Agents workspace reachable without page overflow 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-Vpcmwu --remote-debugging-pipe --no-startup-window
    <launched> pid=97077
    [pid=97077][err] [0815/145145.409485:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97077][err] [0815/145145.416156:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97077][err] [0815/145145.418235:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97077: Permission denied (1100)
    [pid=97077] <process did exit: exitCode=null, signal=SIGTRAP>
    [pid=97077] starting temporary directories cleanup
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-Vpcmwu --remote-debugging-pipe --no-startup-window
      - <launched> pid=97077
      - [pid=97077][err] [0815/145145.409485:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97077][err] [0815/145145.416156:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97077][err] [0815/145145.418235:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97077: Permission denied (1100)
      - [pid=97077] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97077] starting temporary directories cleanup
      - [pid=97077] <gracefully close start>
      - [pid=97077] <kill>
      - [pid=97077] <skipped force kill spawnedProcess.killed=false processClosed=true>
      - [pid=97077] finished temporary directories cleanup
      - [pid=97077] <gracefully close end>


    Error Context: test-results/responsive-a11y-mobile-ish-4dfc9-hable-without-page-overflow/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/responsive-a11y-mobile-ish-4dfc9-hable-without-page-overflow/trace.zip
    Usage:

        npx playwright show-trace test-results/responsive-a11y-mobile-ish-4dfc9-hable-without-page-overflow/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97101) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[9/16] tests/responsive-a11y.spec.ts:39:3 › touch, text, direction, and contrast resilience › uses 44px touch targets for every visible enabled workbench control
  9) tests/responsive-a11y.spec.ts:39:3 › touch, text, direction, and contrast resilience › uses 44px touch targets for every visible enabled workbench control 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-vNHbLQ --remote-debugging-pipe --no-startup-window
    <launched> pid=97102
    [pid=97102][err] [0815/145146.421504:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97102][err] [0815/145146.423588:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97102][err] [0815/145146.424043:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97102: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-vNHbLQ --remote-debugging-pipe --no-startup-window
      - <launched> pid=97102
      - [pid=97102][err] [0815/145146.421504:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97102][err] [0815/145146.423588:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97102][err] [0815/145146.424043:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97102: Permission denied (1100)
      - [pid=97102] <gracefully close start>
      - [pid=97102] <kill>
      - [pid=97102] <will force kill>
      - [pid=97102] exception while trying to kill process: Error: kill EPERM
      - [pid=97102] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97102] starting temporary directories cleanup
      - [pid=97102] finished temporary directories cleanup
      - [pid=97102] <gracefully close end>


    Error Context: test-results/responsive-a11y-touch-text-7dcfb-e-enabled-workbench-control/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/responsive-a11y-touch-text-7dcfb-e-enabled-workbench-control/trace.zip
    Usage:

        npx playwright show-trace test-results/responsive-a11y-touch-text-7dcfb-e-enabled-workbench-control/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97107) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[10/16] tests/responsive-a11y.spec.ts:50:3 › touch, text, direction, and contrast resilience › wraps long RTL, CJK, and emoji content without hiding core controls
  10) tests/responsive-a11y.spec.ts:50:3 › touch, text, direction, and contrast resilience › wraps long RTL, CJK, and emoji content without hiding core controls 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-tantVQ --remote-debugging-pipe --no-startup-window
    <launched> pid=97109
    [pid=97109][err] [0815/145147.752450:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97109][err] [0815/145147.754106:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97109][err] [0815/145147.754556:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97109: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-tantVQ --remote-debugging-pipe --no-startup-window
      - <launched> pid=97109
      - [pid=97109][err] [0815/145147.752450:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97109][err] [0815/145147.754106:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97109][err] [0815/145147.754556:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97109: Permission denied (1100)
      - [pid=97109] <gracefully close start>
      - [pid=97109] <kill>
      - [pid=97109] <will force kill>
      - [pid=97109] exception while trying to kill process: Error: kill EPERM
      - [pid=97109] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97109] starting temporary directories cleanup
      - [pid=97109] finished temporary directories cleanup
      - [pid=97109] <gracefully close end>


    Error Context: test-results/responsive-a11y-touch-text-dbc2c-ithout-hiding-core-controls/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/responsive-a11y-touch-text-dbc2c-ithout-hiding-core-controls/trace.zip
    Usage:

        npx playwright show-trace test-results/responsive-a11y-touch-text-dbc2c-ithout-hiding-core-controls/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97110) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[11/16] tests/responsive-a11y.spec.ts:63:3 › touch, text, direction, and contrast resilience › retains focus visibility and contrast semantics in forced-colors mode
  11) tests/responsive-a11y.spec.ts:63:3 › touch, text, direction, and contrast resilience › retains focus visibility and contrast semantics in forced-colors mode 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-b0C9Bk --remote-debugging-pipe --no-startup-window
    <launched> pid=97111
    [pid=97111][err] [0815/145149.012143:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97111][err] [0815/145149.013772:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97111][err] [0815/145149.014234:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97111: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-b0C9Bk --remote-debugging-pipe --no-startup-window
      - <launched> pid=97111
      - [pid=97111][err] [0815/145149.012143:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97111][err] [0815/145149.013772:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97111][err] [0815/145149.014234:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97111: Permission denied (1100)
      - [pid=97111] <gracefully close start>
      - [pid=97111] <kill>
      - [pid=97111] <will force kill>
      - [pid=97111] exception while trying to kill process: Error: kill EPERM
      - [pid=97111] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97111] starting temporary directories cleanup
      - [pid=97111] finished temporary directories cleanup
      - [pid=97111] <gracefully close end>


    Error Context: test-results/responsive-a11y-touch-text-98a1b-ntics-in-forced-colors-mode/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/responsive-a11y-touch-text-98a1b-ntics-in-forced-colors-mode/trace.zip
    Usage:

        npx playwright show-trace test-results/responsive-a11y-touch-text-98a1b-ntics-in-forced-colors-mode/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97114) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[12/16] tests/responsive-a11y.spec.ts:77:1 › supports 200% text scaling without obscuring primary actions
  12) tests/responsive-a11y.spec.ts:77:1 › supports 200% text scaling without obscuring primary actions 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-WuylBp --remote-debugging-pipe --no-startup-window
    <launched> pid=97115
    [pid=97115][err] [0815/145150.296656:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97115][err] [0815/145150.298355:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97115][err] [0815/145150.298717:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97115: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-WuylBp --remote-debugging-pipe --no-startup-window
      - <launched> pid=97115
      - [pid=97115][err] [0815/145150.296656:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97115][err] [0815/145150.298355:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97115][err] [0815/145150.298717:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97115: Permission denied (1100)
      - [pid=97115] <gracefully close start>
      - [pid=97115] <kill>
      - [pid=97115] <will force kill>
      - [pid=97115] exception while trying to kill process: Error: kill EPERM
      - [pid=97115] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97115] starting temporary directories cleanup
      - [pid=97115] finished temporary directories cleanup
      - [pid=97115] <gracefully close end>


    Error Context: test-results/responsive-a11y-supports-2-27547-t-obscuring-primary-actions/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/responsive-a11y-supports-2-27547-t-obscuring-primary-actions/trace.zip
    Usage:

        npx playwright show-trace test-results/responsive-a11y-supports-2-27547-t-obscuring-primary-actions/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97116) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[13/16] tests/responsive-a11y.spec.ts:89:1 › keyboard menus and dialogs restore focus without trapping the page
  13) tests/responsive-a11y.spec.ts:89:1 › keyboard menus and dialogs restore focus without trapping the page 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-0l0WiB --remote-debugging-pipe --no-startup-window
    <launched> pid=97117
    [pid=97117][err] [0815/145151.584125:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97117][err] [0815/145151.585669:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97117][err] [0815/145151.586163:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97117: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-0l0WiB --remote-debugging-pipe --no-startup-window
      - <launched> pid=97117
      - [pid=97117][err] [0815/145151.584125:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97117][err] [0815/145151.585669:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97117][err] [0815/145151.586163:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97117: Permission denied (1100)
      - [pid=97117] <gracefully close start>
      - [pid=97117] <kill>
      - [pid=97117] <will force kill>
      - [pid=97117] exception while trying to kill process: Error: kill EPERM
      - [pid=97117] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97117] starting temporary directories cleanup
      - [pid=97117] finished temporary directories cleanup
      - [pid=97117] <gracefully close end>


    Error Context: test-results/responsive-a11y-keyboard-m-29d2a-s-without-trapping-the-page/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/responsive-a11y-keyboard-m-29d2a-s-without-trapping-the-page/trace.zip
    Usage:

        npx playwright show-trace test-results/responsive-a11y-keyboard-m-29d2a-s-without-trapping-the-page/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97125) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[14/16] tests/shell.spec.ts:5:3 › product shell › renders and toggles theme when Studio storage access is sandboxed
  14) tests/shell.spec.ts:5:3 › product shell › renders and toggles theme when Studio storage access is sandboxed 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-eupVTC --remote-debugging-pipe --no-startup-window
    <launched> pid=97126
    [pid=97126][err] [0815/145152.816223:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97126][err] [0815/145152.817796:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97126][err] [0815/145152.818404:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97126: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-eupVTC --remote-debugging-pipe --no-startup-window
      - <launched> pid=97126
      - [pid=97126][err] [0815/145152.816223:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97126][err] [0815/145152.817796:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97126][err] [0815/145152.818404:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97126: Permission denied (1100)
      - [pid=97126] <gracefully close start>
      - [pid=97126] <kill>
      - [pid=97126] <will force kill>
      - [pid=97126] exception while trying to kill process: Error: kill EPERM
      - [pid=97126] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97126] starting temporary directories cleanup
      - [pid=97126] finished temporary directories cleanup
      - [pid=97126] <gracefully close end>


    Error Context: test-results/shell-product-shell-render-6de83-storage-access-is-sandboxed/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/shell-product-shell-render-6de83-storage-access-is-sandboxed/trace.zip
    Usage:

        npx playwright show-trace test-results/shell-product-shell-render-6de83-storage-access-is-sandboxed/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97127) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[15/16] tests/shell.spec.ts:19:3 › product shell › navigates the shell and uses the responsive More overflow
  15) tests/shell.spec.ts:19:3 › product shell › navigates the shell and uses the responsive More overflow 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-LuY1r4 --remote-debugging-pipe --no-startup-window
    <launched> pid=97128
    [pid=97128][err] [0815/145154.104875:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97128][err] [0815/145154.106373:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97128][err] [0815/145154.106822:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97128: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-LuY1r4 --remote-debugging-pipe --no-startup-window
      - <launched> pid=97128
      - [pid=97128][err] [0815/145154.104875:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97128][err] [0815/145154.106373:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97128][err] [0815/145154.106822:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97128: Permission denied (1100)
      - [pid=97128] <gracefully close start>
      - [pid=97128] <kill>
      - [pid=97128] <will force kill>
      - [pid=97128] exception while trying to kill process: Error: kill EPERM
      - [pid=97128] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97128] starting temporary directories cleanup
      - [pid=97128] finished temporary directories cleanup
      - [pid=97128] <gracefully close end>


    Error Context: test-results/shell-product-shell-naviga-5f0ba-he-responsive-More-overflow/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/shell-product-shell-naviga-5f0ba-he-responsive-More-overflow/trace.zip
    Usage:

        npx playwright show-trace test-results/shell-product-shell-naviga-5f0ba-he-responsive-More-overflow/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


(node:97131) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)


[16/16] tests/shell.spec.ts:34:3 › product shell › opens activity, notifications, account, theme, and endpoint controls
  16) tests/shell.spec.ts:34:3 › product shell › opens activity, notifications, account, theme, and endpoint controls 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-0edpfE --remote-debugging-pipe --no-startup-window
    <launched> pid=97132
    [pid=97132][err] [0815/145155.360599:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
    [pid=97132][err] [0815/145155.362363:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
    [pid=97132][err] [0815/145155.362767:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97132: Permission denied (1100)
    Call log:
      - <launching> /Users/ajhochhalter/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/playwright_chromiumdev_profile-0edpfE --remote-debugging-pipe --no-startup-window
      - <launched> pid=97132
      - [pid=97132][err] [0815/145155.360599:ERROR:base/power_monitor/thermal_state_observer_mac.mm:140] ThermalStateObserverMac unable to register to power notifications. Result: 9
      - [pid=97132][err] [0815/145155.362363:ERROR:net/dns/dns_config_service_posix.cc:138] DNS config watch failed to start.
      - [pid=97132][err] [0815/145155.362767:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.97132: Permission denied (1100)
      - [pid=97132] <gracefully close start>
      - [pid=97132] <kill>
      - [pid=97132] <will force kill>
      - [pid=97132] exception while trying to kill process: Error: kill EPERM
      - [pid=97132] <process did exit: exitCode=null, signal=SIGTRAP>
      - [pid=97132] starting temporary directories cleanup
      - [pid=97132] finished temporary directories cleanup
      - [pid=97132] <gracefully close end>


    Error Context: test-results/shell-product-shell-opens--d83ee-theme-and-endpoint-controls/error-context.md

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/shell-product-shell-opens--d83ee-theme-and-endpoint-controls/trace.zip
    Usage:

        npx playwright show-trace test-results/shell-product-shell-opens--d83ee-theme-and-endpoint-controls/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


  16 failed
    tests/navigation-validation.spec.ts:5:3 › child navigation and accessible resizing › moves parent → child → grandchild and returns one parent at a time 
    tests/navigation-validation.spec.ts:24:3 › child navigation and accessible resizing › resizes all panels from the keyboard with clamps and live values 
    tests/navigation-validation.spec.ts:58:3 › attachment and @mention validation › adds, classifies, removes, rejects, and recovers deterministically 
    tests/navigation-validation.spec.ts:87:3 › attachment and @mention validation › @mention wraps keyboard selection, removes the token, and recovers after Escape 
    tests/navigation-validation.spec.ts:102:3 › attachment and @mention validation › @mention surfaces unsafe and missing-file failures without stale chips 
    tests/responsive-a11y.spec.ts:17:3 › compact desktop keeps the complete Agents workspace reachable without page overflow 
    tests/responsive-a11y.spec.ts:17:3 › tablet portrait keeps the complete Agents workspace reachable without page overflow 
    tests/responsive-a11y.spec.ts:17:3 › mobile-ish keeps the complete Agents workspace reachable without page overflow 
    tests/responsive-a11y.spec.ts:39:3 › touch, text, direction, and contrast resilience › uses 44px touch targets for every visible enabled workbench control 
    tests/responsive-a11y.spec.ts:50:3 › touch, text, direction, and contrast resilience › wraps long RTL, CJK, and emoji content without hiding core controls 
    tests/responsive-a11y.spec.ts:63:3 › touch, text, direction, and contrast resilience › retains focus visibility and contrast semantics in forced-colors mode 
    tests/responsive-a11y.spec.ts:77:1 › supports 200% text scaling without obscuring primary actions 
    tests/responsive-a11y.spec.ts:89:1 › keyboard menus and dialogs restore focus without trapping the page 
    tests/shell.spec.ts:5:3 › product shell › renders and toggles theme when Studio storage access is sandboxed 
    tests/shell.spec.ts:19:3 › product shell › navigates the shell and uses the responsive More overflow 
    tests/shell.spec.ts:34:3 › product shell › opens activity, notifications, account, theme, and endpoint controls 

```

Result: blocked before assertions by the same macOS sandbox Mach bootstrap denial.

## Notes

- No tests, contract files, provenance files, manifests, Electron files, API files, or tools were modified.
- GitNexus MCP tools were unavailable in this session. Direct reference inspection found the shared Menu change localized to header menus; fixture persistence is contained in FixtureProvider and explicitly excludes live mode.
- Verification-gate: FAIL because behavioral and regression assertions could not execute.
- Failure-triage: BLOCKED; the required Playwright commands must be run outside the managed macOS sandbox.
- Criteria remain unverified rather than claimed green: c2c=red, c2d=red, c3b=red.

