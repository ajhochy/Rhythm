---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [electron-m1-slice-7-unit-1]
status: red
tags: [run, Rhythm, electron, contract, red]
---

# Electron M1 Slice 7 Unit 1 — unsigned macOS package RED contract

## Scope and contract

- Machine-readable contract: `docs/ai/contracts/electron-unsigned-package.json`
- Companion contract: `docs/ai/contracts/electron-unsigned-package.md`
- Contract tests: `apps/electron/test/electron-unsigned-package.test.mjs`
- This unit added no packaging script, build configuration, dependency, or product code.

## Exact RED command

Run from `apps/electron`:

```bash
node --test test/electron-unsigned-package.test.mjs
```

Exit code: `1`

## Verbatim RED output

```text
TAP version 13
# Subtest: slice-7-c1: one command produces the unsigned macOS app bundle
not ok 1 - slice-7-c1: one command produces the unsigned macOS app bundle
  ---
  duration_ms: 3.513334
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:24:1'
  failureType: 'testCodeFailure'
  error: |-
    slice-7-c1: apps/electron is missing the single repeatable `npm run package:mac` command
    + actual - expected

    + 'undefined'
    - 'string'

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'string'
  actual: 'undefined'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:27:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
# Subtest: slice-7-c2: packaged web assets byte-match apps/web/dist by SHA-256
not ok 2 - slice-7-c2: packaged web assets byte-match apps/web/dist by SHA-256
  ---
  duration_ms: 1.413
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:43:1'
  failureType: 'testCodeFailure'
  error: |-
    slice-7-c2: packaged artifact dist/Rhythm.app is absent; implement packaging before this packaged-only criterion can run

    false !== true

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    assertPathExists (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:135:10)
    async assertPackagedBundle (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:123:3)
    async TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:45:3)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: slice-7-c3: packaged binary registers rhythm before ready and loads the hardened agents window
not ok 3 - slice-7-c3: packaged binary registers rhythm before ready and loads the hardened agents window
  ---
  duration_ms: 0.562416
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:57:1'
  failureType: 'testCodeFailure'
  error: |-
    slice-7-c3: packaged artifact dist/Rhythm.app is absent; implement packaging before this packaged-only criterion can run

    false !== true

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    assertPathExists (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:135:10)
    async assertPackagedBundle (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:123:3)
    async TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:59:3)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: slice-7-c4: packaged live smoke reaches Live and completes a real gateway read
not ok 4 - slice-7-c4: packaged live smoke reaches Live and completes a real gateway read
  ---
  duration_ms: 0.445375
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:71:1'
  failureType: 'testCodeFailure'
  error: |-
    slice-7-c4: packaged artifact dist/Rhythm.app is absent; implement packaging before this packaged-only criterion can run

    false !== true

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    assertPathExists (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:135:10)
    async assertPackagedBundle (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:123:3)
    async TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:73:3)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: slice-7-c5: packaged binary preserves renderer isolation and fail-closed policies
not ok 5 - slice-7-c5: packaged binary preserves renderer isolation and fail-closed policies
  ---
  duration_ms: 0.367459
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:81:1'
  failureType: 'testCodeFailure'
  error: |-
    slice-7-c5: packaged artifact dist/Rhythm.app is absent; implement packaging before this packaged-only criterion can run

    false !== true

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    assertPathExists (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:135:10)
    async assertPackagedBundle (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:123:3)
    async TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:83:3)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: slice-7-c6: packaging is deterministic, gitignored, and leak-free
not ok 6 - slice-7-c6: packaging is deterministic, gitignored, and leak-free
  ---
  duration_ms: 0.318292
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:98:1'
  failureType: 'testCodeFailure'
  error: |-
    slice-7-c6: packaged artifact dist/Rhythm.app is absent; implement packaging before this packaged-only criterion can run

    false !== true

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    assertPathExists (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:135:10)
    async assertPackagedBundle (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:123:3)
    async TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/electron-unsigned-package.test.mjs:100:3)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
1..6
# tests 6
# suites 0
# pass 0
# fail 6
# cancelled 0
# skipped 0
# todo 0
# duration_ms 54.2475
```

## Why every failure is genuine RED

- `slice-7-c1` is an `AssertionError` comparing the absent `package:mac` script to the required string type. The existing `package.json` loaded successfully, so this is not a file/import/harness error.
- `slice-7-c2` is an `AssertionError` that `dist/Rhythm.app` does not exist. This is the expected missing packaged asset boundary before per-file SHA-256 parity can run.
- `slice-7-c3` is an `AssertionError` that the packaged app is absent. The test deliberately checks this before spawning anything, so it cannot silently fall back to `electron .` and is not a process `ENOENT` harness error.
- `slice-7-c4` is the same explicit packaged-artifact assertion at the live boundary. It is not skipped due to missing packaging or live infrastructure; the sandbox is healthy as recorded below.
- `slice-7-c5` is the same explicit packaged-artifact assertion at the security boundary. It does not reuse the passing Slice 5 source smoke.
- `slice-7-c6` is the same explicit packaged-artifact assertion before repeatability/cleanup checks. It is not marked manual or skipped.

