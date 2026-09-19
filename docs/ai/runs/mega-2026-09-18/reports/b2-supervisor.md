## Summary

Implemented the additive Hermes supervisor, native consent/install logging, guarded IPC, frozen preload bridge, and lifecycle/security tests. Changes are uncommitted on `mega/ws-b2-hermes-supervisor` at base `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`.

**B3 dependency:** the installed `hermes serve` explicitly disables the dashboard and returns 404 JSON at `/`, even with a built dist. The contract documents this and the dashboard's token authentication. The required spawn command remains unchanged.

## Files changed

- `apps/electron/src/hermes-server.mjs` — injectable supervisor, discovery/version, fixed-port startup, readiness, owned shutdown, consent and private installer log.
- `apps/electron/src/main.mjs` — guarded handlers, status broadcasts, startup/quit integration, rendered bridge receipt.
- `apps/electron/src/preload.cjs` — frozen five-member Hermes bridge.
- `apps/electron/src/security-smoke-receipt.mjs` — closed Hermes capability allowlist.
- `apps/electron/package.json` — registers Hermes tests.
- `apps/electron/test/hermes-server.test.mjs` — 36 socket-free lifecycle, filesystem, preload and main IPC tests.
- `apps/electron/test/main-runtime.test.mjs` — isolates Hermes in the existing main-module fixture.
- `apps/electron/test/electron-shell.test.mjs` — isolates fixture lifecycle; rendered assertions cover Hermes keys, flag and real status IPC.
- `apps/electron/test/electron-unsigned-package.test.mjs` — packaged bridge assertions include Hermes.
- `apps/electron/test/security-smoke-receipt.test.mjs` — rejects expanded/unfrozen Hermes capabilities.
- `apps/electron/test/e12a-auth-boundary.test.mjs` — prevents real Hermes startup in this existing VM fixture.
- `docs/ai/contracts/hermes-electron-contract.md` — shared contract, source-backed dashboard/auth findings, B3 placeholder.
- `REPORT.md` — this report.

## Checks run

All commands ran in this worktree; Electron commands below ran from `apps/electron`.

- `npm run typecheck` — **pass**, exit 0; tail: `tsc --noEmit`. The initial missing `version` annotation was fixed.
- `node --experimental-vm-modules --test test/hermes-server.test.mjs` — **pass**, exit 0; tail: `tests 36; pass 36; fail 0; cancelled 0`. Earlier installer-stream cleanup and macOS realpath fixture failures were fixed.
- Socket-free package suite — **pass**, exit 0; tail: `tests 99; pass 99; fail 0; cancelled 0`:

```sh
node --experimental-vm-modules --test --test-concurrency=1 --test-skip-pattern='real bind probe|slice-5-c[1345]|post-m1-auth-c8|production repair: (alternate local ports|actual Electron|OAuth)' test/agent-server.test.mjs test/hermes-server.test.mjs test/agent-server-ownership.test.mjs test/artifact-frame-protocol.test.mjs test/electron-shell.test.mjs test/google-oauth.test.mjs test/human-approval-isolated-home.test.mjs test/human-approval-main-signer.test.mjs test/main-runtime.test.mjs test/post-m1-phase-1-host-policy.test.mjs test/post-m1-phase-7-native-notifications.test.mjs test/post-m1-phase-7-packaged-notifications.test.mjs test/post-m1-phase-8-artifact-policy.test.mjs test/production-api-security.test.mjs test/runtime-config.test.mjs test/security-smoke-receipt.test.mjs
```

