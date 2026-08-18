---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-1]
status: pass
tags: [run, Rhythm]
---

# Post-M1 Phase 1 Electron host trust

## Files

- `apps/electron/src/policy.mjs` — added fail-closed deep-link validation and the pure argv funnel.
- `apps/electron/src/main.mjs` — added the single-instance lock and shared `second-instance`/`open-url` routing.
- `apps/electron/test/post-m1-phase-1-host-policy.test.mjs` — replaced weak source predicates with behavioral policy/funnel assertions and one Electron-binding source assertion.
- `docs/ai/contracts/post-m1-phase-1.json` — marked deep-link and single-instance criteria pass; split absent dialog and child-process surfaces into `not_tested` criteria.

## RED

Command:

```text
cd apps/electron && node --test test/post-m1-phase-1-host-policy.test.mjs
```

Verbatim output:

```text
TAP version 13
# Subtest: post-m1-p1-c4b: dialog and deep-link requests are explicit fail-closed policy decisions
not ok 1 - post-m1-p1-c4b: dialog and deep-link requests are explicit fail-closed policy decisions
  ---
  duration_ms: 1.77625
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
  stack: |-
    TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-1-host-policy.test.mjs:15:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
# Subtest: post-m1-p1-c4c: the host acquires one instance lock and routes second-instance input through policy
not ok 2 - post-m1-p1-c4c: the host acquires one instance lock and routes second-instance input through policy
  ---
  duration_ms: 0.42425
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-1-host-policy.test.mjs:23:1'
  failureType: 'testCodeFailure'
  error: 'host must acquire the Electron single-instance lock'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-1-host-policy.test.mjs:26:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: post-m1-p1-c4d: every host-owned child process is tracked and terminated on shutdown
not ok 3 - post-m1-p1-c4d: every host-owned child process is tracked and terminated on shutdown
  ---
  duration_ms: 0.216833
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-1-host-policy.test.mjs:31:1'
  failureType: 'testCodeFailure'
  error: 'host must maintain an owned-child registry'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-1-host-policy.test.mjs:34:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
1..3
# tests 3
# suites 0
# pass 0
# fail 3
# cancelled 0
# skipped 0
# todo 0
# duration_ms 78.646042
```

## GREEN

Command:

```text
cd apps/electron && node --test test/post-m1-phase-1-host-policy.test.mjs
```

Verbatim output:

```text
TAP version 13
# Subtest: post-m1-p1-c4b: deep-link requests are explicit fail-closed policy decisions
ok 1 - post-m1-p1-c4b: deep-link requests are explicit fail-closed policy decisions
  ---
  duration_ms: 0.95025
  type: 'test'
  ...
# Subtest: post-m1-p1-c4c: the host acquires one instance lock and routes second-instance input through policy
ok 2 - post-m1-p1-c4c: the host acquires one instance lock and routes second-instance input through policy
  ---
  duration_ms: 0.468792
  type: 'test'
  ...
1..2
# tests 2
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 91.825291
```

## Notes

- GitNexus reported LOW upstream impact for `validateRequest`: three direct consumers and no affected execution processes. Its behavior was not changed.
- The orchestrator must run the Electron shell/package suites and an actual two-launch check; this unit did not launch Electron or any GUI application.
- OS-level URL-handler registration remains absent by scope. Until `setAsDefaultProtocolClient`/`CFBundleURLTypes` lands, OS-delivered deep links cannot reach the app; only CLI/argv-delivered URLs exercise the funnel.
- The host owns no child processes, so `post-m1-p1-c4d` re-opens only when Electron takes over local API/engine spawning like Flutter's `ApiServerService`.
- The host calls no `dialog.*` API, so `post-m1-p1-c4b-dialog` re-opens on the first native-dialog call.
