---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1598]
status: in-progress
tags: [run, rhythm, playwright, repair]
index: "[[Rhythm]]"
---

# Repair AI qualification failures and rebuild local mega

## Authorized scope and acceptance

AJ now authorizes fixing the discovered failures, starting with Bot Crossing and empty-project session requests, rebuilding the mega app locally and rerunning Playwright while continuing safe coverage. Previous local-only/no push/PR/merge/install and owned-data boundaries remain. Real-model opt-in carries forward.

Using workflow-orchestrator, failure-triage and coding-agent lanes. Acceptance-contract intake reviewed: this is a direct user repair request with no new GitHub issue body/number; no issue-N contract is fabricated. Existing executable failing packaged cases are the acceptance contract before product changes: actual Bot inventory agreement, retained scene usable inventory, and named unassigned session persistence/cleanup with strict error audit. Additional focused source regressions must fail before fixes and preserve valid-project behavior and exact native document authority. Original failing records remain in the October 20 qualification report.

## Sequence

1. Repeat exact locally built d7 candidate RED for Bot Crossing and owned session.
2. Independent targeted source repairs (Colony runtime/view and session branch loading), with GitNexus impact and focused red/green.
3. Resolve additional observed skill/Report Card/Gallery failures where root cause can be established safely; restore Dayflow inputs only if reviewed provenance is recoverable.
4. Commit source candidate locally, rebuild fork/web/API/MCP/Electron with 10 GiB guard, sign locally and verify exact identity/signature.
5. Rerun focused acceptance, additional recon/coverage and broad AI suite; classify remaining product failures vs unverified prerequisites.
6. Record clean owned-data and runtime teardown. No release/overall qualification claim while required cases remain failed.

## Initial state

Test head d8dba691a6ba9b15078ad212ff4cee6388f70dce; existing signed product source d7fb554735f93c0d0a76785cbadd583d0f866610; current worktree initially clean. Original checkout dirt is unrelated and preserved. Prior full run was 46 pass / 109 fail, with explicit gap/prerequisite/test-authoring categories. Native Dayflow inputs were not found at prior recorded locations; validation must not be bypassed.

## Checks

Private repair RED command: `node tools/testing/run_packaged_ai.mjs --grep 'Bot Crossing|named session persists' --output /private/tmp/rhythm-ai-repair-red --reporter=list,json`.


## Combined candidate and live receipts

- Local source candidate `cf49da55af7b9066b4478c391ac9e3efc499afa9` is a local-only WIP commit pending packaged qualification; it includes the session guard, compiled-skill/historical-label/Gallery repairs and exact installed-Dayflow compatibility. The embedded Bot Crossing artifact is sealed from clean local dependency commit `a1f113340e643c50325ac1c1e0fc1ed0ed2e066b` (45 files, 6,841,476 asset bytes); no cap was increased.
- `node /private/tmp/rhythm-feature-build-launcher.mjs` rebuilt fork, web, API, MCP and Electron locally under the shared guard; packaging completed. The preceding reviewed d7 app was retained by rename under `apps/electron/dist/previous-reviewed/`. No installed app was modified.
- `RHYTHM_SIGN_ONLY=1 APPLE_TEAM_ID=56Q69NYP9H APPLE_SIGNING_IDENTITY=CF6C1EF1525E70E6E3324388A322938977779DB7 npm run build:guard -- node apps/electron/scripts/sign-and-notarize-mac.mjs` exited 0. `codesign --verify --deep --strict apps/electron/dist/Rhythm.app` exited 0. This is a local Developer ID signed, unnotarized bundle; Gatekeeper does not classify it as a distributable notarized release. Private logs: `/private/tmp/rhythm-ai-repair-local-build.log`, `/private/tmp/rhythm-ai-repair-local-sign.log`.
- `npm run build:guard -- npm --prefix apps/web run test:dist-smoke` passed: built index and two relative assets, including traversal rejection.
- `npm run build:guard -- ai-workflow checks --level issue` exited 0. Focused Electron contracts passed 23/23 after updating the exact dependency pin in the integration plan. Per-lane source red/green evidence is linked in the adjacent repair run logs.
- `npm run build:guard -- bash /private/tmp/rhythm-ai-repair-sandbox-check.sh` exited 0: **3/3 live tests passed** against the actual newly built engine and API on 4097/4098, with gateway 4099. The wrapper uses the four required wholly synthetic, read-only fixture inputs under `/private/tmp/rhythm-ai-repair-fixtures-20261020`; no live DB/config was copied. It launches only through `tools/dev/sandbox.sh`, records status and traps `down`. Observed outcomes: compiled built-in skill matches engine content, synthetic historical empty-kind run remains counted with `Unknown agent`, and synthetic missing-file Gallery row remains with null artifact/thumbnail URLs. Sandbox teardown removed the owned sandbox; sanitized diagnostics are retained privately. Log: `/private/tmp/rhythm-ai-repair-sandbox-check.log`.

