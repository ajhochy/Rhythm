---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1542]
status: local-candidate-tested
tags: [run, rhythm]
---

# Hermes Desktop replacement

Latest result: actual Desktop is open in the signed local mega candidate, with the requested outer header removed. Native read/draft/tools suite 6/6, real restart draft proof and API/engine reuse passed. Borrowed Hermes backend qualification remains partial after repeated renderer-load hangs. The whole-repository gate is red on engine/mobile failures. Full distribution, full standalone UI coexistence and original mega hosted/device gates remain open. Earlier checkpoints below are historical; current limitations are recorded in the final sections.

## Files
- Main plan: ../plans/2026-09-19-hermes-desktop-in-rhythm.md
- Shared parallel contract: ../plans/2026-09-19-hermes-embedded-interface.md
- Acceptance: ../contracts/issue-1542-desktop.json
- Parent native smoke: apps/electron/test/hermes-desktop-native.test.mjs

## Checks
- Initial fork worktree is isolated at /Users/ajhochhalter/Documents/hermes-rhythm-plugin/.worktrees/desktop-embedded on codex/hermes-desktop-embedded, base9c8dcf4230. Dirty source in the original fork checkout was left untouched.
- Actual standalone Hermes Desktop inspected via native accessibility. Real session sidebar, profiles, native controls and Gateway ready observed. Local reference screenshot: /tmp/rhythm-hermes-desktop-reference/standalone.png. This is reference evidence, not the replacement.
- Node native-smoke discovery ran with live flag off: tests skipped as designed. No runtime PASS is claimed.
- Terra agents own native host, renderer/build, and Rhythm integration. Parent owns test review, real installed smoke and commits.

## Notes
- Corrected user requirement supersedes the original browser-dashboard contract.
- Preserve c92c7544 working login, approval signer and API/engine reuse/start fixes.
- First host sketch was incomplete for Desktop native commands; review requires shared runtime extraction before completion.
- Initial checkpoint: no replacement GUI launch or source push had occurred. See the final checkpoint below for current results.

## Integration review checkpoint
- Electron is aligned to exact 40.10.2, matching Hermes Desktop and its native addons. The old Rhythm Electron 33 process reported Node 20 without global WebSocket.
- Parent ran Electron `npm test`: 158/159; E44 failed because the auth harness returned before initial window setup. The worker reproduced the race, replaced bounded tick polling with an explicit initialization signal, and is checking window replacement behavior. This initial result is not a final gate.
- Parent web `npm run typecheck`: exit 0. Native smoke discovery remains 4 skipped with live opt-in unset.
- Review required scoped native window/session adapters, real remote/profile/SSH routing, owned-resource disposal, preserved tab drafts, microphone permission and package metadata, and safe standalone-update handling. These are active integration gates, not unit-test substitutes.
- Hidden Electron 40 startup probe prepared at `/tmp/rhythm-hermes-native-probe/probe.cjs`. Actual packaged smoke captures both child renderer and complete native window screenshots.

### First actual Electron startup probe
- Replaced only the integration worktree's `apps/electron/node_modules` symlink with an isolated `npm ci`; the root checkout's Electron 33 dependencies are untouched. The executable now reports Electron 40.10.2 / Node 24.15.0 / global WebSocket function.
- Ran the actual Electron executable with `/tmp/rhythm-hermes-native-probe/probe.cjs` and the current dirty fork artifact. Import, native host creation, and renderer load completed; 16 trusted boot IPC calls were rejected before `did-finish-load`, UI did not become ready, and the probe exited 1.
- Diagnosis: registrar revoked at navigation start but only reauthorized after load completion; preload/React invokes native capabilities after document commit and before that completion event. Native worker is repairing this timing boundary with a regression test. Local probe log: `/tmp/rhythm-hermes-native-probe/probe.log`.

