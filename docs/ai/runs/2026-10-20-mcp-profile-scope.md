---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pending
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
- New test native Confirm: **UNRUN**. Do not count the MCP scope group as qualified from Codify alone.

## Notes

The test requires the validated private manifest, current signed source revision, an explicit model opt-in, and a loan with at least 390 seconds remaining. It primes registration through the normal renderer and checks API/engine/UI catalog agreement before any model turn. Allowed outcomes require exact owned task ID/title in an actual completed SDK execute part; denied outcomes require exact canonical execute error and allowlist diagnosis. Assistant prose and empty searches receive no credit. Cleanup uses nonce ownership and reads back API/SQLite absence without negative profile/task GETs.