## Follow-on recon (observations, not qualification)

`node tools/testing/run_packaged_ai.mjs packaged-ai-followon-recon.spec.ts --output /private/tmp/rhythm-ai-repair-followon-recon --reporter=list,json` exited 0 with two observation probes, 1.6 minutes. The profile probe saw GET 200, 54 saved records, a nonce-owned unsaved draft, `Unsaved changes`, enabled Save, a discard dialog and GET 200 after forced reload, still 54 records and no write requests. This was codified separately as a real regression with saved-identity digest comparison; confirmation is pending.

The Bot observation was **not successful**: a child renderer attached, boot overlay was removed, but the scan notice remained visible and the project count stayed zero for 60 seconds. No observer inventory request or cancel was made. Native runtime still emitted `Colony document revoked` through the host inventory path. Therefore the dependency race fix has source proof but does not yet resolve packaged Bot Crossing. The separate lifecycle failure is under diagnosis; no authority/revocation check was weakened.

The first focused packaged command ran with real-model opt-in: `RHYTHM_FEATURE_MODEL=1 node tools/testing/run_packaged_ai.mjs packaged-sessions.spec.ts packaged-session-project-scope.spec.ts packaged-conversation.spec.ts packaged-ai-catalogs.spec.ts packaged-ai-tools.spec.ts packaged-ai-followon.spec.ts packaged-ai-companions.spec.ts --grep-invert 'Bot Crossing|AI Hermes|advertised native workspace' --output /private/tmp/rhythm-ai-repair-focused-native --reporter=list,json`. It exited 1: **33 passed / 4 failed / 0 skipped / 0 flaky**, 309.7 seconds. All 18 catalog tests, signed Dayflow readiness, four actual conversation tests, project scope, and four ordinary session cases passed. Two failures are explicit existing coverage gaps (reconnect/history cursor and child/ancestor pagination). The added profile case had a recon/codify error: initial hash navigation reused an already warm profile catalog and emitted no GET. The named-session case completed behavior and cleanup, then its strict audit rejected a late model-provenance 404 for exactly that deleted owned ID; the trace showed no other HTTP errors. The helper now narrowly allows this sibling deletion read for `deletedOwnSessions` only and also audits Electron IPC handler failures. Both corrections require a fresh packaged confirmation. Structured raw receipt is private at `/private/tmp/rhythm-ai-repair-focused-native.json`.


## Remaining isolation boundary

Read-only source review confirmed the existing qualification manifest scopes DB, engine files and coordinator storage, but does not provide a trusted signed-in Electron fixture actor. Its fixture token does not authenticate ordinary Coordinator routes. The permanent canonical primary points at a removed previous bundle cwd and must not be rewritten just to satisfy tests. A fresh build-bound private fixture with a trusted main-process sign-in seam is needed for first-use/journal/run coverage; real-model workflows also need isolated provider authentication. This remains an explicit failing prerequisite, not a repaired/qualified feature.


