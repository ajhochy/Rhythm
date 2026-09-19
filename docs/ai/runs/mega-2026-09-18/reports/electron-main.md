## Summary

Implemented #1496's narrow native directory picker and #1520's Rhythm icon assembly/staging. Changes are uncommitted on `mega/ws-electron-main-1520-1496`, based on `648f8d5885b1767bcb53a95c7e8aa7eadce2c5f2`.

Verification is partial: both typechecks and the web build pass. The socket-free Electron suite has 76 passes and 2 failures, both native icon conversion tests. `iconutil` also rejects a control iconset extracted from Electron's existing icon; the conversion failure is not specific to Rhythm's artwork. No app was packaged, launched, installed, or signed.

## Files changed

- `apps/electron/src/main.mjs` — owned-document/no-payload IPC handler returning a path string or null.
- `apps/electron/src/preload.cjs` — frozen bridge gains only `selectDirectory()`.
- `apps/electron/src/security-smoke-receipt.mjs` — exact bridge allowlist includes the new method.
- `apps/electron/scripts/package-mac.mjs` — exported icon assembly/staging, artwork validation, SHA-256 inventory, plist replacement, and Electron icon removal before signing.
- `apps/electron/package.json` — focused icon tests included in `test` and `test:package`.
- `apps/electron/test/electron-shell.test.mjs` — actual main/preload tests with stubbed OS boundaries; denial, cancel, selected-path, and stale-document coverage.
- `apps/electron/test/security-smoke-receipt.test.mjs` — exact capability receipt and missing-method rejection.
- `apps/electron/test/electron-icon.test.mjs` — mapping, failure cleanup, native conversion/round-trip identity, plist, and signing-order coverage.
- `apps/electron/test/electron-unsigned-package.test.mjs` — actual bundle icon metadata/artwork assertions and updated bridge allowlist.
- `apps/web/src/main.tsx` — shared optional Window bridge declaration includes the picker.
- `apps/web/src/components/SessionRail.tsx` — only Browse's disabled condition and click handler changed.
- `apps/web/tests/directory-picker.spec.ts` — five rendered cases covering live selection, manual entry, fixture fallback, cancel, and rejection.
- `apps/web/tests/directory-picker-harness.tsx` — real live-mode store/rail with intercepted host I/O.
- `apps/web/tests/directory-picker-harness.html` — test harness entry.
- `REPORT.md` — this handoff.

## Checks run

- Launch branch check and `echo ok > .write-probe && rm .write-probe` — PASS; expected branch, writable worktree; Node `v22.23.0`.
- `gitnexus impact SessionRail --repo Rhythm --direction upstream --limit 8` — LOW; one direct caller (`AgentsWorkspace`), three affected symbols, zero indexed processes.
- `gitnexus impact validateSecuritySmokeReceipt --repo Rhythm --direction upstream --limit 8` — LOW; direct caller `main.mjs`, zero indexed processes.
- `gitnexus impact interactiveRuntime --repo Rhythm --direction upstream --include-tests --limit 5` — LOW; test-file scope.
- `gitnexus impact main.mjs --repo Rhythm --file apps/electron/src/main.mjs --direction upstream --limit 5` and `gitnexus impact package-mac.mjs --repo Rhythm --direction upstream --limit 5` — LOW; zero indexed callers. Index is from September 17; local diff was separately reviewed.
- From `apps/electron`, `npm run typecheck` — PASS, exit 0; output tail: `tsc --noEmit`.
- From `apps/web`, `npm run typecheck` — PASS, exit 0; output tail: `tsc -b`.
- From `apps/web`, `npm run build` — PASS, exit 0; output tail: `1680 modules transformed`, `built in 10.14s`; bundle-size warning remains.
- Additional test-source typecheck: `node /Users/ajhochhalter/Documents/Rhythm/.mega-wt/ws-electron-main-1520-1496/apps/web/node_modules/typescript/bin/tsc -p /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-directory-picker-types-8EBt32/tsconfig.json` — PASS; `Typecheck exit: 0`. Temporary config extended the app config and included `src`, the new spec, and TSX harness; removed afterward.

From `apps/electron`, the existing suite was filtered to obey the no-socket/no-Electron-launch rule:

```sh
NODE_OPTIONS='--test-skip-pattern=slice-5-c[345]:|production.repair:.alternate.local.ports|production.repair:.actual.Electron.artifact|e11-c1:.real.bind.probe|post-m1-auth-c8:|production.repair:.OAuth|checkHealth.is.false' npm test
```

FAIL, exit 1. Output tail: `tests 78; pass 76; fail 2`. Both failures are `Rhythm icon: staged plist and artwork identity`, with `Invalid Iconset` from native `iconutil`. Log: `/private/tmp/rhythm-main-1520-1496-electron-tests.log`. The unfiltered suite was not run.