### Native integration probes 2–6
- Probes 2–3 isolated a real HashRouter navigation after document commit: Electron reports `isInPlace=true`, which must not revoke the trusted main document. The registrar now distinguishes this from a new document.
- Probe 4 displayed the actual Desktop sidebar/preload. Its screenshot attempt failed because the harness intentionally used a hidden window; full-window screenshots remain required against the visible signed candidate.
- Probe 5 started a real owned Hermes backend but failed connection IPC because the host returned its `stop` function. Ownership callbacks now remain in the main process; the shared runtime receives a cloneable normal Desktop connection. Disposal removed the probe-owned port.
- Probe 6 (`env -u ELECTRON_RUN_AS_NODE RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR=<fork>/apps/desktop/build/rhythm-embedded <integration>/apps/electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /tmp/rhythm-hermes-native-probe/probe.cjs`) exited 0. Actual renderer API returned mode `local`, a base URL, Hermes version `0.20.5`, and six saved sessions. This is a startup/read checkpoint, not signed Rhythm acceptance.
- Probe 6 log `/tmp/rhythm-hermes-native-probe/probe-6.log` still exposed expected-absent optional plugin entry files as IPC errors and renderer polling during teardown. Both remain repair work before the signed candidate. A macOS trust-store certificate parse message also appeared; no user certificate store was changed.
- Review additionally caught standalone external-link registration and dialog-parent shadowing regressions; workers repaired them with targeted behavior tests. Missing-runtime first-run fallback, provided Hermes home, connection-origin revocation and auxiliary session disposal are under final review.
- Parent ran the artifact builder tests with Vitest (`npx vitest run --project electron scripts/build-embedded-artifact.test.mjs`): 2/2. An initial direct Node invocation was a runner error (the file imports Vitest), corrected without product changes.
- The standalone `find-in-page-native` fixture is an Electron entrypoint, not a Vitest test. Parent ran it with integration's real Electron 40 executable: exit 0. The isolated Hermes dependency has no downloaded Electron `dist`; using the verified integration executable avoids attributing a missing binary to product behavior.
- Parent added a native smoke assertion that the actual Rhythm-hosted Desktop region is at least 300 by 300 CSS pixels. Review found and worker repaired the missing flex growth after removal of the dashboard inspector layout.

### Clean local candidate
- Fork source includes the latest existing plugin-exchange repair (base `9fa78bcba1`) and is committed locally as `397adfb4d7885ae968f18986d206d6936efab178`. No push yet.
- `npm run build:rhythm-embedded` exited 0 on that clean source; 400 files were measured. Rhythm rejects dirty, corrupted and mismatched-revision artifacts, and its source pin now names that exact commit.
- Parent checks: Electron 163/163; web and Electron typechecks exit 0; fork Electron 1511 passed / 2 skipped; affected renderer tests 55/55. The two skipped fork tests are retained platform gates, not native app proof.
- GitNexus `detect-changes --scope all`: 16 tracked files, 124 symbols, low risk, zero affected indexed processes. New untracked artifact and test files are separately reviewed by diff; the graph result does not cover those new files.
- Package checks are running; signed visible candidate and real user-path acceptance remain pending.

### First signed visible candidate
- Package suite: 22 passed, one failed (repeatability), one skipped (separately gated live test). Failure compared complete app hashes; only the engine and resulting outer signature differed. Exact engine rebuild with frozen models catalog SHA `7f01922062d6af15184f98e2ec2c63ccdbd959f25e665fb17723b100b5f237b2` reproduced engine SHA `1855063d579c18a35d7e09871a91d865d54bc1336ca726eec58e9dece74648f7`. The harness now freezes that mutable external input for the repeat build; full byte equality is retained.
- Copied candidate outside the repository to `/Users/ajhochhalter/Applications/Rhythm Mega Desktop Candidate.app`; Developer ID nested/outer signing and strict deep verification succeeded. No notarization claim.
- Gracefully stopped only prior Rhythm PID30576. Its owned API4001, engine4096 and dashboard9122 listeners exited. Candidate PID7391 launched from clean `/usr/bin:/bin:/usr/sbin:/sbin` PATH using the existing userData/login; it started API and engine successfully without approval-helper dialogs. Existing provider/approval notices remain outside this Hermes replacement and prohibit an all-errors-cleared claim.
- First native suite: draft/tab persistence passed. Profiles/history assertions ran before readiness and were strengthened to wait for visible ready state. Context reached actual composer but failed the zero-renderer-error assertion because Google Fonts CSS was blocked. CDP identified `https://fonts.googleapis.com/css2`; a narrow stylesheet/font-only policy repair is now in source. No assertion was removed.
- Actual Desktop screenshot: `/tmp/rhythm-hermes-desktop-smoke-candidate/current-desktop.png`. This shows the real Desktop sidebar, composer, model/profile controls and Gateway ready. It is not a final complete acceptance result.

