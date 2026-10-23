---
date: 2026-10-23
repo: Rhythm
branch: feat/tailscale-web-app-20261022
pr: 1621
issues: []
status: integration-qualified
tags: [run, rhythm]
---

## Files

- Pushed the 23 committed feature changes (head `702280390047006d1070880f74da61d66a7013df`) and opened draft [PR 1621](https://github.com/ajhochy/Rhythm/pull/1621) against `mega/2026-09-29-consolidation`. AJ explicitly authorized merge into mega; no main merge or deployment is authorized by this action.
- CI found three branch-introduced web-unit module-resolution failures: native Node TypeScript imports could not resolve extensionless browser-transport/cloud-error imports, and transcript data URLs could not resolve relative dependencies. Local exact `test:unit` reproduced all three plus three environment-only missing mobile React failures.
- Added a test-only source-module loader using TypeScript transpilation/import metadata to load the real acyclic gateway dependencies. Updated two preference tests and transcript/reducer loaders; the expanded contract check found the same boundary in usage-budget tests, also repaired. Product source and test assertions are unchanged.

## Checks

- Before push: focused API surface/security contracts 53/53, CLI0; running signed candidate readiness CLI0; diff whitespace and intentional multi-area PR scope CLI0. No credential/database files or token/private-key patterns in outgoing content.
- Loader repair: `npm run build:guard -- env NODE_PATH=/Users/ajhochhalter/Documents/Rhythm/apps/mobile/node_modules npm --prefix apps/web run test:unit` CLI0, 98/98 (`/private/tmp/rhythm-pr1621-web-unit-green2.log`). Matching existing mobile React/renderer packages reused through NODE_PATH; no install or donor mutation.
- `npm run build:guard -- node --test apps/web/tests/contract/issue-1582-transcript-reducer.test.mjs apps/web/tests/contract/transcript-cache-event-reducer.test.mjs apps/web/tests/contract/transcript-optimistic-user-replay.test.mjs` CLI0,38/38 (`/private/tmp/rhythm-pr1621-transcript-contract-green.log`).
- `test:contract` (Playwright wrapper) first built the web successfully, then failed while collecting the usage-budget Node test for the same unresolved transport import; this is not a rendered contract pass. Expanded Node contracts and fresh build are recorded below when finished.
- GitNexus impact for new `sourceModuleUrl`: absent from the 31-commit-stale index. Manual references are confined to test modules. `detect_changes --scope all --repo Rhythm`: low risk, no affected execution flows; new/untracked helper not represented until staged. No application function was edited.
- Fresh signed runtime readiness: API75478, engine75524, real cloud available, served assets match, source/build `4bd758e09508655daedcc63cda8f9384f93ed848`, mobile gateway absent. Credential contents never read.
- Generic issue/PR workflow wrappers remain outside the agreed browser qualification scope; this log does not claim universal repository-green status or repeat all 93 original cases at the PR head. Prior known API aggregate failures and Electron TS7053 remain described in the final qualification report.

## Notes

- Retain eager-star checkout and branch: active signed bundle, web assets and user-approved login LaunchAgent depend on its current paths. Removing an otherwise idle worktree would interrupt the requested always-available service.
- Fresh `npm run build:guard -- npm --prefix apps/web run build` CLI0 (TypeScript and Vite, `/private/tmp/rhythm-pr1621-web-build.log`). Product source and served `dist-web` assets unchanged.
- All Node contract tests in their required web working directory:71/76; five failures in existing project-group source assertions and timestamp guards. Initial repo-root invocation also had eight Vite/cwd failures, corrected by web cwd plus concurrency1. All five exact failure names reproduced directly in a source-only archive of mega `a018589282e3a25cc778ecd244859742d758bdbb` (baseline18/23, `/private/tmp/rhythm-pr1621-contract-mega-baseline3.log`); the full current suite71/76 has no additional failure. No unrelated assertion edits.
- Final source CI is recorded below; PR metadata retains the authoritative merge state and SHA. No production release or installation performed.

## Linux CI follow-up

- Original PR server CI39980537383 at702:9080 pass/54fail/418skip, plus one failed suite. Mega's existing CI39847194207 at exact basea018:8992pass/52fail/418skip, plus the same failed suite. Exact failure-name set difference is only the two new qualification-profile projection cases; no mega failure disappeared. Public comparison: `docs/testing/results/2026-10-23-tailscale-web-ci-comparison.json`. These Linux CI results differ from the earlier local macOS seven-failure aggregate and are not conflated.
- Root cause: the new profile-projection test created its fixture under literal `/private/tmp`, absent on Linux; both fail at mkdtemp before product code executes. Test now uses `join(tmpdir(), 'rhythm-profile-projection-')`; no application logic or assertion changes. GitNexus has no indexed test symbol; local test-path-only diff inspected.
- At6af: Web Unit CI39982285167 and Postgres both green; fork green. Fresh guarded focused API five files53/53, CLI0 (`/private/tmp/rhythm-pr1621-focused-api-final.log`).
- Portable projection rerun: `npm run build:guard -- npm --prefix apps/api_server exec -- vitest run src/services/__tests__/qualification_agent_projection.test.ts`, CLI0,2/2 (`/private/tmp/rhythm-pr1621-projection-portable.log`). Final source CI is recorded below; PR metadata retains the authoritative merge state and SHA.

## Final integration qualification

- At exact source/test commit `b52db3e10319a3afab823b366e572fe28b2c682a`: Web Unit CI39983102122, Mobile CI39983102259, Fork CI39983101819 and Postgres bootstrap in Server CI39983102272 all SUCCESS. `gh run view`/`gh pr checks` captured their exact head and success; PR marked ready for review, CLI0, as required for AJ's explicitly requested merge.
- Server CI39983102272 completed FAILURE:9082pass/52fail/418skip;23failed/912passed/199skipped test files. Compare all normalized unique failure names (52 tests plus one collection failure) with existing mega CI39847194207 at exact basea018: **identical53-entry failure set, zero new and zero missing failures**. Both new projection tests pass on Linux. Raw logs retained privately under `/private/tmp/rhythm-pr1621-server-final-failed.log`; public comparison updated. This is an inherited-failure integration, not a green full server suite.
- Only documentation/evidence follows b52; product source and tests remain byte-identical. Final record commit can be checked with `git diff --name-only b52db3e10319a3afab823b366e572fe28b2c682a..HEAD`. No full qualification rebuild/restart is needed for these records. Generic workflow wrapper and unrelated checks remain unclaimed; existing failures are retained rather than altering assertions.
- Base remained `a018589282e3a25cc778ecd244859742d758bdbb`, feature ahead only, mergeable. Merge target is exactly `mega/2026-09-29-consolidation`; no main merge, deployment, install, tag or release. Final merge outcome/SHA are linked by [PR1621](https://github.com/ajhochy/Rhythm/pull/1621), avoiding a commit-hash self-reference in this record.
- Active checkout/branch retained because login LaunchAgent and signed app/web assets depend on it; no private credential contents read and no account configuration changed. Owned source-only comparison fixture removed, donor packages untouched; logs retained.
