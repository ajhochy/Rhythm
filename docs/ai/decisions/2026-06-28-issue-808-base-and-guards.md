---
date: 2026-06-28
repo: Rhythm
tags: [decision, Rhythm]
issues: [808, 801, 807]
index: "[[Rhythm]]"
---

# #808 memory guards — base branch + recall-identity choices

## Context

Issue #808 is the final guard issue of the memory-vault epic (#801, 7/7). The
dispatch said to base on `origin/feature/mem-vault` and that #802–#807 were
"merged to feature/mem-vault". A spec correction said #807 had REMOVED the prod
`agent_memory` store and made `/agent-memory` local-only, with a seed assertion
already present in `issue_755_role_separation.test.ts`.

But on fetch, `origin/feature/mem-vault` only carried #802–#804; #805/#806/#807
existed only as commits on a **local** `Feature/mem-vault` (capital F) branch
that had not been pushed. On `origin/feature/mem-vault` the prod
`agent_memory` table was still created (postgres_bootstrap.ts L544-559) and the
`/agent-memory` route comment had no #807 local-only note — i.e. the spec
correction's facts did not hold there.

## Decision

1. **Base on local `Feature/mem-vault`, not `origin/feature/mem-vault`.** It is
   the real, up-to-date integration branch (#802–#807) and the only base where
   the spec correction is true (prod store removed, route gated local-only, the
   #807 prod-removal seed assertion present). This matches the dispatch's
   *intent* ("builds on #802–#807, merged to feature/mem-vault"); the remote ref
   was simply stale.

2. **Assert recall identity across a rebuild by note CONTENT / path+content, not
   the SQLite row id.** `AgentMemoryRepository.upsertBySourceAsync` assigns the
   row `id` via `randomUUID()` on every (re)index, so the row id is NOT stable
   across a drop+rebuild. The stable identity is the vault note (its path +
   body). The smoke matches an authored unique MARKER in `content` (also avoids
   logging real note bodies); the unit guard projects `sourceId::content`.

## Alternatives

- Base on `origin/feature/mem-vault` as literally written → the prod-removal
  guard (AC3 corrected) would be impossible to satisfy (the table is still
  created there), and I'd be writing guards against a state #807 already
  superseded. Rejected.
- Assert recall by row id → would fail after any rebuild (fresh UUID). Rejected.

## Consequences

- My worktree branch sits on top of #807, so when `Feature/mem-vault` is pushed
  and this work lands, the guards line up with the merged prod-removal code.
- If someone instead pushes the older `origin/feature/mem-vault` and merges #808
  there, the prod-removal guard will (correctly) FAIL until #805–#807 are also
  merged — which is the intended safety behaviour, not a bug in the guard.
- Found (out of scope, flagged as follow-up): the write path and the rebuild
  scan record different `source_id` for the same note (`fact/x.md` vs
  `memory/fact/x.md`), which could double-index a note touched by both writers.
