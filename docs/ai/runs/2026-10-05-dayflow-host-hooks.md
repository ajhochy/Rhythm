---
date: 2026-10-05
repo: Rhythm
branch: feat/dayflow-desktop-host-hooks-20261005
pr: none
issues: [dayflow-host-hooks]
status: unverified
tags: [run, rhythm, electron, dayflow]
---

# Dayflow Electron host hooks

## Files

- `apps/electron/src/main.mjs` — composes the accepted Dayflow helper with a
  fixed bundled candidate, `process.arch`, and only the fixed
  `resolve(app.getPath('home'), 'Applications', 'Dayflow.app')` candidate
  when `lstatSync` reports it present. `ENOENT` omits the installed candidate;
  every other probe failure keeps it supplied so helper validation returns a
  closed result rather than falling through to the bundle. It uses a
  promisified `execFile` executor with `shell: false`. The IPC facade returns
  closed `UNAUTHORIZED` for every supplied argument and retains the existing
  `ownsDocument` main-frame policy.
- `apps/electron/src/preload.cjs` — exposes only a frozen `dayflowDesktop`
  object with zero-argument status/open methods on the two fixed channels.
- `apps/web/src/main.tsx` — adds the matching `Window.rhythmShell` bridge
  declaration with the exact ready/unavailable/unsupported status union.
- `apps/electron/test/dayflow-host-hooks.test.mjs` — synthetic VM coverage of
  real main registration, the local accepted helper dependency, and preload
  behavior. It covers absent/present/inaccessible fixed user-local candidates,
  invalid-installed no-fallback behavior, and keeps the artifact validator and
  command executor synthetic.
- `apps/electron/src/security-smoke-receipt.mjs` — adds `dayflowDesktop` in
  the exact root bridge order and requires its exact frozen two-method nested
  capability inventory. Main's receipt capture records only its keys and
  frozen state; it does not call either method.
- `apps/electron/test/security-smoke-receipt.test.mjs` and
  `apps/electron/test/electron-shell.test.mjs` — cover the signed receipt
  inventory plus the real preload object's exact frozen, zero-payload bridge.
- `apps/electron/test/{electron-shell,main-runtime,hermes-agent-bridge,hermes-desktop-install-ipc,hermes-server,issue-1579-contract}.test.mjs`
  — add only `resourcesPath: '/fixture/Resources'` and `arch: 'arm64'` to the
  eight authorized synthetic direct-main process fixtures. The five directly
  affected VM fixtures also use bounded initialization/readiness waits rather
  than assuming a single event-loop turn. Sol reproduced both first
  `main-runtime` failures on frozen R15 without Dayflow hooks, so these are
  fragile fixture timings rather than an asserted Dayflow-hook regression. No
  helper source or linker seam was added.
  The first `main-runtime` fixture waits only for its fake `Server.start()`
  invocation, then settles one event-loop turn before retaining its original
  failure-status, dialog, and shutdown assertions.

## Checks

- PASS — from `apps/electron`:

  ```sh
  node --check src/main.mjs && node --check src/preload.cjs && node --check src/security-smoke-receipt.mjs && node --experimental-vm-modules --test --test-concurrency=1 test/dayflow-host-hooks.test.mjs && node --test --test-concurrency=1 test/security-smoke-receipt.test.mjs && node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='^Dayflow preload exposes exactly' test/electron-shell.test.mjs && node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='^(e11-c6|1584: failure dialog Retry|issue-1542-desktop-c5: feature flag|Hermes supervisor output)' test/main-runtime.test.mjs && node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='^EB-9:' test/hermes-agent-bridge.test.mjs && node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='^1570-e:1 ' test/hermes-desktop-install-ipc.test.mjs && node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='^issue-1542-desktop-c5: Hermes main retains' test/hermes-server.test.mjs && node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='^issue-1579-c5: the first arm' test/issue-1579-contract.test.mjs
  ```

  Results: syntax checks passed; host hooks 6/6; receipt tests 8/8; selected
  preload test 1/1; selected `main-runtime` tests 4/4; selected
  `hermes-agent-bridge`, `hermes-desktop-install-ipc`, `hermes-server`, and
  `issue-1579-contract` VM tests 1/1 each. These are synthetic VM/preload
  checks only; no Electron binary, Dayflow validator, or native command ran.
- PASS — after the initialization-signal correction, from `apps/electron`:

  ```sh
  node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='^(e11-c6|1584: failure dialog Retry)' test/main-runtime.test.mjs && git diff --check
  ```

  Results: selected `main-runtime` tests 2/2; `git diff --check` emitted no
  errors. This rerun does not poll either asserted final failure result.
