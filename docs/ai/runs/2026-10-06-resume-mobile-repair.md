---
date: 2026-10-06
repo: Rhythm
branch: integration/2026-10-06-resume
pr: 1604
issues: []
status: unverified
tags: [run, rhythm]
---

# Resume Mobile CI and Research validation

## Files

- `apps/mobile/tests/issue-1173-tools-service.test.mjs`: transpile the actual service and local modules with the existing TypeScript dependency; Node 20 cannot load `.ts` imports. Assertions remain unchanged.
- `apps/mobile/tests/contract/ios-account-connect.test.mjs`: update the fixture fingerprint to the regenerated mobile contract, matching pairing repair commit `2fe21ac1`.
- `apps/mobile/tests/fake-opencode/rhythm-tools-routes.mjs`: canonical Research project/run fixtures and eleven endpoint operations before legacy job routing.
- `apps/mobile/tests/fake-opencode/self-test.mjs`: exercise all eleven Research operations, not-ready export and missing entity responses.
- `apps/mobile/tests/e2e/research-project-workspace.spec.mjs`: paired 390x844 Research UI, preserved budget, report gating and finish/export flow; optional screenshots outside the repository.

## Checks

All commands use this integration worktree; mobile commands run in `apps/mobile`.

- RED: `npm exec --yes --package=node@20.20.2 -- node --test ./tests/issue-1173-tools-service.test.mjs` reproduced `ERR_UNKNOWN_FILE_EXTENSION .ts`, Node v20.20.2.
- PASS: `npm exec --yes --package=node@20.20.2 -- npm run test:tools-service:1173`: 12/12.
- PASS: `node --test tests/contract/ios-account-connect.test.mjs`: 8/8.
- PASS: `npm run test:fake-server:self` including canonical Research routes.
- PASS: `npm run typecheck`.
- PASS: `npm run lint`: 0 errors, 28 existing warnings. Initial loader Buffer lint error corrected by importing `node:buffer`.
- FAIL outside mobile: `ai-workflow checks --level issue`: Flutter analyze/format and MCP typecheck passed; API `npx tsc --noEmit` resolved the wrong package while API dependency reconstruction was active (`This is not the tsc command you are looking for`). Orchestrator owns integrated rerun.
- RED browser baseline: `PLAYWRIGHT_FAKE_PORT=44106 PLAYWRIGHT_WEB_PORT=19106 npm run test:e2e:web -- research-project-workspace.spec.mjs --reporter=list` paired successfully, then timed out on the absent project card before canonical routes were loaded.
- Browser recon correction: run-detail and legacy job cards both have a View report control. Scope assertions to `research-run-detail`; no behavioral assertions weakened.
- PASS: `npm exec --yes --package=node@20.20.2 -- npm run test:jest:ci -- --runInBand --silent`: 67/67 suites, 525/525 tests (44.511s). Receipt: `/Users/ajhochhalter/Documents/Codex/2026-10-06/resume-mobile-research/node20-jest-ci.log`. First full run without `--silent` had 524/525, ST-1 `st1-r4` expected `seed`, received empty; isolated `npm exec --yes --package=node@20.20.2 -- node node_modules/jest/bin/jest.js tests/chat/transcript-streaming-provider.test.tsx --runInBand --silent` passed 4/4. No product/test assertion changed to address that timing failure. Jest still warns about open asynchronous handles.
- PASS: `PLAYWRIGHT_FAKE_PORT=44106 PLAYWRIGHT_WEB_PORT=19106 RHYTHM_RESEARCH_CAPTURE_DIR=/Users/ajhochhalter/Documents/Codex/2026-10-06/resume-mobile-research npm run test:e2e:web -- research-project-workspace.spec.mjs rhythm-tools-core.spec.mjs rhythm-tools-navigation.spec.mjs issue-1172-tool-deep-links.spec.mjs --reporter=list`: 6/6 (40.5s); canonical Research, legacy Research, Brain CRUD, Scheduled Jobs, Activity links and all fourteen tool screens.
- Browser recon: the E2E Tools service deliberately uses the direct fake transport, outside `__control/mobile` gateway audit. The spec observes actual browser requests and asserts every canonical request carries `X-Rhythm-Project-ID: project-demo`, plus exact finish and export endpoints. Authenticated paired gateway routes are separately exercised by fake server self-test; this browser test does not establish authenticated real gateway behavior.
- PASS: `node .gitnexus/run.cjs detect-changes --scope unstaged --repo Rhythm --limit 20`: concurrent integration changes 23 files, 12 indexed symbols, 0 processes, LOW. Scoped inspection shows mobile harness/test edits only. New untracked spec is inspected manually.
- Final repeat of the same change detector after other lanes staged their work: 8 files, 11 indexed symbols, 0 affected processes, LOW; includes root-owned workflow and web changes. Lane still touches only the listed mobile tests/harness and this record.
- GitNexus compare-main: `node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo Rhythm --limit 20`: 863 files, 8878 symbols, 46 processes, CRITICAL across inherited integration lineage; warned orchestrator. This is not the lane-only blast radius.
- PASS: `git diff --check`.
- PASS final focused browser rerun with the same fake/web ports and capture directory, only `research-project-workspace.spec.mjs`: 1/1 (34.0s). The modal screenshot waits for Paper's animated Surface to reach opacity 1; report capture scrolls the full report into view. Both final 390x844 PNGs inspected visually:
  - `/Users/ajhochhalter/Documents/Codex/2026-10-06/resume-mobile-research/research-stopped-settings-390x844.png`: settled settings dialog, all four preserved budget values, both model selectors and Cancel/Save controls visible.
  - `/Users/ajhochhalter/Documents/Codex/2026-10-06/resume-mobile-research/research-ready-report-390x844.png`: terminal run, synthesis stage, report control and readable report heading/body visible.
- Cleanup: no listeners remained on this lane's fake/web/self-test ports 44106/19106/4196 after harness teardown. No live API process touched.

## Notes

- Starting source: `99004a7a`; this lane is uncommitted and requires orchestrator review plus verification-gate.
- GitNexus upstream impact: `createRhythmToolsRoutes` and `createState` LOW, 0 indexed direct callers/processes. `handleRhythmTools` UNKNOWN (nested handler not indexed); source has the returned factory handler consumed by fake server only.
- Existing mobile `node_modules` symlink preserved; no npm install/ci in this worktree. Node 20 acquired through isolated npm exec cache.
- No production API, real engine, phone installation, release, commit, push or merge performed by this lane. Browser evidence uses Expo web with a fake paired gateway; native/physical-device and real-engine Research behavior remain unverified.
- `apps/mobile/AGENTS.md` requires explicit human validation for changes in `tests/e2e/` and `tests/fake-opencode/`; automated passes do not satisfy that remaining approval/validation gate.
- Decisions: reuse installed TypeScript for test loading instead of changing CI Node or adding a loader dependency; preserve legacy fake routes while adding canonical workflow fixtures. No product implementation changed.
- Deviations from spec: none within the authorized mobile/harness scope.
- Concerns: five previously excluded mobile Jest suites stay excluded by the existing CI script; full integrated gate remains owned by the orchestrator.
