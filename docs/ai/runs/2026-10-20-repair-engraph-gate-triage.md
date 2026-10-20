---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1574]
status: unverified
tags: [run, Rhythm]
---

# Engraph ownership PR-gate triage

## Files

- No source or fixture files changed. The guarded aggregate result and focused controls are recorded here separately.

## Checks

- Parent's `npm run build:guard -- ai-workflow checks --level pr` exited 1 after 21/22 batches passed. Its serial API suite had five `issue_1574_engraph_ownership.test.ts` failures where an expected `{ ok: true }` was `{ ok: false, reason: 'spawn_failed' }`. The wrapper retained only the last 40 output lines for that batch, so it did not retain `lastFailureMessage` or the full five-case list. Log: `/private/tmp/rhythm-ai-repair-pr-checks.log`.
- Exact focused file under the default guard environment: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npx vitest run src/__tests__/issue_1574_engraph_ownership.test.ts --maxWorkers=1'` passed 19/19. Log: `/private/tmp/rhythm-engraph-guard-focused.log`.
- Four related Engraph files under serial guarded execution: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npx vitest run src/__tests__/engraph_manager.test.ts src/__tests__/engraph_lifecycle_operation_boundaries.test.ts src/__tests__/issue_1573_semantic_degradation.test.ts src/__tests__/issue_1574_engraph_ownership.test.ts --fileParallelism=false'` passed 99/99. Log: `/private/tmp/rhythm-engraph-serial-cluster.log`.
- Controlled temporary-root comparison: `npm run build:guard -- env TMPDIR=/private/tmp TMP=/private/tmp TEMP=/private/tmp /bin/zsh -f -c 'cd apps/api_server && npx vitest run src/__tests__/issue_1574_engraph_ownership.test.ts --fileParallelism=false'` passed 19/19. Log: `/private/tmp/rhythm-engraph-private-tmp-control.log`.

## Notes

- `tools/build/guard.py` sets `TMPDIR` to an owned Documents scratch directory by default, but the focused test passed with that value. The prior #1186 temporary-root failure is not established as this issue's cause.
- `EngraphManager` requires exact OS process identity. Its `/bin/ps` probes have a one-second timeout and deliberately fail closed if unavailable. The aggregate ran while a packaged app and other work were active, so resource-related probe failure is possible, but the retained output cannot prove it. The process-stray check matches the configured fake Engraph binary command, so the packaged app's ordinary Engraph binary is not itself an exact-match stray.
- No production ownership checks, test expectations, fixture environment, global settings, app, API, or engine were changed or launched in this lane. The full aggregate remains failed; focused passes are narrower evidence only.
