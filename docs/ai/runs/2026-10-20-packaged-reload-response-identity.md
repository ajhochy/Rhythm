---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

## Files

- `apps/web/tests/packaged/feature-test.ts`: added an opt-in full-reload JSON waiter bound to a request emitted after the new main frame commits. It consumes the response body before later navigation. Existing action waiters are unchanged.
- `apps/web/tests/packaged/packaged-ai-private-disabled-schedule.spec.ts` and `packaged-ai-private-gallery-research.spec.ts`: use the waiter for reload-bound catalog reads, retaining status, owner, UI, API, SQLite, and cleanup assertions.
- `apps/web/tests/packaged/ai-surfaces.ts`: wait for the neutral Agent Tools catalog to render before returning to a tool, ensuring the previous tool unmounts before the next catalog waiter is armed.

## Checks

- Exact signed `b7d5db0af9` broad packaged run: 54 passed, 6 failed, no skips or flaky cases, exit 1. Disabled schedule failed at `initialResponse.json()` before any schedule write; Research failed at `observedApi`'s initial `response.json()` before project creation. Both reported `Network.getResponseBody: No resource with given identifier found` after reload. The memory no-match case timed out at `openAiSurface`'s initial catalog waiter before its search/clear actions; its failure snapshot showed Brain already loaded with a memory row. Log: `/private/tmp/rhythm-private-b7d5-broad60-confirm-20261020.log`; error contexts: `/private/tmp/rhythm-b7d5-qualification-launch-20261020/broad-Phq2OM/test-results/`.
- `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p /private/tmp/rhythm-coverage-reload-tsconfig-20261020.json --noEmit` passed (strict packaged test scope).
- `npm run build:guard -- ./apps/web/node_modules/.bin/playwright test -c apps/web/tests/packaged/packaged-playwright.config.ts --list packaged-ai-private-disabled-schedule.spec.ts packaged-ai-private-gallery-research.spec.ts packaged-ai-tools.spec.ts` passed; ten cases discovered. `git diff --check` passed.

## Notes

The previous full-reload waiters matched only method and path, so a request from the old document could win. The natural Once and Skills records had already identified the same test-authoring race and proven a post-commit request identity barrier. This patch does not alter production code or relax behavioral assertions. Native confirmation against a signed app is still pending.

GitNexus impact in this worktree was stale by 321 commits: the new helper, `observedApi`, and `openAiSurface` were UNKNOWN; the indexed unrelated `responseFor` showed LOW/zero callers. Manual blast radius is the opt-in helper and these packaged test paths. No production process changes.
