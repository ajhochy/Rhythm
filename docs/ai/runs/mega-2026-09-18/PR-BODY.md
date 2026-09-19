# Rhythm mega: relay PTY, unified Electron workspaces, and Hermes integration

Closes #1496
Closes #1511
Closes #1512
Closes #1513
Closes #1514
Closes #1515
Closes #1516
Closes #1517
Closes #1518
Closes #1519
Closes #1521
Closes #1522
Closes #1523
Closes #1524

Refs #1509 #1510 #1373 #1520 #1540 #1541 #1542 #1543

## Result

This draft unifies Electron management pages and Agent Tools around compact lists and inspectors, adds persistent resizable panes, native folder selection, grouped profile editing, and the supervised Hermes dashboard tab. Mobile processing audio defaults off with explicit opt-in and lifecycle cleanup; relay-disabled builds preserve direct pairing.

The finishing pass implements relay PTY text/binary transport, byte bounds, established credential revalidation and sanitized diagnostics. It restores Messages and Facilities behaviors lost during the layout migration, fixes schedule-history navigation, removes redundant Tasks metadata, and preserves Planner title width and density. Electron readiness tests use controlled timing with unchanged deadline assertions. A reproduced sandboxed-preview boot crash is repaired by resolving browser storage inside the preference reader's guard.

**Do not merge on local evidence alone.** Native workspace smoke is blocked at Google sign-in, hosted credentials are absent, and installed Hermes registers the Rhythm route without mounting its workspace. The bundled Hermes payload remains NO-GO; this branch uses the installed-runtime sidecar.

## Current verification

| Gate | Result |
|---|---|
| Native visual brief | **1 PASS / 0 FAIL / 9 BLOCKED**. Packaged Finder/Get Info icon passed. Sign-in reports missing `GOOGLE_DESKTOP_CLIENT_ID`; requested :4001/:4096 services absent at preflight. Hermes sidecar readiness and health 200 passed, separately from embedded UI. |
| Hosted Playwright | **0 passed / 1 setup failure / 33 did not run**. `RHYTHM_LIVE_TOKEN` absent. Six unauthenticated collection GETs returned 403. No writes occurred; global marker absence is unverified. |
| Fork operator gates | **5 PASS / 1 FAIL / 5 BLOCKED**. Install/doctor/enable and removal passed; installed CLI reload unsupported; route/M3/reads/ACP/draft/trace and cached running-host disposal unverified. Final fork suite **283/283**, packaging **62/62**. |
| API build / full tests | Build passed; **660 files / 6,180 tests passed**, 130 files / 250 tests skipped, 0 failed (`--maxWorkers=2 --silent`). |
| Real API/engine relay | Final-source **1/1 passed**: PTY echo, wrong-project 4403, second-user denial, established-device revocation 4401. Owned sandbox and fixtures removed. |
| Web typecheck / build / full Playwright | Typecheck/build passed; final **459 passed / 47 skipped / 0 failed**, exit 0 (13.1m). Production dist smoke passed. |
| Web Electron slices | Final complete manifest **155 passed / 4 skipped / 0 failed**, exit 0 after all preference repairs. Skips retain explicit live-backend gates. |
| Electron | Typecheck passed; **163/163 three consecutive runs**, plus a final **163/163** parent run. |
| Mobile | Typecheck, lint, contract check passed; **32 suites / 133 tests** passed. Three pre-existing lint warnings remain. |
| Issue-first review | All 13 Agent Tools inventoried; #1513 **8/9**, #1509 **9/11** criteria checked. Remaining criteria require native/live and subjective comparison. Focused Messages/Facilities/Projects checks **58/58** after repair. |

Earlier failures are preserved in the run records. The historical #1174 mobile full-spec rerun was 3/4, then its exact failed case passed 1/1; its unknown-cause flake remains recorded without source changes. M10's full-run failure followed by isolated success is a flake, not a fix. E21 failed alone because its wall-clock waits crossed the existing two-second poll; the repaired test asserts zero event-driven fetches and separately checks the scheduled fetch, without changing product polling. The preliminary full web run failed 34 tests and a later run retained one sandbox boot failure. The final settled-source run passed all 459 executed tests after the documented repairs.

## Remaining acceptance

- Supply the missing public desktop OAuth configuration, authorized process bearer, and requested local services; rerun all nine blocked native steps and the hosted smoke. Never enter a password/token/key into the UI. Messages writes remain skipped without a delete endpoint, and Automations writes remain skipped without an atomic paused-create path; report those gaps even after authentication works.
- Resolve the installed Hermes page-mounting blocker, then run visible M3 connection, Dashboard/Tasks reads, unsent draft, nonempty zero-write trace, and real ACP deny/allow-once/read-back on an owned disposable task. Final JSX-only package workspace rendering and running-host disposal are still open in [fork PR #17](https://github.com/ajhochy/hermes-rhythm-plugin/pull/17); every fork milestone remains a Ref.
- Complete audible #1510 checks on a physical iPhone and actual Electron candidate, TestFlight/device checks, and deployed Cloudflare/NAS revision and off-LAN relay tests.
- Complete AJ's matched light/dark reading-comfort acceptance and remaining installed icon surfaces; the Finder/Get Info proof does not establish Dock/Command-Tab/signature/notarization.
- Bundled Python/Hermes release, signing/notarization, and production deployment are separate gates. No merge or deployment occurred.

## Evidence and cleanup

- [Native visual table](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/.proof/mega-2026-09-18/VISUAL-SMOKE.md), [hosted receipt](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/.proof/mega-2026-09-18/HOSTED-SMOKE.md), [fork gate counts](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/.proof/mega-2026-09-18/FORK-GATE.md).
- [Original-issue review](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/ai/runs/2026-09-18-review-primitive-and-comfort.md), [relay gate](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/ai/runs/2026-09-18-relay-1373-finish.md), [Electron timing](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/ai/runs/2026-09-18-electron-timer-finish.md), [run record](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/ai/runs/2026-09-18-mega-mobile-electron-hermes.md).
- [Every finishing-pass decision](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/.proof/mega-2026-09-18/CHECKLIST.md#decisions).
- Owned Electron and its sidecar stopped. Hermes Desktop stayed open. Plugin install roots were removed with backups/auth preserved; the running host retains a cached native-tool row. No hosted/native product rows were created, no message was sent, and no existing user rows were modified. The final relay sandbox and synthetic fixtures were removed; its four ports were free after teardown.
- Dev Dashboard manual receipt published successfully: status `pending`, revision **4395 -> 4396**, counts-only note `1/0/9;0/1/33;5/1/5;6/0/1`.

Publication and CI: both PRs stay draft. Current remote-head checks are reported in the PR checks panel and final handoff; local gates above do not imply hosted or production qualification.
