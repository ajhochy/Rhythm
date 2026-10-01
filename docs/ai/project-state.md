# Project state

## Current focus

Finish the installed manual WebSocket profile-identity repair and same-source delivery checks for the OpenCode memory recovery and interrupted workflows. The [combined recovery receipt](runs/2026-10-01-memory-recovery-integration.md) records earlier slices; the [installed WS repair receipt](runs/2026-10-01-installed-ws-profile-identity.md) records the new native gap and scoped fix.

## Active branch / PR

`codex/opencode-memory-recovery` is the isolated integration branch for draft [PR #1598](https://github.com/ajhochy/Rhythm/pull/1598). The last pushed candidate was 22df3b3a; the manual-input repair is under final checks before a new commit, push, CI, and replacement signed builds. No merge or production deployment has occurred.

## In progress

The WebSocket input guard now uses canonical Rhythm profile identity separately from its OpenCode engine agent. Web and Flutter producers send the selected profile ID explicitly; focused source, isolated API/engine, rendered browser, Flutter, and final API build checks passed. The final serial API suite, exact-head CI, signed Electron 0.18.69, and iOS build 17 qualification remain. Original approval decisions remain human-only; model-only profile reassignment has not occurred.

## Risks / known issues

Installed 0.18.68 still has the old native `agent disabled: 'build'` manual-input failure and cannot qualify the repair. A pre-final full API run mixed source states and was invalidated after one agent-less failure. Sol 6.1 text serving and a separate Sonnet image/workbook API preflight do not establish native picker behavior or Sol vision entitlement. Installed C1 Run Now, E1 read-only approval visibility, and W6 selected-base checks are scoped to their old-source receipts; native approval signing, physical iPhone/TestFlight behavior, and final-source installed continuation remain unverified.

## Test status

New repair: API focused 19/19, isolated real API/engine 1/1, rendered browser 1/1, Flutter full 1,356 pass, final API build pass, web build/typecheck pass, Flutter format/analyze pass, and diff check pass. The final serial full API suite was still running at this snapshot; the earlier interrupted run is not a pass. The prior 22df3b3a candidate had exact-head CI and canonical PR checks pass, but those do not transfer to the changed source. Earlier A1/C1/C3/E1/W6/M1/#1603 results remain in their scoped contracts and receipts.

## Next step

Finish the serial API gate, review the final diff, commit and push one new source SHA to draft PR #1598, and await exact-head CI. Rebuild and install Electron 0.18.69 from that SHA, repeat the manual WebSocket input and affected native journeys, then qualify the same-source iOS build 17 and existing internal TestFlight group. Keep release, approval, and model-entitlement claims tied to their actual observed surfaces.
