---
date: 2026-10-04
repo: Rhythm
branch: codex/native-query-terra-local-20261004
pr: null
issues: []
status: unverified
tags: [run, rhythm, native-query]
---

# Native query budget

## Files

- `apps/api_server/src/services/memory_retrieval.ts` — bound only automatic native retrieval input; preserve the original query for all other retrieval, relevance, excerpt, and reranker paths.
- `apps/api_server/src/__tests__/memory_retrieval_semantic.test.ts` — synthetic automatic/explicit contract, Unicode fallback, and fail-closed gate coverage.
- `apps/api_server/src/services/memory_retrieval_rerank.test.ts` — synthetic rank-only native-input and original scoring-query coverage.

## Checks

- RED: `env -i HOME=/private/tmp/rhythm-native-query-red.TJZ6lp/home TMPDIR=/private/tmp/rhythm-native-query-red.TJZ6lp/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npx --no-install vitest run src/__tests__/memory_retrieval_semantic.test.ts src/services/memory_retrieval_rerank.test.ts'` — expected regression failures before the implementation (five new assertions); pre-existing assertions remained green.
- Focused GREEN: `env -i HOME=/private/tmp/rhythm-native-query-green.o9jg8f/home TMPDIR=/private/tmp/rhythm-native-query-green.o9jg8f/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npx --no-install vitest run src/__tests__/memory_retrieval_semantic.test.ts src/services/memory_retrieval_rerank.test.ts'` — 56 tests passed.
- Non-server memory suite: `env -i HOME=/private/tmp/rhythm-native-query-green.o9jg8f/home TMPDIR=/private/tmp/rhythm-native-query-green.o9jg8f/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npx --no-install vitest run src/__tests__/memory_retrieval_semantic.test.ts src/services/memory_retrieval_rerank.test.ts src/__tests__/memory_injection.test.ts src/__tests__/memory_retrieval_default_mode_smoke.test.ts src/__tests__/memory_retrieval_ranking_smoke.test.ts src/contract/p0_memory_injection_relevance.test.ts'` — 102 passed; three stale expectations in the unmodified injection test still expect the retired preface wrapper.
- Isolated stale-wrapper reproduction: `env -i HOME=/private/tmp/rhythm-native-query-green.o9jg8f/home TMPDIR=/private/tmp/rhythm-native-query-green.o9jg8f/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npx --no-install vitest run src/__tests__/memory_injection.test.ts'` — 15 passed, the same three unrelated stale wrapper assertions failed; no change made.
- Named baseline: `env -i HOME=/private/tmp/rhythm-native-query-green.o9jg8f/home TMPDIR=/private/tmp/rhythm-native-query-green.o9jg8f/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'npx --no-install vitest run src/__tests__/issue_1573_semantic_degradation.test.ts'` — 10 passed, 3 known stale path-only/mock-confidence expectations failed unchanged.
- Typecheck: `env -i HOME=/private/tmp/rhythm-native-query-tsc.4W3CMa/home TMPDIR=/private/tmp/rhythm-native-query-tsc.4W3CMa/tmp PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /bin/zsh -f -c 'node node_modules/typescript/bin/tsc --noEmit --incremental false'` — exit 0. The `npx --no-install tsc` form was not used for qualification because it attempted registry resolution under the isolated environment; no package installation or network retry occurred.

## Decisions

- Keep automatic input at or below 128 UTF-16 code units without splitting surrogate pairs; long ASCII-token prompts use the existing capped token extraction, and no-token input uses a Unicode-safe bounded fallback.
- Apply this only to automatic hybrid and rank-only native calls. Explicit native reference search remains raw-query by contract.
- Keep the shared 500 ms budget, native-first ordering, candidate limit, filtering, validation, fences, and all selection budgets unchanged.

## Limitations

- Source and synthetic-test qualification only. No service, endpoint, app runtime, provider/model, private data, or live automatic-injection proof was run or claimed.
- Existing stale failures were preserved rather than weakened; their repairs are outside this narrowly authorized change.
