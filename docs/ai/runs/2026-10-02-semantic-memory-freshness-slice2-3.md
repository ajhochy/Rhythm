---
date: 2026-10-02
repo: Rhythm
branch: mega/2026-09-29-consolidation
pr: null
issues: []
status: reviewed
tags: [run, Rhythm, semantic-memory]
---

# Semantic memory freshness — slices 2 and 3

## Files

- `apps/api_server/src/services/memoryVaultWriteService.ts` — added post-lock, non-throwing canonical mutation notifications for lifecycle, update, delete, and kind moves; records safe promotions that later fail and distinguishes completed rollback from a partial safe move.
- `apps/api_server/src/__tests__/memory_canonical_mutation_notification.test.ts` — covers ordinary mutation signals, no-op retries, post-promotion failure, rollback, and partial move behavior.
- `apps/api_server/src/services/engraph_refresh_scheduler.ts` — new pure revision/debounce/retry scheduler, not yet wired to the manager.
- `apps/api_server/src/services/engraph_refresh_scheduler.test.ts` — deterministic burst, max-delay, in-flight mutation, bounded retry, and disposal tests.

## Checks

- PASS — `npx vitest run src/__tests__/memory_canonical_mutation_notification.test.ts src/__tests__/memory_vault_external_edit.test.ts src/__tests__/memory_lifecycle_index.test.ts src/__tests__/memory_write_vault_first.test.ts src/services/engraph_refresh_scheduler.test.ts src/__tests__/memory_vault_authority.test.ts src/__tests__/memory_vault_index_writer.test.ts src/__tests__/memory_vault_sync.test.ts --maxWorkers=1` — 8 files, 97 tests.
- PASS — `npx tsc --noEmit`.
- PASS — `npm run build`.
- PASS — `git diff --check`.
- PASS — Sol's compiled `review-slice2-3-probes.cjs`: all 8 cases passed after correcting mutation ordering, idempotent lifecycle projection repair, synchronous scheduler throws, retry/cooldown protection, explicit retry replacement, and epoch-zero debounce handling.

## Decisions

- Canonical notifications remain opt-in and execute only after the mutation lock releases; no default manager subscriber was introduced.
- A safe physical promotion that subsequently errors remains dirty for reconciliation. An unsafe/path-raced destination is not marked. A fully rolled-back kind move emits no event; a safe destination left behind is destructive.
- Scheduler is intentionally dependency-free; lifecycle/process ownership integration is deferred to slices 4–7.

## Deviations

- The delegated end-to-end manager, sync, default-wiring, and live behavioral slices are not complete in this run.

## Concerns

- Slice 4 must serialize the existing manager stop/index/serve/health lifecycle before the new scheduler can be connected. No live server, model, vault, or app instance was started.
