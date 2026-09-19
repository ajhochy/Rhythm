# Rhythm — Project State

## Focus and branches

Finish the 2026-09-18 mega draft with honest native, hosted, sandbox, and local evidence. Branch `mega/2026-09-18-mobile-electron-hermes`: [PR #1544](https://github.com/ajhochy/Rhythm/pull/1544). Fork `mega/2026-09-18-rhythm-plugin-finish`: [PR #17](https://github.com/ajhochy/hermes-rhythm-plugin/pull/17), pushed at `c5c9c1e17b`. Both remain draft; no merge/deployment.

## Changes and gates

Relay PTY, bounded buffering, device/uplink credential freshness, and sanitized diagnostics are implemented. Shared-inspector review repaired Messages/Facilities preservation, schedule history selection, task metadata, and Planner sizing. Electron readiness is deterministic: 163/163 three consecutive runs plus final parent pass. Mobile: 32 suites/133 tests, typecheck/lint/contract green (three existing warnings). Fork: 283/283, packaging 62/62; only the reproduced host JSX incompatibility is repaired.

Final API: 660 files/6,180 tests passed, 250 tests skipped; build passed. Exact-source relay sandbox: 1/1 passed and teardown complete. Final web: 459 passed/47 skipped/0 failed with typecheck/build/dist smoke green. Final Electron slice manifest: 155 passed/4 skipped/0 failed. The sandbox preference boot/save repair has 3 unit and 14 focused rendered passes. See [finish PR body](runs/mega-2026-09-18/PR-BODY.md) and [run record](runs/2026-09-18-mega-mobile-electron-hermes.md).

## Blocking acceptance

- Native brief: 1 pass (packaged Finder/Get Info icon), 9 blocked at missing `GOOGLE_DESKTOP_CLIENT_ID`. Requested local :4001/:4096 were absent. Sidecar health 200 does not establish embedded UI behavior.
- Hosted suite: no `RHYTHM_LIVE_TOKEN`; 1 setup failure, 33 not run. Six collection GETs returned 403. Zero rows created here; global marker absence unverified.
- Installed Hermes registers `/rhythm` but mounts no workspace. M3, hosted reads, draft, ACP and zero-write trace remain blocked. CLI reload is unavailable. Both plugin installs were removed; backups/auth preserved, but running-host native registrations remain cached. Exact final JSX-only package was reinstalled and its route created an element successfully, but mounted no workspace.
- #1513 review 8/9 and #1509 9/11: native/live and subjective acceptance pending. Physical #1510 audio, TestFlight/device, Cloudflare/NAS deployment and off-LAN relay checks remain open. Bundled Hermes payload remains NO-GO.

## Next acceptance boundary

Local gates are complete. Publication and exact remote-head CI are recorded on the draft PRs; neither branch is a deployment. Restore missing runtime/auth prerequisites and resolve the installed-host route before rerunning blocked acceptance. Preserve the running Flutter/Hermes apps and user data. Full decisions and cleanup: [checklist](../../.proof/mega-2026-09-18/CHECKLIST.md).

The #1174 isolated mobile spec reproduced an intermittent terminal-menu timeout (3/4); the failed case passed alone (1/1). The flake remains unmodified, as does the earlier M10 timing flake.
