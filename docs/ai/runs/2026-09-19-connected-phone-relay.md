---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1373, 1510, 1515, 1542, 1545]
status: pending
tags: [run, rhythm]
---

# Connected phone, desktop relay and remaining qualification

## Files

- Electron restores the saved main-process session and its validated production API base to an API child it owns. Explicit relay configuration wins, including an empty disable value. Borrowed services are unchanged. No auth-transition runtime restart, OAuth/account change, or product Keychain bypass was added.
- Mobile overflow waits for navigation interactions to finish, cancels pending opens on dismissal/unmount, and Tools respects the top safe area.
- Test repairs cover engine output readiness, isolated Hermes Keychain behavior, installed-candidate identity, native Axe transport, one-pane selection readiness, Facilities response validation, Automations mount isolation, and the real Import Next/Cancel path. Test assertions and write guards remain enforced.
- Filed [Facilities UI follow-up #1545](https://github.com/ajhochy/Rhythm/issues/1545), related to #1515 and this draft PR.

## Checks

- `cd apps/electron && npm run package:mac`: exit0. Local Developer ID signing and `codesign --verify --deep --strict` passed. The candidate at `/Users/ajhochhalter/Applications/Rhythm Mega Desktop Candidate.app` contains HEAD `1a76b097` plus the reviewed Electron/mobile/test changes in this run; the final source-bearing package identity is checked by the native attachment fixture. Hermes remains pinned to `8ea642dbb6a8b8d65868c3e7a468c471914f037b`. This candidate is not notarized/stapled.
- Graceful quit of old candidate23369 exited all37 owned processes. Standalone Hermes65704 and its Python65831 remained alive. New candidate95306 restored the same existing login/userData and started its owned API4001, gateway4002 and engine4096. Receipt `/tmp/rhythm-relay-candidate-stop.json`; package/sign/start logs `/tmp/rhythm-phone-relay-{package,sign,launch}.log`.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_RELAY_BASE=https://api.vcrcapps.com RHYTHM_LIVE_RELAY_AFTER=2026-09-20T02:12:00Z node --test apps/electron/test/desktop-relay-live.test.mjs`: **1/1 passed**. Public relay changed from `macOnline:false` with an old fingerprint to online with the local gateway's exact host, protocol fingerprint, versions and features. The uplink timestamp is after this candidate's launch boundary. Credential-free GETs only; this does not prove off-LAN operation or NAS container provenance.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_ELECTRON_PID=95306 RHYTHM_LIVE_ELECTRON_USER_DATA=<existing qualification profile> RHYTHM_HERMES_SMOKE_EVIDENCE=/tmp/rhythm-95306-read-checks node --test --test-name-pattern='desktop-c7:|desktop-c2:' apps/electron/test/hermes-desktop-native.test.mjs`: **2/2 passed**. Actual signed app restores login/signer/runtime and renders the real Hermes Desktop with a ready gateway. Native screenshot inspected at `/tmp/rhythm-95306-read-checks/native-desktop-in-rhythm.png`; no renderer/IPC errors in this check. No draft or chat submission was made.
- Electron unit suite **168/168**, typecheck passed. Root C5 `RHYTHM_LIVE_E2E=1 node --test --test-concurrency=1 apps/electron/test/hermes-desktop-ownership-live.test.mjs`: **1/1 passed** in7s (`/tmp/rhythm-hermes-c5-parent-final.log`). Mock Keychain is confined to the disposable test process; the actual endpoint, authentication and borrowed-process survival assertions run.
- Full mobile browser suite **71 passed, 1 expected skip**; unit checks **3/3**, typecheck passed; lint exit0 with four existing warnings. Physical Tools top inset and overflow/New chat flow were observed through iPhone Mirroring.
- Engine session suite **396 passed, 5 skipped, 1 todo, 0 failed**. See [readiness receipt](2026-09-19-engine-cancellation-readiness.md), committed as `1a76b097`.
- Web native-attach regressions **16/16**; latest Facilities parser, Automations remount and ListInspector fixture checks **17/17**; web typecheck passed. Fixture proof is separate from the hosted result below.
- `ai-workflow checks --level pr`: **16/16 stages passed, zero failures**. API/Flutter/MCP/fork/mobile static, unit, contract, browser and build stages completed twice as configured. Log `/tmp/rhythm-mega-pr-final-gate.log`. This automated gate does not close the failing Facilities native smoke or external release acceptance.

## Physical phone result

The existing signed development client loaded this branch's current JavaScript via Metro8081. The integration dependency symlink had produced an invalid native bundle path; replacing only that symlink with an isolated APFS clone of identical dependencies corrected the served path. Root checkout dependencies and tracked native configuration were unchanged.

iPhone Mirroring drove the actual phone: launch, Tools, live Cloud Email read, overflow, New chat, a synthetic chat response, background/reopen and deletion of the exact synthetic chat `MEGA-SMOKE-2026-09-18-PHONE-1914`. Settings reports Connected to OpenCode and a secure Mac connection through Rhythm Cloud Gateway. The selected Secretary profile replied to the synthetic prompt; no claim that it returned the requested exact token. The test chat was deleted through its own menu and confirmation and disappeared from the list.

Working sound was initially on. Off persisted through full app termination/relaunch. Root clicked it back on before refreshing the repaired connection; a final visual read-back was interrupted by repeated Mirroring scrolling/reconnect/capture errors. Audibility, active-turn sound cessation and the complete lifecycle matrix remain unverified. No other voice settings were intentionally changed.

Fresh Xcode26.5 native builds stalled before compilation in mandatory `clang -v -E -dM` probes. Samples show blocked writes into SwiftBuild-owned pipes that are not being drained. Fresh DerivedData and a single-job quiet build reproduced the stall; only owned build trees were cancelled. The existing client plus current JavaScript is not a fresh native release or TestFlight build. Logs/samples `/tmp/rhythm-phone-{current,isolated,quiet}-build.log` and `/tmp/rhythm-phone-*-sample.txt`.

## Hosted native results and cleanup

The installed candidate's source-bearing Electron, web and Hermes payloads matched the worktree package before attachment. Existing authorization was loaded only into the test process; no token was printed or entered into UI. Trace/video/screenshot retention was disabled for the credentialed hosted suite.

The last full12-test run had **7 passed, 3 skipped, 2 failed** (`/tmp/rhythm-hosted-native-fixed.log`). The final focused command was `RHYTHM_CANDIDATE_PID=95306 RHYTHM_SMOKE_LOG=/tmp/rhythm-hosted-native-final-two.log node /tmp/rhythm-run-hosted-native.mjs --grep 'creates, reads back, and deletes a marked room|paused rule create' --reporter line,/tmp/rhythm-smoke-step-reporter.cjs`: **Automations passed; Facilities failed**. Do not report a green aggregate suite.

- Automations now completes a paused-rule create/read-back/UI selection/delete cycle. Earlier all-suite failures came from keeping the old Automations component mounted while creating through the setup API; navigating away before setup allows the actual page to fetch the new row.
- Integrations follows Open → Next → Cancel and records zero writes.
- Facilities reached room and reservation create/selection in an earlier run, exposing the test's unsupported group-response shape. That parser is repaired with strict single-reservation/facility/title validation, but the final native run instead failed earlier: room POST succeeded and the marked option remained absent for5s. Cleanup deleted this invocation's room27. The remaining missing-row cause is unproven; no Facilities product change was made. The complete native write cycle remains failed.
- Messages create/delete coverage remains blocked by the deployed cleanup DELETE route. Other skips are data-dependent selection coverage; the exact report is retained in the captured run log. Skips do not count as acceptance passes.
- Final read-only audit at `2026-09-20T02:33:21.376Z`: tasks1550, facilities18, reservations310, templates1, automation rules3 and message threads7; all six authenticated collections returned200 and zero `MEGA-SMOKE-2026-09-18-` matches. Receipt `/tmp/rhythm-hosted-audit-final-phone.json`. This proves scoped collection cleanup only. Database-global marker absence remains unverified.

## Remaining qualification

The nine original native visual steps are not all closed. In particular matched light/dark comfort, full splitter/zoom/project lifecycle checks, separate Hermes plugin M3/hosted reads/ACP approval/read-back and the complete zero-write trace require their own current evidence. Normal native tab clicks hide Hermes correctly; root withdrew a speculative visibility attribution after the user challenged it. No product visibility change remains.

Current-candidate notarization, remaining installed-icon surfaces, fresh signed iOS/TestFlight matrix, physical audible audio, NAS deployed-image provenance, off-LAN relay, and database-global marker absence remain open. The local relay repair and phone response do not substitute for those gates. No production deployment, main merge, account/login change or release publication occurred.
