---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, rhythm]
---

# MCP profile-scope Codify

## Files

- `apps/web/tests/packaged/packaged-ai-private-mcp-profile-scope.spec.ts`: one exact synthetic-actor, bounded-model packaged test for real SDK inherited/selected/None MCP execution and denial.
- `docs/testing/results/recon-ai-private-mcp-profile-scope.md`: credential-free native Recon summary and its proof limits.

## Checks

- Prior exact signed-app Recon: four parent-linked Luna turns and an independent two-denial replay, both with exact owned cleanup. See the result note. These were **observations**, not a run of the new test.
- `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`: pass, but this app configuration excludes packaged specs and therefore was not a typecheck of the new test.
- Strict packaged-contract TypeScript initially failed on optional `process.getuid`, an undeclared renderer bridge type, an unguarded catalog lookup, a session response lacking a typed owned ID, and unvalidated policy JSON. The new spec now checks those values explicitly. `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p /private/tmp/rhythm-mcp-schedule-contract-tsconfig-20261020.json`: pass after repair. The temporary config includes packaged specs and app source; it is not part of the repo.
- `./apps/web/node_modules/.bin/playwright test -c apps/web/tests/packaged/packaged-playwright.config.ts --list apps/web/tests/packaged/packaged-ai-private-mcp-profile-scope.spec.ts`: pass, one discovered test.
- Independent native Confirm on signed source `6101edfc0c`: **1/1**, 29.6-second test / 1.1-minute total, CLI exit 0. Log `/private/tmp/rhythm-private-6101-mcp-scope-confirm-20261020.log`; JSON `/private/tmp/rhythm-mcp-profile-confirm-6101-20261020/report.json`. The whole loan fixture was scrubbed; source credential/config hashes unchanged.
- Repeated checked case on exact signed `5dfffb5d9978795935becfe4723c8196bb2f883d`: **1/1**, 23.6 seconds, inside the combined MCP/router selection. Four actual fixed-Luna turns passed the owned task and canonical denial assertions. Exact command: `npm run build:guard -- node /private/tmp/rhythm-model-loan-runner.mjs run --app /private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app --manifest /private/tmp/rhythm-ai-fixture-WDwhtz/manifest.json -- --config /private/tmp/rhythm-model-router-mcp-confirm-5dff-20261020/playwright.config.ts`.
- The combined selection is **not green**: 3 passed / 1 failed / 14 not run, CLI exit 1. Its separate routine-router case lacked the private visibility setup for tier-3 Sol. Luna was enabled by the MCP case; the tier-3 classification correctly found Sol unavailable. Prior router qualification explicitly enabled Luna/Sol/6.1-Sol before running. Preserve this setup failure and its original report; no MCP contamination or router product regression is established. Log `/private/tmp/rhythm-private-5dff-router-mcp-confirm-20261020.log`; JSON `/private/tmp/rhythm-model-router-mcp-confirm-5dff-20261020/report.json`.
- Whole failed combined loan fixture was scrubbed after evidence capture: `/private/tmp/rhythm-router-mcp-confirm-5dff-scrub-20261020.json`, `sourceHashesUnchanged:true`. That RED remains preserved.
- The corrected exact-5dff serial selection subsequently passed **19/19**, 0 skipped/flaky/errors, 89.258 seconds total, outer CLI exit 0. The same checked MCP scope case passed 1/1 in 24.8 seconds alongside main Auto and all 17 ordinary router cases. Log `/private/tmp/rhythm-private-5dff-router-main-mcp19-esm-confirm-20261020.log`; JSON `/private/tmp/rhythm-router-main-mcp-confirm-5dff-g3pvz5/report.json`. Its whole loan fixture was scrubbed with `sourceHashesUnchanged:true` (`/private/tmp/rhythm-router-main-mcp-confirm-5dff-g3pvz5/scrub.json`). This later green selection does not erase the earlier fixture-prerequisite RED.

## Notes

The test requires the validated private manifest, current signed source revision, an explicit model opt-in, and a loan with at least 390 seconds remaining. It primes registration through the normal renderer and checks API/engine/UI catalog agreement before any model turn. Allowed outcomes require exact owned task ID/title in an actual completed SDK execute part; denied outcomes require exact canonical execute error and allowlist diagnosis. Assistant prose and empty searches receive no credit. Cleanup uses nonce ownership and reads back API/SQLite absence without negative profile/task GETs.

This qualifies only the observed inherited/selected/None invocation boundaries with primed registration. Cold-start, owner switching, every tool, account failover and broader MCP lifecycle remain unqualified.
