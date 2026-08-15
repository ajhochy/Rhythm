---
date: 2026-08-15
repo: Rhythm
branch: self-improvement/scope-lifecycle-composition
pr: none
issues: [W1-corrective-6]
status: reviewed-clean
tags: [run, Rhythm]
---

# W1 corrective-6 — packages A, B and the first C slice

## Files

### Package A — boundary corrections (`self-improvement/scope-boundary-corrections`, `0ddf82fd`)
- `services/scope_mutation_contract.ts` — canonical grant-delegation `add` is no
  longer generic scope evidence; every other subtree is still recursively
  inspected.
- `services/org_proposal_apply_service.ts` — `create-agent` consumes only typed
  top-level scope strings and the remainder is scanned with target evidence
  injected; `refine-config.configPatch` must be exactly
  `{agentConfigId, field, value}`.
- `services/org_proposal_appliers_wiring.ts` — the same exact-key rule in the
  direct applier.
- `services/org_proposal_measure.ts` — refine-scope and removal measurement
  require an exact v2 snapshot/change binding against the LIVE target, and the
  target is re-checked after the awaited behavioural rerun.
- `services/profile_capability_surface.ts` — `corePermissionBehaviorSignature`
  mirrors the engine: default-ask, insertion order, last-match-wins, hardline
  projection.

### Package B — revision/persistence corrections (`self-improvement/revision-lifecycle-corrections`, `d1a09338`)
- `repositories/agent_org_proposals_repository.ts` — the atomic transition
  derives target id, field, prior and applied bytes from the verified canonical
  v2 snapshot instead of trusting the caller; the generic status CAS refuses
  scope arrivals at `applied`; the legacy `claimAppliedWithSnapshotAsync` seam is
  disabled for every scope kind; the revision-bound seam requires both safe
  revisions at runtime and is genuinely async; snapshot validation accepts only
  literal synchronous `true`.
- `database/migrations.ts` — `installRevisionInvariants()` installs the revision
  column, its safe non-negative integer domain and a raw-writer auto-bump at each
  table's CREATE site, before any seed or content repair can write. Pre-existing
  unsafe material fails the migration CLOSED.
- `database/postgres_bootstrap.ts` — the same non-negative CHECK plus a BEFORE
  UPDATE bump that leaves explicit repository increments alone.
- `repositories/agent_configs_repository.ts` — `readPersistedRevision` refuses to
  hand out a corrupt persisted revision.

### Package C slice 1 — lifecycle rewire (`self-improvement/scope-lifecycle-composition`, `3c27a728`)
- NEW `services/agent_profile_projection_service.ts` — the one projection
  boundary. Callers pass a profile id plus the revision they believe they are
  projecting; the boundary re-reads the latest row itself. No await between the
  latest read and the file replace.
- NEW `services/org_proposal_scope_lifecycle.ts` — claim `approved` → atomic
  target+proposal pair → revision-fenced projection → `measuring`, with the exact
  atomic inverse on an unprovable projection and `reconciliation-required` when
  even that cannot be proved. An ambiguous transaction is classified by reading
  BOTH rows back, never from the thrown error text.
- `controllers/org_proposals_controller.ts` — scope kinds take the new route;
  non-scope kinds keep the generic claim.
- `services/org_proposal_apply_service.ts` / `org_proposal_appliers_wiring.ts` —
  the `applyAfterClaim` callback seam is gone, replaced by a declarative
  `scopePair`. A target mutation after a `proposed -> applied` claim could not be
  fenced on the target revision.
- Package B review follow-ups: ANY scope arrival at `applied` now requires the
  atomic pair, and an explicit revision write must move FORWARD (SQLite +
  Postgres) so a rollback cannot revive a stale CAS token.

## Checks

| Gate | Result |
|---|---|
| node | v22.23.1 |
| A `0ddf82fd`: W1 gate | 396 passed, 1 skipped |
| A: focused matrix | 79 passed |
| A: reviewer probe | exit 0, all five prior exploits closed |
| A: independent review | **ACCEPT** — 0 P0, 0 P1, 2 P2 |
| B `d1a09338`: package suite | 43 passed |
| B: focused lane | 101 passed |
| B: independent review | **REJECT** — 1 P1, 2 P2 (all fixed in C with permanent tests) |
| C `3c27a728`: W1 gate | 400 passed, 1 skipped |
| C round 2 review | **REJECT** — 2 P1 (stale revert projection; `approved` had no exit) |
| C `2a403960` round 3 review | **REJECT** — 1 P1 (`applied` strand), 2 P2 |
| C `1d32c4bc` round 4 review | **REJECT** — 0 P0/P1, 3 P2 (two were regressions in the round-3 fixes) |
| C `c947daf8` round 5 review | **ACCEPT** — 0 P0, 0 P1, 2 P2 (both: revert lane duplicated the apply lane's classifier) |
| C `6fb96d26` final: W1 gate | 400 passed, 1 skipped, exit 0 |
| C final: focused matrix | 209 passed |
| C final: lifecycle suite | 5 passed |
| C final: build + postbuild | exit 0 |
| C final: `git diff --check` | clean |
| C final: added-line scan | 0 real hits (`db.exec(` false positives reviewed) |
| C final: all 9 reviewer probes | clean |

## Notes

- The B package's strict primitives made 31 existing service/controller tests
  red. That was the Package C dependency, not a reason to re-enable the unsafe
  legacy seam: the services genuinely still claimed `applied` before the target
  was fenced. Old callback-shaped coverage was rewritten against the production
  lifecycle rather than deleted.
- Fixtures that need a durable `applied` row now use
  `src/__tests__/helpers/force_applied_scope_fixture.ts`, an explicitly-named raw
  SQL helper, so no test can accidentally assert that the refused transition is
  permitted.
- Two reviewer probes now fail EARLY (`/tmp/w1-c6-unsafe-stored-revisions.ts`,
  the legacy-schema section of `/tmp/w1-c6-package-b-adversarial.ts`) because
  their corruption setup is rejected by the stricter schema. That is fail-closed
  behaviour; permanent defense-in-depth tests cover the same ground.

## Review rounds

Five independent read-only adversarial reviews, each against an immutable SHA,
each blocker reproduced by the parent before being fixed:

1. A — ACCEPT.
2. B — REJECT: the scope `applied` guard covered only the `approved` edge, so a
   proposal walked `proposed -> failed -> applied -> measuring` with the target
   untouched; revisions were not monotonic (a rollback revived a stale CAS token).
3. C — REJECT: the revert lane projected a caller-held row (silently WIDENING
   the engine's live scope); `approved` had no reachable exit.
4. C — REJECT: the `applied` strand — the reconciliation net at the measuring
   CAS was dead code because that primitive throws rather than returning null.
5. C — REJECT (P2 only): two of the round-3 fixes were over- and under-applied.
6. C — ACCEPT: remaining P2s were one root cause, the revert lane hand-rolling
   the apply lane's classifier. Extracted into `scope_pair_classification.ts`.

The pattern worth recording: rounds 4 and 5 found defects in the FIXES, not in
the original design, and both traced to the same two lanes being written twice.

## Deferred (next C slice)

- `reconciliation-required` as a durable proposal status/column, propagated
  through measurement outcomes, optimizer counters and the routes.
- The durable projection ledger/outbox and the bounded recovery sweep.
- Rewiring the remaining `writeAgentProfileFile` callsites (controllers, seeds,
  import/export, sync, server startup) through the projection boundary.
- The Flutter operator client must not render a reconciliation response as
  "approved".