- PASS — `git diff --check` after source changes and after this run-record
  refresh.
- Sol-recorded read-only cached dependency checks from
  `../sol-typecheck-summary.json`: `node node_modules/typescript/bin/tsc
  --noEmit --pretty false` in `apps/web` exited 0. The same command in
  `apps/electron` exited 2 with 55 diagnostics: 36 in the accepted artifact
  helper, 18 in the accepted host helper, and one cascading `main.mjs`
  `options.execute` call-site diagnostic. Parent has routed the immutable
  helper JSDoc/type-only repair to its original owner; this worker did not
  alter helper types, add casts, or weaken checking.
- The first focused run deterministically exposed two test-only harness defects
  (cross-VM object-prototype comparison and a synchronous-throw assertion).
  They were reproduced, narrowed, repaired in the focused test, then the same
  command passed.
- The first attempt to run the now-composed direct-main fixtures exposed
  fragile one-event-loop-turn readiness assumptions: five fixtures read
  window/runtime state before the existing multi-await `app.whenReady()` chain
  settled. Sol's `../sol-baseline-vm-comparison.json` and
  `../sol-baseline-main-runtime.tap` reproduce both first `main-runtime`
  failures on frozen R15 main SHA-256
  `82e46714c1f1ce90095e127d087b99d26f311b6531170cff6223030b36179948`,
  without Dayflow hooks. Bounded initialization/readiness waits repair the
  synthetic harness timing only; no Dayflow-regression causality is claimed.

## Decisions

- Registration is inert: construction performs only `lstatSync` presence
  metadata on the fixed user-local candidate. No Dayflow status lookup,
  artifact validation, or open command runs at startup, rendering, or mount.
- The helper receives only main-owned candidates: the fixed user-local path
  under `app.getPath('home')` when present or presence-inaccessible, the fixed
  bundled path, and `process.arch`. It receives no environment, user-data,
  renderer metadata, renderer command, or renderer path input.
- The owner helper permits an undefined payload, so the main facade enforces
  `args.length === 0` before delegation; supplied values instead return
  `{ status: 'unavailable', code: 'UNAUTHORIZED' }`. This distinguishes no
  argument from an explicit `undefined` argument without changing any sender
  predicate or broadening authority.
- The exact Dayflow inventory is `['getDayflowDesktopStatus',
  'openDayflowDesktop']`; receipt validation rejects a missing, additional,
  misordered, or unfrozen nested object while retaining all existing root
  whitelist, version-7, Node-exposure, denial, and freeze requirements.
- The accepted local dependency manifest names
  `dayflow-desktop.mjs` SHA-256
  `05770aa87ef993ccb3c040599e9fcd679eab2aab61116836b89d5b45ceba3e88`
  and artifact helper SHA-256
  `07e1014c7bc43ae70460419e3a6f0eb0d622f9dff470bbd19c248fe801f207d3`;
  both remain excluded from this worker patch and were not edited.
- A fresh bounded GitNexus attempt, `gitnexus impact
  registerDayflowDesktopIpc --direction upstream --repo
  dayflow-host-integration-20261005/snapshot`, exited 1 because the isolated
  snapshot is an unknown repository. No index, install, rebuild, or
  redirection to another repository was attempted. Manual impact review was
  limited to candidate composition, `ownsDocument`, preload bridge consumers,
  the two channels, and the signed bridge receipt inventory.

## Limitations / next owner action

- The two accepted helper dependency files are now locally composed and were
  exercised only through synthetic VM seams; their bytes remain parent-owned
  and excluded from this worker patch.
- The read-only cached web typecheck is green. Electron typechecking remains
  blocked on the accepted immutable helper type diagnostics above; the parent
  has routed that owner repair. No dependency installation, build, signing,
  app/server launch, or UI driving was run.
- The untracked `apps/electron/node_modules` and `apps/web/node_modules`
  entries are Sol-provided read-only cached dependency links for typechecking;
  they are not worker changes and are excluded from the parent patch export.
- Full Electron synthetic suite, packaged security-smoke, normal package
  verification, and normal app acceptance remain root-owned gates.
- The repository-wide verification gate is intentionally incomplete: this
  narrow worker is prohibited from its required full issue/PR checks, build,
  server probes, and normal-app smoke. The bounded synthetic evidence above is
  not a substitute for those parent-owned acceptance gates.
- No normal app acceptance has occurred. Parent owns the final composed build
  and acceptance.