### Native feature checks and final rebuild
- Parent full Electron suite: 164/164, typecheck passed. Package suite after freezing the fetched models catalog: 23 passed, 0 failed, one explicitly gated sandbox-live test skipped; complete repeated app manifests matched. Log `/tmp/rhythm-hermes-package-final.log`.
- Actual Developer ID candidate: public preload checks confirmed restored authenticated Rhythm session, functioning Keychain approval capability and ready local runtime. `RHYTHM_LIVE_E2E=1 node --test apps/electron/test/agent-server-live.test.mjs` passed 1/1: reuse/disconnect preserved real engine PID and boot ID and API profiles.
- `issue-1542-desktop-c8` native tools test passed against signed PID7391: real file read/write, native Git status, actual node-pty shell execution and camera permission denial. All writes stayed in its automatically removed synthetic git directory.
- Native computer-control: Cmd+O opened the macOS picker and selected a disposable git workspace; Cmd+J and double-click rendered its README, and Cmd+G showed the real added line in Git diff. Settings and seven Desktop/five backend plugins rendered.
- A separate authorized synthetic prompt used no tools. `20260919_164541_10d847` streamed RHYTHM_STREAM_OK, continued during Dashboard/Hermes navigation, and Stop restored normal composer controls. Backend read-back contains user+assistant, 7210 assistant characters and zero tool calls. This explicit synthetic send is separate from read/draft zero-send checks.
- Visible Browser failed because its actual initial about:blank guest had been rejected. The fork now permits only that inert bootstrap; Rhythm guards page/frame/redirect/programmatic navigation afterward. Parent caught and corrected Electron40 event-object handling during review. Native final browser test remains pending in this checkpoint.
- User requested removal of the entire outer Hermes header/action/status strip. Removed it while retaining the accessible workspace region and native draft-intent interface; no replacement toolbar added.
- Final clean fork source is `8ea642dbb6a8b8d65868c3e7a468c471914f037b`, with 403 integrity-covered artifact files, including root and staged native licenses. Final Rhythm package built successfully. Parent native-host/artifact tests passed 16/16.
- Graceful quit of PID7391 exited every recorded owned descendant, including API7509, engine7552 and Hermes8617/port53998. No recorded owned orphan remained. The new candidate was copied outside both repos for Developer ID signing and relaunch.

### Final signed local validation

