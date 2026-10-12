---
date: 2026-10-05
repo: Rhythm
branch: codex/rhythm-coordinator-dayflow-binding-20261005
status: unverified
tags: [run, rhythm, dayflow, coordinator, source-only]
---

# Qualified Dayflow context bounded projection

## Files

- `apps/api_server/src/services/dayflow_coordinator_reference_adapter.ts` now obtains one complete producer page per existing fresh snapshot at the supported 3000-item bound, validates the entire attested set, derives its aggregate receipt fingerprint first, and then projects a deterministic maximum of 25 opaque references with explicit coverage.
- `apps/api_server/src/__tests__/dayflow_coordinator_reference_adapter.test.ts` covers a complete 27-reference page, deterministic selection, aggregate-receipt change from an omitted tail reference, a remaining cursor, and an overbounded page.
- `apps/api_server/src/__tests__/dayflow_shared_composition.test.ts` exercises the real persisted qualified producer fixture with 27 imported invented records and confirms the 25-item projection/coverage without observation text.

The existing server lazy reader/authority construction, Dayflow producer, persisted qualification authority, and context assembler are unchanged in this delta.

## Checks

- PASS — focused coordinator adapter test: 6 tests.
- PASS — focused context assembler test: 4 tests.
- PASS — server composition contract: 1 test.
- PASS — `node node_modules/vitest/vitest.mjs run src/__tests__/dayflow_shared_composition.test.ts --fileParallelism=false -t 'projects only a current persisted qualified producer|bounds a complete 27-reference persisted qualified producer page'` (2 selected tests; 17 unrelated tests target-filtered).
- PASS — API TypeScript no-emit typecheck.
- PASS — `git diff --check`; incremental patch forward dry-run and reverse apply check.

## Notes

- GitNexus is unindexed in this checkout (`Repository not indexed`); manual caller review was limited to `server.ts`, the runtime adapter assembly, and the context assembler. No reindex was attempted.
- The source remains fail-closed for partial/cursored, overbounded, malformed, duplicate, foreign, revoked, changed, expired, or unavailable input. Context remains capped at 25 items; coverage truthfully reports a larger complete source.
- No runtime/API/engine/model/import/grant/UI action was performed. Root must compose and validate the normal application separately; this record does not claim live Dayflow context connection.
- A temporary `/private/tmp` preimage reconstruction directory could not be deleted because the sandbox rejected the deletion command. It is outside the checkout and contains only local source preimages.