The TAP summary confirms `fail 6`, `skipped 0`, `cancelled 0`, and every failure has `failureType: 'testCodeFailure'`, `name: 'AssertionError'`, and `code: 'ERR_ASSERTION'`.

## One repair loop

The initial invocation already produced six assertion failures and zero skips. One test-harness repair changed the missing-path helper from a rejected-`stat` assertion (whose diagnostics included the underlying `ENOENT`) to a direct boolean `AssertionError`. The command was then rerun once to capture the cleaner transcript above. No second repair loop and no implementation occurred.

## Sandbox status

Exact command from the repository root:

```bash
tools/dev/sandbox.sh status
```

Verbatim output:

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 98629
engine :4097 listener: 60778
gateway :4099 listener: 98629
```

The sandbox was observed only. It was not restarted, rebuilt, or stopped. Ports 4001/4096 were not contacted or managed.

## Outcome

**RED captured:** six executable criteria, six genuine failing assertions, zero skips, and no packaging implementation.

### 2026-08-15 Slice 7 Unit 3 — c6 leak closed (orchestrator-applied)

The dispatched unit hung: 44 minutes, 0% CPU, zero file writes. Cause is task-specific, not a broken
dispatch path — a `codex exec` probe returned `PROBE_OK` in seconds immediately after. Packaged
Electron launches block indefinitely when a window never closes, so the unit sat waiting. Two other
units dispatched in parallel hung the same way and were killed. This work was completed directly.

**The leak c6 missed.** c6 trusted the app's SELF-REPORTED `receipt.cleanup` counts plus git state.
It never asserted that no *persistent* Electron userData was written. Electron derives userData from
`package.json` `name`, so an un-redirected launch writes to
`~/Library/Application Support/rhythm-electron-shell` — which existed, created 08-14 16:28 during
Slice 5 and written to again during Slice 7 packaging.

AJ's live `~/Library/Application Support/Rhythm` was inspected and is UNCONTAMINATED: zero Electron
artifacts, every entry a Rhythm/agent file, `rhythm.db` being written normally by the running desktop
app on :4001. The two paths never collided because the shell's `name` is `rhythm-electron-shell`.

**Fix, applied at the shared funnel rather than per-test:**
- `packagedSmoke()` now creates a harness-owned temp userData dir per launch, passes it as
  `RHYTHM_SHELL_USER_DATA`, and reaps it in a `finally` AFTER the process has fully exited — so
  Chromium cannot recreate a directory after the app's own `will-quit` cleanup, which is the race two
  earlier repair loops lost.
- `runElectron()` in `electron-shell.test.mjs` does the same. This was a second, separate instance of
  the leak: the `--missing-dist` launch throws before `will-quit` ever fires, so the app's cleanup
  never runs and an empty temp dir survived every run.
- c6 gained two assertions independent of the app's self-report: no persistent userData before or
  after the smoke, and no stray `rhythm-electron-smoke-*` directories left in `tmpdir()`.

**Mutation proof — the assertions fail against planted leaks, so they are not decorative:**

```text
plant ~/Library/Application Support/rhythm-electron-shell/{Cache,Preferences}
  not ok 6 — slice-7-c6: stale persistent userData exists before the smoke
  # pass 5  # fail 1

plant $TMPDIR/rhythm-electron-smoke-PLANTED
  not ok 6 — slice-7-c6: packaged smoke left isolated userData directories behind
  # pass 5  # fail 1
```

**Green, clean baseline:**

```text
apps/electron npm test        11 pass, 0 fail, 0 skipped
electron-shell.test.mjs        5 pass  (Slice 5 not regressed)
electron-unsigned-package      6 pass
npm run typecheck              exit 0
parity generate + validate     6/6; sources=10868 mappings=10868 behaviors=17 review_required=689
                               sha256=94566d7b51172e4addb5cb1c361068f1f163bb26f672503f8445929c2d17f9d0
residue: temp userData dirs 0 · persistent userData absent · smoke worktrees 0 · smoke branches 0
         apps/web/test-results absent
```

Contract `docs/ai/contracts/electron-unsigned-package.json`: c1–c6 all flipped to `pass` with honest
reasons. Parity `behaviors=17` and `review_required=689` unchanged from the pre-Slice-7 baseline, so
no behavior coverage moved; row count 10,863 → 10,868 is the new packaging script and its tests.

**Slice 7 is COMPLETE.** Nothing committed; all work uncommitted on `codex/react-electron-live-suite`.