- Final product source: Rhythm integration working tree based on `25c5f4b2`, preserving startup/login repair `c92c7544`; Hermes artifact pinned to clean `8ea642dbb6a8b8d65868c3e7a468c471914f037b`. Product files were built and inspected before commit/push.
- `cd apps/electron && npm test && npm run typecheck`: **165/165**, typecheck exit 0 (`/tmp/rhythm-hermes-persistent-unit.log`, `/tmp/rhythm-hermes-persistent-types.log`). Focused host/artifact **17/17**. Fork shared Electron **1511 passed /2 skipped**, affected renderer **55/55**, actual find-in-page Electron fixture exit 0.
- `cd apps/web && RHYTHM_E2E_PORT=4383 RHYTHM_DIST_PORT=4384 npx playwright test tests/pages/hermes.spec.ts --workers=1`: **5/5**. Initial fixture run 2/5 exposed StrictMode double attachment assumptions; fixture failure outcomes now remain failed through both initial effects, and Retry is explicit. Shell fixture evidence is separate from native proof.
- `cd apps/electron && RHYTHM_HERMES_DESKTOP_ARTIFACT_DIR=<pinned fork>/apps/desktop/build/rhythm-embedded GOOGLE_DESKTOP_CLIENT_ID=<public configured client> npm run package:mac`: exit 0. Candidate copied to `/Users/ajhochhalter/Applications/Rhythm Mega Desktop Candidate.app`, signed with existing Developer ID identity, nested/outer strict verification exit 0. Logs `/tmp/rhythm-hermes-persistent-package.log`, `/tmp/rhythm-hermes-persistent-sign.log`.
- Final native command: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_ELECTRON_USER_DATA=<existing qualification profile> RHYTHM_LIVE_ELECTRON_PID=23369 RHYTHM_HERMES_SMOKE_EVIDENCE=/tmp/rhythm-hermes-desktop-persistent-smoke node --test apps/electron/test/hermes-desktop-native.test.mjs`: **6/6**, no Desktop renderer/IPC errors or chat sends during this read/draft/native-tools phase. Log `/tmp/rhythm-hermes-native-persistent-tests.log`.
- Native screenshot `/tmp/rhythm-hermes-desktop-persistent-smoke/native-desktop-in-rhythm.png` inspected: actual Desktop fills the tab, outer title/action/status strip absent, live API4001/engine4096 and Gateway ready. Other screenshots cover saved transcript, tab navigation and scoped unsent context.
- Actual Browser panel now attaches inert about:blank then displays a controlled HTTP page headed “Rhythm Hermes browser preview works”. Verified by native accessibility in signed PID97387 after browser fix. Closed the test tab and stopped only the temporary static HTTP server afterward.
- Review found the random in-memory Electron partition lost renderer preferences/drafts on full quit. Replaced it with the dedicated `persist:rhythm-hermes-desktop` within Rhythm userData, preserving isolated guest partitions and cleanup. No account/profile migration.
- Two-phase real input proof: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_ELECTRON_USER_DATA=<same profile> RHYTHM_LIVE_ELECTRON_PID=<20650 then 23369> RHYTHM_HERMES_RESTART_PHASE=<prepare then verify> RHYTHM_HERMES_RESTART_RECEIPT=/tmp/rhythm-hermes-restart-receipt.json node --test apps/electron/test/hermes-desktop-restart-live.test.mjs`: prepare **1/1**, then actual graceful quit and relaunch, verify **1/1**. Typed draft restored in visible composer; only that synthetic draft was cleared. No direct storage mutation. Both screenshots retained beside the receipt.
- Graceful quits of PID97387 and PID20650 each exited all **38** recorded owned descendants, including API, engine and Hermes. Receipts `/tmp/rhythm-hermes-persistent-stop.json`, `/tmp/rhythm-hermes-restart-stop.json`. Final app PID23369 remains open.
- `RHYTHM_LIVE_E2E=1 node --test apps/electron/test/agent-server-live.test.mjs`: **1/1**, actual engine PID/boot ID and API profiles preserved on reuse/disconnect (`/tmp/rhythm-hermes-runtime-persistent-live.log`).
- GitNexus `detect-changes --scope all -r <integration> --limit 30`: **18 tracked files, 144 symbols, low risk, zero affected indexed processes** before final docs/CI changes. New files reviewed directly; graph indexing does not cover those additions.

### Remaining qualification boundaries

This is local signed Desktop integration proof, not a complete mega release qualification. Compatible borrowed Hermes discovery/disposal is covered by boundary tests, but repeated live probes hang during renderer loading and do not establish stable reuse/disposal. Actual standalone UI coexistence remains unqualified. Physical microphone/voice, every remote/profile/SSH and auxiliary-window path, fresh pinned Python distribution, notarization for this Electron40 candidate, and remaining installed icon/device matrices are unqualified. The candidate uses the existing compatible local Hermes Python runtime without copying the mutable installed UI.

Existing pending-approval/provider configuration notices are separate from this replacement. No new account/login flow was introduced. Original M3 hosted reads, real ACP approval/read-back, Messages/Automations hosted writes, matched light/dark comfort, physical audio/TestFlight and deployed NAS/off-LAN relay gates remain distinct. Global campaign marker absence was not rechecked in this replacement. One explicitly controlled tool-free chat was sent for streaming/Stop proof; it must not be represented as a globally zero-send run.

