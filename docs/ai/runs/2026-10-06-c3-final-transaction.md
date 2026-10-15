---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-composed
tags: [run, rhythm]
---

# C3 final transaction-boundary correction (source only)

Authority: `docs/ai/review/2026-10-06-c3-final-transaction-astra-review.md` and `docs/ai/review/2026-10-06-c3-followon-sol-verification.md`. Only `CoordinatorConversationsRepository.outer()`, the saved/useful tests and this log changed. Core items 1/2 (`f1efad59…9a10`), permission, memory, relay, lazy, Dayflow, mobile and fork source untouched. No commit.

## Change

`outer()` now captures `callerOwned = top && db.inTransaction` BEFORE opening its own savepoint. On every top-level exit it always clears the pending batch; it publishes only when the repository's transaction returned successfully, the invocation was not caller-owned, and no transaction remains open (`!db.inTransaction`). Nested repository-owned batching, same-transaction outbox writes, the current-scope lookup and publication-failure isolation are unchanged. No registry, queue, timer or transaction abstraction.

## Files

- `repositories/coordinator_conversations_repository.ts`: preimage `0658ac57c8f2acf148f5cc0fb7b833612998b291cd230811f2cb5e329cfb8f4a` → `f9c65cf7483ca8cd851e75a162815fbc909f903d144c76bb64b210f066335308`.
- `__tests__/c3_backend_followon.test.ts`: preimage (Sol patch `2e76270b…d3a2` already applied) `2a24e9a9253dd9b5ed5d83d4d1a724cbb2814d6d692708f0026948121af1f1a8` → `0c1496e11fc52f04c8ce434dd50af4179e9afec6dc182a010f143cb5587197d5`; added one case, Sol assertions untouched.
- `__tests__/coordinator_conversation_vertical.test.ts`: unchanged by me (Sol's terminal-observer assertions run as saved).

## Results (repo root)

- **Red first** — `c3_backend_followon.test.ts -t "Sol: caller-owned"` → 2 failed (commit: hint published while the caller's transaction was open, `[true]` ≠ `[]`; rollback: one hint escaped for a rolled-back write, 1 ≠ 0).
- **Green** — same file, selector `Sol: caller-owned|later independent|publishes foreground|status input|publication failure|rolls the outbox|dirties the root agent_sessions` → 7 passed, 6 skipped (Sol's two negatives; own-transaction positive/foreground; rollback-with-outbox; publication-failure isolation; the new later-independent case).
- **New later-independent case** — after a caller-owned rollback and a caller-owned commit the pending batch is empty; a later repository-owned replay (no write) publishes nothing; a later owned `addGoal` + status write publish exactly two hints and leave nothing pending.
- **Actual terminal observer** — `coordinator_conversation_vertical.test.ts -t "automatically consumes only the next finite ordinal after a strict terminal receipt, even when a sibling idea advanced the chat control revision"` → 1 passed, 10 skipped.
- `npm --prefix apps/api_server run build` → pass. `git diff --check` → clean. Not run: the 342-case group, memory/ledger/OpenDesign baselines.

## Scope statement

Source/test only, against synthetic SQLite and the singleton hub. Not composed, installed or live. Per Sol, no current production caller wraps these methods in an external transaction, so this is a helper-contract correction, not an observed live failure. Caller inventory reviewed by hand (GitNexus unavailable): `outer()` is called only by `designatePrimaryOwnerRoot`, `createPrimaryOwnerRoot`, `addGoalFromMessage` and `recordStatusMessage`; `markCommitted` only by `saveCurrent` and designation.
