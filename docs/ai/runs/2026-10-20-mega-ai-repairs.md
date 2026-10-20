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
