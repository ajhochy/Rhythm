---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-1]
status: partial
tags: [run, Rhythm-react-electron-live-suite]
---

# Post-M1 Phase 1 acceptance-contract evidence

## Files

- `docs/ai/contracts/post-m1-phase-1.json`
- `docs/ai/contracts/post-m1-phase-1.md`
- New Playwright fixture/live specs under `apps/web/tests/`
- `apps/electron/test/post-m1-phase-1-host-policy.test.mjs`

## Checks

### post-m1-p1-c1a

```text
[4/8] tests/post-m1-phase-1-readiness.spec.ts:4:1 › post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes
Error: browserType.launch: Target page, context or browser has been closed
```

### post-m1-p1-c1b

```text
Listing tests:
  post-m1-phase-1-readiness.live.spec.ts:3:1 › post-m1-p1-c1b: live cold launch gates application routes on API, engine, and auth readiness
Total: 1 test in 1 file
```

Not run: live specs and ports 4097/4098 were prohibited for this unit.

### post-m1-p1-c1c

```text
RETAINED — apps/web/tests/gateway/invalid-live.spec.ts
```

### post-m1-p1-c2a

```text
[1/8] tests/post-m1-phase-1-navigation.spec.ts:6:1 › post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics
Error: browserType.launch: Target page, context or browser has been closed
```

### post-m1-p1-c2b

```text
RETAINED — apps/web/tests/responsive-a11y.spec.ts; apps/web/tests/shell.spec.ts; apps/web/tests/navigation-validation.spec.ts
```

### post-m1-p1-c2c

```text
[2/8] tests/post-m1-phase-1-navigation.spec.ts:33:1 › post-m1-p1-c2b: wide menu activation returns focus deterministically to its trigger
Error: browserType.launch: Target page, context or browser has been closed
```

The executable test ID was aligned to `post-m1-p1-c2c` after this captured harness output; the discovery block below is the post-alignment output.

### post-m1-p1-c2d

```text
[3/8] tests/post-m1-phase-1-navigation.spec.ts:45:1 › post-m1-p1-c2c: narrow overflow activation returns focus deterministically to More
Error: browserType.launch: Target page, context or browser has been closed
```

The executable test ID was aligned to `post-m1-p1-c2d` after this captured harness output; the discovery block below is the post-alignment output.

### post-m1-p1-c2e

```text
NOT RUN — packaged keyboard/VoiceOver check prohibited by dispatch constraints.
```

### post-m1-p1-c3a

```text
[5/8] tests/post-m1-phase-1-settings.spec.ts:6:1 › post-m1-p1-c3a: the theme setting persists through renderer reload
Error: browserType.launch: Target page, context or browser has been closed
```

### post-m1-p1-c3b

```text
[6/8] tests/post-m1-phase-1-settings.spec.ts:17:1 › post-m1-p1-c3b: an edited session setting persists through renderer reload
Error: browserType.launch: Target page, context or browser has been closed
```

### post-m1-p1-c3c

```text
[7/8] tests/post-m1-phase-1-settings.spec.ts:32:3 › post-m1-p1-c3c: update failure is bounded, actionable, and redacted
Error: browserType.launch: Target page, context or browser has been closed
```

### post-m1-p1-c3d

```text
[8/8] tests/post-m1-phase-1-settings.spec.ts:32:3 › post-m1-p1-c3d: provider failure is bounded, actionable, and redacted
Error: browserType.launch: Target page, context or browser has been closed
```

### post-m1-p1-c3e

```text
NOT RUN — packaged relaunch check prohibited by dispatch constraints.
```

### post-m1-p1-c4a

```text
RETAINED — apps/electron/test/electron-shell.test.mjs slice-5-c1..c5; apps/electron/test/electron-unsigned-package.test.mjs
```

### post-m1-p1-c4b

```text
# Subtest: post-m1-p1-c4b: dialog and deep-link requests are explicit fail-closed policy decisions
not ok 1 - post-m1-p1-c4b: dialog and deep-link requests are explicit fail-closed policy decisions
  ---
  duration_ms: 0.860125
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-1-host-policy.test.mjs:12:1'
  failureType: 'testCodeFailure'
  error: |-
    policy must export validateDialogRequest
    + actual - expected

    + 'undefined'
    - 'function'

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'function'
  actual: 'undefined'
  operator: 'strictEqual'
```

### post-m1-p1-c4c

```text
# Subtest: post-m1-p1-c4c: the host acquires one instance lock and routes second-instance input through policy
not ok 2 - post-m1-p1-c4c: the host acquires one instance lock and routes second-instance input through policy
  ---
  duration_ms: 0.2385
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-1-host-policy.test.mjs:23:1'
  failureType: 'testCodeFailure'
  error: 'host must acquire the Electron single-instance lock'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
```

### post-m1-p1-c4d

```text
# Subtest: post-m1-p1-c4d: every host-owned child process is tracked and terminated on shutdown
not ok 3 - post-m1-p1-c4d: every host-owned child process is tracked and terminated on shutdown
  ---
  duration_ms: 0.104209
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-1-host-policy.test.mjs:31:1'
  failureType: 'testCodeFailure'
  error: 'host must maintain an owned-child registry'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
```

### post-m1-p1-c4e

```text
NOT RUN — unsigned packaged Phase 1 host check prohibited by dispatch constraints.
```

### Playwright discovery

```text
Listing tests:
  post-m1-phase-1-navigation.spec.ts:6:1 › post-m1-p1-c2a: keyboard navigation reaches every top-level destination with stable current-page semantics
  post-m1-phase-1-navigation.spec.ts:33:1 › post-m1-p1-c2c: wide menu activation returns focus deterministically to its trigger
  post-m1-phase-1-navigation.spec.ts:45:1 › post-m1-p1-c2d: narrow overflow activation returns focus deterministically to More
  post-m1-phase-1-readiness.spec.ts:4:1 › post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes
  post-m1-phase-1-settings.spec.ts:6:1 › post-m1-p1-c3a: the theme setting persists through renderer reload
  post-m1-phase-1-settings.spec.ts:17:1 › post-m1-p1-c3b: an edited session setting persists through renderer reload
  post-m1-phase-1-settings.spec.ts:32:3 › post-m1-p1-c3c: update failure is bounded, actionable, and redacted
  post-m1-phase-1-settings.spec.ts:32:3 › post-m1-p1-c3d: provider failure is bounded, actionable, and redacted
Total: 8 tests in 3 files
```

### Playwright harness repair cap

Attempt 1, bundled Chromium headless shell:

```text
[pid=86616][err] [0815/133727.446875:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.86616: Permission denied (1100)
```

Attempt 2, installed Chrome headless channel:

```text
Error: browserType.launch: Target page, context or browser has been closed
<process did exit: exitCode=null, signal=SIGABRT>
```

Per the two-attempt cap, no further browser-launch repair was attempted. These are harness failures, not RED evidence.

### Electron unit summary

```text
1..3
# tests 3
# suites 0
# pass 0
# fail 3
# cancelled 0
# skipped 0
# todo 0
# duration_ms 57.375042
```

## Notes

- No product source or `apps/api_server/**` file was modified.
- No packaged app, Electron GUI, live spec, validation matrix command, or forbidden port was launched.
- No existing `apps/web/SHA256SUMS` entry was edited; all web additions are new files.
