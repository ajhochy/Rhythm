---
date: 2026-08-08
repo: Rhythm
branch: feat/task-search-tier12
pr: null
issues: [task-search-tier12-s1]
status: READY_FOR_VERIFICATION
tags: [run, api_server, task-search, bm25]
---

## Files

- Added `apps/api_server/src/services/bm25.ts` with the extracted, deduped-token BM25 scorer.
- Kept `scoreSkillsBm25` as a wrapper that builds skill text and delegates to the shared scorer.
- Added the acceptance contract and focused BM25 regression tests.

## Checks

- Contract pre-implementation: `cd apps/api_server && env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/services/bm25.test.ts src/__tests__/skill_retrieval.test.ts` — failed as expected: 3 BM25 contract assertions failed (`scoreDocsBm25` unavailable/fallback zero output and copied formula remained); existing skill suite passed (18 tests).
- Final: same focused command — pass (2 files, 21 tests).
- `cd apps/api_server && node_modules/.bin/tsc --noEmit` — pass.

## Notes

- GitNexus impact for `scoreSkillsBm25`: LOW, 0 indexed upstream dependents, 0 affected processes.
- No sandbox lifecycle action was taken.
- Manual acceptance item: no unnecessary dependency or abstraction was added; only the shared scorer module was introduced.
