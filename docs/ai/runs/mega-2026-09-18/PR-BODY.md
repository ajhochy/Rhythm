# Rhythm mega: mobile relay, unified Electron workspaces, and safe Hermes login

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

This draft unifies Electron management pages and Agent Tools around compact lists and inspectors, persistent resizable panes, native folder selection, grouped profile editing and the supervised Hermes dashboard. Mobile processing audio defaults off with lifecycle cleanup; the relay carries bounded PTY traffic and revalidates established credentials. Layout repairs preserve Messages/Facilities behavior, schedule-history selection, task metadata and Planner width.

The acceptance follow-up fixes fresh-profile Keychain probing, adds creator-only thread cleanup and guarded paused-Automation smoke, and separates desktop identity login from Google integration authorization. Both Electron and the paired Hermes fork require a login-only capability before opening OAuth. Existing provider rows are preserved by the legacy desktop exchange. The signing workflow can produce qualification artifacts without publishing a release/tag.

**Keep draft.** The public client configuration, authorized test bearer and local services are now available, and six hosted collections have zero campaign markers. Production still runs the older API. Native authenticated smoke, M3/ACP/read/draft acceptance, physical-device and remaining installed-icon gates remain separate. Exact-source ARM and Intel signing/notarization passed; Both downloaded bundles passed local trust checks; ARM native Finder/Get Info passed.

## Current verification

| Gate | Current result |
|---|---|
| Native brief | **1 PASS /9 BLOCKED**. Finder/Get Info waveform passed on the exact-source signed installed ARM package, version 0.18.65. Initial OAuth reached protected Keychain persistence; final safe client rejects undeployed login capability before browser launch. |
| Hosted browser | **7 passed /22 failed /5 skipped**. Browser Origin rejected by API CORS. No security bypass. Paused Automation API roundtrip passed and cleaned up; Messages skipped before write because deployed DELETE is absent. |
| Hosted cleanup | Six authenticated collections HTTP 200, **zero campaign-prefix rows**, including previous-run markers. Google/Gmail connected with needsReauth false. |
| Real API/engine | Hosted-write sandbox **1/1**, login-only capability/rejection sandbox **1/1**; owned fixtures removed and ports freed. Historical exact-source relay sandbox **1/1** remains distinct. |
| API | Final-source Server CI **6185 passed /253 skipped /0 failed**, plus Postgres bootstrap, supply-chain scan 15/15, build/API smoke/safety smoke. Focused OAuth 9/9, hosted writes 14/14. Earlier local PTY timeout remains a documented flake. |
| Web | Typecheck/build pass; full **460 passed /47 skipped /0 failed**; slices **155 passed /4 skipped**. Ownership 3/3 and native executable-identity 4/4. |
| Electron | Typecheck and required **176/176** pass. Source `70bcf2c9` ARM and Intel Developer ID/notarization and signed smoke passed. Both downloaded bundles pass codesign, Gatekeeper and stapler; source identity and all 10 icon artwork hashes match. ARM installation/native Finder/Get Info also passed. Both publication steps skipped. |
| Mobile | Typecheck/lint/contract pass; **32 suites/133 tests** pass, three existing lint warnings. Exact-source CI passed: 70 passed/1 skipped/1 flaky (known issue #1174 retry). Fork CI and SDK-current checks pass. |
| Hermes fork | **296/296** scoped Rhythm, packaging 62/62, loader/Settings 19/19; typecheck/build pass. Rebuilt isolated native host mounts workspace, fails unsafe login before browser, and removes backend/route/disk inventory without restarting. Installed older host unchanged. |
| Native attach harness | 12 applicable tests discovered, identity guards tested; not run because authenticated native session is unavailable. |

Earlier failures, including API timeout and fork M10 timing failures, remain in the run logs; isolated/full later success does not establish a timing fix. No acceptance assertion was loosened.

## OAuth incident and recovery

The first Hermes minimal-scope login reached the legacy deployed exchange and overwrote existing Google Calendar/Gmail access-token scope fields before its local Brotli callback failure. Both providers reported needs reauth. The attempt was stopped and disclosed. The original already-granted Google flow restored both connections without typing credentials; two read-only checks confirmed connected/needsReauth false. No email or calendar item was changed. New regression tests and the capability-gated login-only boundary prevent this on the updated server/client. The current deployed API must be updated before further M3/provider smoke.

## Remaining acceptance

- Deploy/review the additive safe-login API and creator-scoped thread cleanup through the normal release process, then complete native encrypted sign-in and rerun the nine authenticated native steps and 12 native hosted checks.
- With the rebuilt Hermes host and deployed API, verify M3 Dashboard/Tasks, actual ACP deny/allow-once/read-back, unsent draft and nonempty zero-write trace. [Fork PR #17](https://github.com/ajhochy/hermes-rhythm-plugin/pull/17) stays draft.
- Complete matched light/dark comfort acceptance, audible #1510 on physical iPhone and Electron, signed development/TestFlight device matrix, deployed NAS image-digest readback and off-LAN phone relay behavior. The paired iPhone is locked; relay health now says Mac online but does not qualify the cellular path.
- Complete installed Dock/Command-Tab and full normal/Retina visual qualification. Signed ARM Finder/Get Info pass; supported Dock inspection timed out and held switcher capture is unavailable. Both architectures are signed/notarized. Qualification-only CI is separate from release publication. Bundled Hermes payload remains NO-GO.

## Evidence and cleanup

[Final-source qualification](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/ai/runs/2026-09-19-final-source-qualification.md), [follow-up decisions and recovery](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/ai/runs/2026-09-19-mega-acceptance-followup.md), [native table](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/.proof/mega-2026-09-18/VISUAL-SMOKE.md), [hosted audit](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/.proof/mega-2026-09-18/hosted-final-audit-2026-09-19.json), [hosted-write evidence](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/ai/runs/2026-09-19-hosted-write-gaps.md), [release/device receipt](https://github.com/ajhochy/Rhythm/blob/mega/2026-09-18-mobile-electron-hermes/docs/ai/runs/2026-09-19-device-release-preflight.md).

Credentialed traces/screenshots/videos are disabled; cache/dist/test-results scan found zero bearer matches. No marker rows remain, no draft/message was sent, and only owned scratch apps/plugins/sandboxes are cleaned up. The signed ARM candidate is retained separately in user Applications, stopped; download/extraction and unauthenticated profile copies were removed. Installed Flutter/Hermes, API 4001/engine 4096, user auth and backups are preserved. Both PRs remain draft; no merge, production deployment or release publication is authorized by these local results.
