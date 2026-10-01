# Project state

## Current focus

Recover the OpenCode memory incident (#1603) and the interrupted Rhythm delivery workflows on one reviewed candidate while keeping installed, device, human approval, and real-provider proof separate from synthetic checks. See the [combined recovery receipt](runs/2026-10-01-memory-recovery-integration.md) and [current plan](current-plan.md).

## Active branch / PR

`codex/opencode-memory-recovery` is the active isolated integration worktree, based on draft Mega PR [#1598](https://github.com/ajhochy/Rhythm/pull/1598). Source is still being integrated and reviewed; no final frozen release SHA, merge, deploy, signed replacement app, or new TestFlight build has been established. The unrelated main checkout is outside this work.

## In progress

A1 attachment bytes/XLSX/ownership, C1/C3 manual trigger/provider error, E1 approval queue read, W6 selected-base isolated Start, M1 mobile continuation, and #1603 memory bounds are integrated or under final combined review. M1 is repairing a selected-older removal/draft-target issue found during independent review. The original approval decisions remain human-only. Final affected compatibility, draft-PR CI, installed source attribution, distribution, mobile device checks, and model-only operational validation remain.

## Risks / known issues

Full web compatibility is not green: an earlier broad slice sweep found failures in legacy fixture expectations/startup requests; targeted real E1 and C1 browser gates passed separately. Broad API had one contract fingerprint failure; focused synchronization passed 12/12, with full rerun pending. A1 synthetic provider byte transport does not establish real account vision entitlement. E1 native signed decisions and original-row readback, literal installed Org Optimize/Run Now and W6 Start journeys, and physical-device/TestFlight behavior are unverified. Retain the earlier historical red receipts and exact remaining criteria in the contracts.

## Test status

Scoped real sandbox: memory #1603 1/1 with 434,896 KiB combined peak RSS; A1 10/10 real API/engine plus isolated Postgres owner 1/1; C1 core/auth 10/10, controlled provider 401 1/1, live Chromium reconnect/reload 1/1; E1 real API/browser queue-read 1/1 and rendered 17/17; W6 real dirty-Git API/engine Start 1/1 in a combined four-test run. Final web build/dist smoke, Flutter 1,355, Electron 451 passed/4 skipped, MCP 193 passed/2 skipped, and mobile Jest 318 passed. Broad API 7,104 passed/313 skipped/1 fingerprint failure; focused repair 12/12 passed, full rerun pending. These are not full web, native, release, or account-provider passes.

## Next step

Review the combined diff and affected compatibility, freeze a single source SHA, then run same-SHA CI and installed Electron/iOS qualification. Capture exact installed component/request/origin/build before claiming the literal user journeys, and keep approval signing for a legitimate human gesture.