Focused non-native regressions, from the worktree root:

```sh
node --experimental-vm-modules --test --test-name-pattern='directory-picker:|signed security smoke|Rhythm icon:' --test-skip-pattern='staged plist' apps/electron/test/electron-shell.test.mjs apps/electron/test/electron-icon.test.mjs apps/electron/test/security-smoke-receipt.test.mjs
```

PASS, exit 0. Output tail: `tests 15; pass 15; fail 0`. This excludes the two failing native conversion cases; it is not a full verification pass.

Native failure control, run in a disposable directory:

```sh
iconutil -c iconset apps/electron/node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns -o /private/tmp/rhythm-icon-control-aUR07J/Control.iconset
iconutil -c icns /private/tmp/rhythm-icon-control-aUR07J/Control.iconset -o /private/tmp/rhythm-icon-control-aUR07J/Control.icns
```

Extraction PASS: all ten standard filenames. Reassembly FAIL, exit 1: `Control.iconset:Invalid Iconset`. Temporary files were removed. `file` and `sips -g all` confirmed the Rhythm sources have their expected PNG dimensions, including 1024×1024 RGBA. The precise environmental cause remains unconfirmed.

`git diff --check` and `node --check` on the packaging script, focused icon test, and unsigned package test — PASS, exit 0, no output. Playwright, dist smoke, packaging, signing, and installed-app visual checks were not run, per the worker limits.

## Acceptance criteria

| Criterion | Status and evidence |
| --- | --- |
| #1496 exact bridge method/channel | Done — frozen `selectDirectory()` invokes only `shell:select-directory`; actual-preload test passes. |
| #1496 owned native dialog; string/null only | Done — real handler passes stubbed-dialog selection/cancel/empty and security-denial tests. |
| #1496 bridge security surface | Done — exact allowlists updated; no new filesystem/proxy capability; receipt tests pass. |
| #1496 optional window type | Done — Electron, web, and new test-source typechecks pass. |
| #1496 Browse with live history; manual/fixture fallback | Partial — scoped implementation and five rendered specs written; rendered execution awaits orchestrator. |
| #1520 correct multi-resolution icon and metadata | Partial — all ten source slots validated and unit-tested; native staging cannot complete in this worker environment. |
| #1520 primary Rhythm icon; no Electron fallback | Partial — staging removes `electron.icns` and replaces plist keys; actual packaged bundle remains unverified. |
| #1520 Finder/Dock/Command-Tab/Get Info, normal/Retina | Not done — no fresh packaged/installed app was produced or inspected. |
| #1520 same release assembly before signing | Done at source level — release calls `package:mac` before `sign:mac`; ordering regression passes; no icon/resource mutation added after signing. Signature verification remains pending. |
| #1520 fail clearly on missing/invalid inputs or output | Done — missing slot/file, invalid dimensions/PNG, absent converter, missing/invalid output, and stale-output cleanup tests pass. |
| #1520 focused resource and artwork-identity regression | Partial — tests wired into both suites; inventory includes original 1024px SHA-256 and output hash; native round-trip and actual-bundle checks await successful conversion/packaging. |

## Decisions

- Reused owned-document validation before and after selection and rejected payloads; rejected a generic filesystem bridge.
- Reset branch selection after native cwd changes, matching manual entry; rejected retaining another directory's branch choice.
- Preserved SessionRail's strict edit boundary; rejected changing its adjacent helper text or tooltip.
- Promoted the existing window bridge shape to an ambient declaration; rejected duplicate picker casts at each consumer.
- Kept `iconutil` mandatory and native failures visible; rejected a custom encoder fallback or silently skipping an installed but failing converter.
- Kept work uncommitted and reporting confined to `REPORT.md`; orchestrator owns commits and shared project/dashboard records.

## Follow-ups

- Agents-tab worker: condition the existing Browse tooltip/helper text on bridge availability; it currently says browsing is unavailable even when the new picker exists.
- Orchestrator: rerun `node --test test/electron-icon.test.mjs` on its macOS runner, resolve the native conversion failure, then run full Electron tests, `package:mac`, package tests, and signature checks. Record the resulting build/commit and bundle path.
- Orchestrator: run `npx playwright test tests/directory-picker.spec.ts` from `apps/web`, plus axe and the actual Electron picker smoke.
- Orchestrator: publish the Dev Dashboard run and update shared `docs/ai` records; those writes are outside this worker's authorized scope.

## Needs a human

Final installed-app visual acceptance in Finder, Dock, Command-Tab, and Get Info at normal and Retina sizes, accounting for macOS icon caching. No passwords, signing credentials, or deployment changes were requested.
