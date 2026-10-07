# Project state

## Current focus

Shipping the mobile transcript fix to both ends. Mega @ 237f54db (merge of
integration/2026-10-07-combined + investigate) carries: engine `File.status` bound +
HOME-watcher skip, api_server mirror bound, combined integration, mobile contract
`dbe19d8f…`. TestFlight 1.0.9 (22) built from 237f54db (EAS 224c9c46, auto-submitted).
A signed desktop candidate from the same commit is staged locally; the GitHub Electron
release (0.18.70) needs two packaging-contract test fixes on mega (commit after 237f54db)
and is blocked on GitHub push errors at the time of writing.
## Active branch / PR

Product source `31ff93b13d01eb228e6c2f269f2239a66ff6b811` is on the existing draft [PR #1598](https://github.com/ajhochy/Rhythm/pull/1598), integrated from the Mega branch through `codex/opencode-memory-recovery`. Any following receipt commit changes documentation only. Both client artifacts were built from 31ff. No merge or production API deployment occurred.

## In progress

- #1609: teach `electron_release.yml` to obtain the native Dayflow artifact.
- AJ's own phone smoke on build 22 against the swapped Mac.
## Risks / known issues

The broader legacy web suite is not green; its scoped receipt preserves those failures. Native exact-byte PNG/workbook transport passed for two real providers, but installed JPEG selection and attachment replay/error UI were not checked. Sol reversed two image quadrants; Sonnet answered correctly. Model assignments stayed unchanged. Original approval cards are visible and undecided; native read-only refresh did not exercise creation, mount/reconnect, transcript association, or post-decision behavior from the full E1 contract. Read-only native inspection maps the existing operational Org Self-Optimizer row to the same outer Agent Schedules Trigger now control exercised on the disposable fixture; historical “Org Optimize” wording differs. No operational POST was sent or Hermes Cron triggered. The observed memory tests do not reproduce the user-reported 50 GB peak.

## Test status

Product 31ff passed six exact-head CI checks; final serial API: 7,115 passed/311 skipped; Flutter: 1,356 passed, format/analyze passed; API and web builds/typechecks passed. Signed/notarized/stapled Electron 0.18.69 passed scoped native Start, manual profile routing, attachment, schedule and read-only approval checks. Native engine RSS peaked at 950,848 KiB over five minutes and measured 608,528 KiB after cleanup at about 21 minutes uptime.

Independent cleanup verified five sessions and their engine records, two worktrees/branches, two profiles, one schedule and one project removed. Scratch state and all 54 original profiles/33 schedules are unchanged. Three unpinned artifact metadata rows sharing one storage key await normal retention.

## Release sequencing (2026-10-07)

1. TestFlight 1.0.9 (22) processes (monitor: `~/Documents/Codex/2026-10-07/testflight-build/monitor.log`).
2. AJ installs it on his phone.
3. Immediately swap the Mac: `~/Documents/Codex/2026-10-07/swap-to-mega-desktop.sh` (quits the
   7d073feb build, launches the mega candidate on the normal profile; the `.command` launcher
   then points at it). Verify on the simulator (merged-head app already installed there).
4. Only then is `/Applications/Rhythm.app` worth replacing (still the signed-out profile caveat).
Doing 3 before 2 locks the phone out ("incompatible agent protocols") until 2 happens.

## Next step

Human review of the existing draft PR and the distributed candidates can proceed using the recorded scope and remaining native/device checklist. Keep physical-device testing explicitly unrun until available. Preserve manual merge and original approval decisions.