### Release workflow review
- Final review caught that package assembly required the pinned Desktop artifact while release CI had no producer. CI now checks out the configured exact fork SHA, builds the native-architecture artifact and exports its path before package contracts/assembly. Existing qualification/publication guards are preserved.
- Review caught an initial Bash validation error (`test ... =~`); corrected to `[[ ... =~ ... ]]`. The workflow contract executes the actual extracted line against valid and invalid source IDs. Runtime/config tests **6/6**, YAML parse, Electron typecheck and diff check passed. CI execution for this new integration is separate from local package evidence.

### Borrowed backend live probe — partial
- Added `apps/electron/test/hermes-desktop-ownership-live.test.mjs`. `RHYTHM_LIVE_E2E=1 node --test --test-concurrency=1 apps/electron/test/hermes-desktop-ownership-live.test.mjs` initially passed **1/1** against real Electron40, final8ea642 artifact and Hermes0.20.5. It publishes an owner-only manifest under temporary HOME/HERMES_HOME, uses the actual preload connection bridge, asserts the exact published endpoint, disposes the host and checks that the same borrowed process and authenticated status remain live. Repeated executions failed afterward, so that first result does not close C5. Only probe-owned processes/data are removed; PID23369 is untouched.
- Removing module-level await of app readiness allowed one run to complete, but did not establish the cause of later hangs. The probe now uses an async entrypoint, bounded phase receipts, isolated Electron user/session data, the direct Electron binary and cleanup of its own detached process group. No product change was made during this probe investigation.
- Implementation committed as `6ed3ba03e4fbe3177977dea4e2c6c863c60625d3`. Packaged main/view/artifact/config source files byte-match the committed sources. Fork8ea642 was fast-forwarded into its existing mega branch and pushed, preserving unrelated local deletions/evidence files.

### Whole-repository gate
- `ai-workflow checks --level issue`: exit0. Flutter analyze/format and API/MCP typechecks passed.
- `ai-workflow checks --level pr`: exit1. Flutter tests, API lint/serial suite/build, MCP tests/build, engine typecheck, mobile static/contract/fake-server checks passed. Engine session suite: 395passed/5skip/1todo/1timeout. Mobile web: 68passed/3failed/1skip, all three missing `Open workspace` menu items. See [follow-up](../follow-ups/2026-09-19-broad-gate-after-hermes-desktop.md). This is not an all-repository PASS; no assertion was weakened and no mobile/engine product files were changed.

- Focused engine reproduction exited1 in3.54s with `metadata.truncated` false (expected true), rather than the suite timeout. Recorded in the follow-up; unrelated engine source remains unchanged. Automated mobile screenshots regenerated by the broad gate were restored to their pre-run tracked bytes.
- Parent repetition exposed ownership-probe instability after the earlier one-pass result. The final probe used production's distinct WebContentsView/outer BrowserWindow layout and still failed after 102.5 seconds at `renderer-load`, before producing a connection/disposal receipt. Full output: `/tmp/rhythm-hermes-ownership-wcv-final.log`. Host creation succeeded, but the failure's root cause remains unknown. C5 is partial; neither stable borrowed-service reuse nor standalone UI coexistence is claimed.
- The final detached probe group exited cleanly. Its main process had already exited before the requested diagnostic sample could run; no other process was sampled. The user-facing signed candidate PID23369 was left open and untouched. A future diagnosis should sample the exact isolated probe main process before timeout and inspect native blocking rather than guess at more timing changes. See the [follow-up](../follow-ups/2026-09-19-broad-gate-after-hermes-desktop.md).
- Final evidence/test review: `git diff --check` and ownership-test syntax validation exit0; default discovery skips the live probe as intended (not a runtime pass). GitNexus `detect-changes --scope all -r <integration> --limit 12` reports four tracked files, three symbols, zero affected indexed processes and low risk. The new live test and follow-up were reviewed directly. The draft PR records selected native success alongside C5 partial coverage and the red whole-repository gate.