- The first package run used the same command/file list with `--test-skip-pattern='real bind probe|slice-5-c[345]|production repair: (alternate local ports|actual Electron)'` — **fail**, `tests 100; pass 97; fail 3`. One case needed absent `apps/web/dist/index.html`; two OAuth tests indirectly attempted binds, rejected with `listen EPERM: operation not permitted 127.0.0.1`. No listener opened. The final exclusions account for these cases. Logs: `/tmp/rhythm-hermes-electron.log`, `/tmp/rhythm-hermes-electron-final.log`.
- `node --experimental-vm-modules --test test/e12a-auth-boundary.test.mjs` — **fail**, twice: `tests 10; pass 9; fail 1`. E44: `Cannot read properties of undefined (reading 'bridge')` before a fixture window exists.
- `node --experimental-vm-modules --test --test-name-pattern='E44:' test/e12a-auth-boundary.test.mjs` — **pass**, `tests 1; pass 1; fail 0`. The suite's fixed 20-turn startup wait remains a follow-up.
- `git diff --check` — **pass**, exit 0, no output.
- `gitnexus impact rebuildMainWindow --direction upstream --repo Rhythm --file apps/electron/src/main.mjs` — LOW, 0 impacted, 0 affected processes.
- `gitnexus impact runtimeValue --direction upstream --repo Rhythm --uid Function:apps/electron/src/preload.cjs:runtimeValue` — LOW, 1 impacted, 0 affected processes.
- `gitnexus impact validateSecuritySmokeReceipt --repo Rhythm --direction upstream --file apps/electron/src/security-smoke-receipt.mjs` — LOW, 1 impacted, 0 affected processes.
- `gitnexus impact createHermesSupervisor --direction upstream --repo Rhythm --file apps/electron/src/hermes-server.mjs` — unavailable: new symbol not indexed.
- `gitnexus detect-changes --scope unstaged --repo Rhythm` — `Changes: 9 files, 11 symbols; Affected processes: 0; Risk level: low`. Untracked new files are outside this indexed result.

Unfiltered `npm test`, Electron/Playwright launches, live Hermes startup and packaged smoke were **not run** under the worker restriction. No dependency installation, commit, stash, checkout, rebase or other-worktree edit occurred. Full behavioral verification remains pending.

## Acceptance criteria

- Flag default ON; OFF suppresses all supervisor activity and exposes disabled status — **done**, focused flag/preload/main tests. Sidebar rendering belongs to B3.
- Fixed default 9121, no roaming, busy-port failure — **done**, conflict tests, including a post-probe child bind failure.
- Required module exports, methods and Status shape — **done**, typecheck and lifecycle tests.
- Login-shell discovery, fallback, version and conditional `--skip-build` — **done**, exact-argument and real-filesystem wrapper/symlink tests.
- HTTP readiness, bounded timeout and last 50 stderr lines — **done**, response/timeout tests; diagnostics redact credential-like text.
- Owned SIGTERM → 3 s grace → SIGKILL; quit integration — **done**, short-grace tests and main shutdown-wait test. Live OS behavior remains unverified.
- Native consent, exact official installer command, Cancel default, log then re-resolve/start — **done**, consent, cancellation, failure, shell-argument and 0600 log tests.
- Exact IPC/preload names, unsubscribe, all-window status broadcasts, no token bridge — **done**, real-main/preload VM and security receipt tests.
- Shared contract and dashboard URL/auth investigation — **done**, source references and `View + intents` placeholder in contract. Dashboard usability through `serve` is **not available** in the installed Hermes source.
- Required local validation — **partial**, typecheck and 99 permitted package tests pass; full suite/live/rendered checks require the orchestrator. Additional E44 fixture failure is recorded above.

## Decisions

- Kept `hermes serve` exactly; rejected silently switching to `dashboard` despite the discovered UI incompatibility.
- Treated every HTTP response, including headless 404, as listening; rejected equating `ready` with dashboard usability.
- Rejected port 9119 and invalid/ephemeral ports; retained fixed-port failure rather than roaming or adopting an existing server.
- Preserved non-owning smoke modes; rejected incidental Hermes startup from fixture/smoke runs.
- Kept authentication and installer output out of IPC; rejected token extraction or an arbitrary proxy for B3.
- Added test-only OS/timing seams and native consent options; rejected real server/installer execution in unit tests.
- Kept shared project-state and Dev Dashboard writes with the orchestrator under this worker's scope restriction.

## Follow-ups

- B3/orchestrator: reconcile dashboard embedding and authentication with installed headless `serve` behavior; prebuilding `web/dist` alone cannot enable the UI. Actual dashboard default assets are `hermes_cli/web_dist`.
- Orchestrator: build web assets, run unfiltered `cd apps/electron && npm test`, rendered/package checks, and live ownership/shutdown checks on 9121.
- Existing auth fixture: replace the fixed 20 `setImmediate` turns at `apps/electron/test/e12a-auth-boundary.test.mjs:69` with a reliable startup signal; E44 passes alone but failed in both suite runs. Only Hermes isolation was changed here.
- Orchestrator: publish the Dev Dashboard run and canonical project/run records during integration; refresh the GitNexus index for the new module.

## Needs a human

None for the remaining B2 code handoff. No credentials, signing or deployment requested.