## Bot Crossing native lifecycle and reader isolation

- Locally rebuilt/signed diagnostic b9 (`b9eaca6b421425403fc8788ae77ef7d3bc4464f1`) exposed `scene-ready-invalid` while the worker was ready. The three-probe native recon was 2 pass/1 fail, 220.5 seconds; the failed Bot probe is real IPC rejection, while profile warm reload/discard and unavailable Gallery inspector observations succeeded.
- Split diagnostic ef (`ef7141751080dfd212c49aeb2bfd6a3f8baf5ce2`) reproduced in Bot-only packaged acceptance: two valid messages from the owning frame while loading, before commit or port transfer. The second notice revoked the channel and stopped its healthy worker. The isolated actual Electron fixture had one ready notification and passed six boundary cases; it did not establish the packaged timing cause.
- Functional commit `72ac1a93e60618ec1448bcf9255879632ec01f6b` coalesces only repeated valid notifications from the identical authenticated sender/frame while still loading, before commit/transfer. Exact-document load, one-port transfer, malformed messages, post-transfer duplicates, foreign frames and navigation guards remain enforced. Source regression was RED before the fix; 40 focused cases and six actual native fixture cases passed afterward.
- The rebuilt/signed 72ac package reached 58 populated project rows and retained the same native scene across a tab departure/return. The first search recon then hit an authoring error: it imposed a selected-project sessions empty state while no project was selected. Corrected source-backed overview recon observed 58 rows, nonce search to zero with the declared no-locations state, clear to the same 58-row digest, and a real five-record scene inventory page. No names, paths or record contents were emitted in the sanitized receipt. Exact command and observations: [follow-on recon](2026-10-20-packaged-ai-followon-recon.md). This is observation evidence; codified tests await confirmation on the next candidate.
- A further deterministic real sealed-worker test reproduced shared cancellation: independent host/scene readers received the same cached generation, so cancelling a completed reader invalidated the other reader's cursor. The narrow service repair gives only validated initial native page requests a fresh explicit generation. Continuations/cancel keep their original generation and the worker's two-generation cap stays enforced. Behavioral RED failed on the second reader's next-page outcome after the first cancelled; restored repair passed, the source DB stayed byte-identical, and the focused suites passed 41/41. Next exact local rebuild/packaged confirmation pending.

## Broad source gate

`npm run build:guard -- ai-workflow checks --level pr` completed with **21/22 batches passing**, peak guard accounting 3,438,017,201 bytes. Flutter analysis/format/tests, API type/lint/build, MCP checks/build, fork typecheck/session tests, all six mobile batches, desktop web unit/build and Electron type/unit passed. The serial API suite failed five assertions in the Engraph ownership path (`enable()` returned `spawn_failed`). The wrapper retains only the final output tail. A separately guarded focused Engraph file subsequently passed 19/19; the aggregate is still failed and under bounded triage, not retrospectively green. Private log `/private/tmp/rhythm-ai-repair-pr-checks.log`. Auto-generated tracked proof screenshots will be restored only in this task worktree before the final commit.

## Native Dayflow input recovery

The user does not know the original input paths. Cheap read-only research confirmed the canonical Oct 4 signing manifest root and Oct 6 C9 source/build root are gone. Installed/current/previous reviewed Rhythm bundles contain the standalone signed Dayflow companion but no native helper/addon/production dylib or accepted wrapper manifests/sidecar. Builder/staging require the exact immutable 749-file source and 280-file signing layout; no inventories were reconstructed or validation bypassed.

Time Machine metadata reports Oct 10/16 NAS backups and Oct 19/20 local snapshots. Its returned NAS path is absent; the actually mounted NAS root returns Permission denied, so no backup contents or restorations were attempted. Recovery of the accepted original source/layout archive remains unverified and is required for embedded Dayflow. Signed standalone Dayflow readiness is already separately confirmed; it is not substituted for the missing embedded module.
