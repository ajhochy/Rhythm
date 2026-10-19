---
date: 2026-10-02
repo: Rhythm
branch: mega/2026-09-29-consolidation
pr: null
issues: []
status: partial
tags: [run, Rhythm, semantic-memory, native-reference]
---

# Native Engraph reference core

## Files

- `apps/api_server/src/services/engraph_client.ts`
- `apps/api_server/src/services/memory_retrieval.ts`
- `apps/api_server/src/routes/engraph_manager_routes.ts`
- Focused semantic/E2E/route contracts.

## Checks

- `cd apps/api_server && npm run lint && npm run build` — pass (`lint` currently reports its repository placeholder, `TODO: add eslint`).
- `cd apps/api_server && npx vitest run src/__tests__/memory_retrieval_semantic.test.ts src/__tests__/memory_semantic_e2e.test.ts src/contract/p0_memory_injection_relevance.test.ts src/__tests__/engraph_manager_routes.test.ts --maxWorkers=1` — 4 files, 51 tests pass.
- `git diff --check` — pass.

## Notes

- Native rank is released only as bounded, fenced reference evidence; confidence remains null. The shared `searchMemoryReferences` DTO is exported for the MCP/API owner and caps explicit results at 5 / 2,000 excerpt characters / 5,000 serialized characters.
- Sol's native-core review corrections added selected canonical-file revalidation (regular/readable, confined realpath, current body and lifecycle metadata), heading-plus-body retention, delimiter neutralization, capped native pages and finite explicit limits, plus a shared FTS/native deadline. New fixtures cover deleted, changed, deprecated, unreadable and symlinked selected notes; hostile fence delimiters; content-only responses; and hung FTS with native success/failure.
- `cd apps/api_server && npx vitest run src/__tests__/memory_retrieval_semantic.test.ts src/__tests__/memory_semantic_e2e.test.ts src/contract/p0_memory_injection_relevance.test.ts src/__tests__/engraph_manager_routes.test.ts src/__tests__/memory_semantic_latency_smoke.test.ts src/services/memory_retrieval_rerank.test.ts src/__tests__/memory_provenance.test.ts --maxWorkers=1` — 7 files, 77 tests pass.
- The original independent `review-native-core.cjs` is no longer a valid acceptance fixture without adjustment: its positive rows intentionally have no canonical files, which the new required selected-note validation suppresses. It consequently reports 12/14 booleans but does not exercise a valid release or hostile-fence path (both become empty). The repository regressions now create canonical temporary notes and cover those successful paths. Sol must update/re-run the independent fixture before approving the candidate patch.
- Follow-up retest corrections: canonical equality now preserves signs/operators/case instead of stripping punctuation; canonical validation is bounded by the shared retrieval deadline; final prompt assembly fences and delimiter-sanitizes every retrieval lane; and bounded origin/observation metadata from structured tags/sources is retained in references and body-free provenance. Independent synthetic probes now report native core 25/25 and observation boundaries 11/11; real API/fork qualification remains blocked by the recorded sandbox executable-ownership refusal.
- Fable review follow-up: multiline/native-markup snippets use a whitespace-collapsed comparison only for snippet containment and tolerate a trailing native `...` marker while retaining display evidence; strict canonical body equality still preserves signs/operators. Invalid selected candidates now continue to lower native ranks, deadline expiration still stops the pass, shared fence constants are imported, cap exhaustion retains its true retrieval status, and direct semantic helper defaults to the manager-owned authenticated retrieval client. Added captured-shape and invalid-rank-one/valid-rank-two regressions.
- Final display-marker correction: the display-only comparison now removes an attached trailing `...` or `…`, not only a whitespace-separated marker. HTTP-client-to-helper regressions cover both attached forms; strict canonical body equality is unchanged. `review-native-core-fable-additional.cjs` passed 28/28, `review-native-core-display-cap.cjs` passed 3/3, and `review-observation-boundaries.cjs` passed 11/11 using only temporary synthetic canonical fixtures. The focused aggregate route/E2E command remained incomplete in this busy checkout after its initial pre-existing route/E2E test output; the direct semantic retrieval suite passed 34 tests and `npm run build` passed.
- No app/server restart, live vault access, model activation, deploy, push, or sandbox behavioral run occurred. The mandatory real API/engine sandbox gate remains blocked by the delegated scope's no-restart instruction and by the absence of an approved sanitized fixture root/configuration in this task.
- Freshness lifecycle slice L and the default canonical-mutation bridge remain incomplete and intentionally untouched here.
