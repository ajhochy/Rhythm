---
date: 2026-10-05
repo: Rhythm
branch: codex/rhythm-dayflow-existing-renewal-20261005
pr: null
issues: []
status: partial
tags: [run, rhythm, dayflow, source-only, qualification, scheduler]
---

# Dayflow scheduler receipt renewal — source handoff

This is an additive source-only derivative of the installed R4 baseline
`5da2f764b5f240bb9650c58ce558a32aac2381e1`. It leaves the accepted R4
receipt selection, former revoked-scope exclusion, pending-row classification,
reader/admission fences, and all earlier run records unchanged.

## Frozen application delta

Application bytes froze at `2026-10-05T23:51:03Z` UTC, before this handoff
note was written. All work remains uncommitted in the isolated checkout.

| Path | R4 / 5da preimage SHA-256 | R5 frozen SHA-256 |
| --- | --- | --- |
| `apps/api_server/src/integrations/dayflow/service.ts` | `d85f98468e6dd502c1af949f1b35d3a930a314d363c3873804cf935d85276461` | `b96cbaf79f4b899fa358da689c1f022821f752f804e6988ede22edfab4e06fea` |
| `apps/api_server/src/server.ts` | `d5d4b49cda72f4580a9b82fdc26aed969e838c6520d4c604eecb97e6d8ab2cd8` | `a54b32cb044d9b2c285bedb6c85e2ea7a6506beb938715be35b80a05342722cd` |
| `apps/api_server/src/__tests__/dayflow_qualified_reader.test.ts` | `b93425a8a74355e8cfc71785b25cb6fdec5002ee7ca3e24306109d11bcf2a5ab` | `6ec81fdcc65c96633833341202ee99ea36a607b99a21793d73f85a0400da91e4` |
| `apps/api_server/src/__tests__/dayflow_coordinator_server_composition_contract.test.ts` | `a267c82f9efa8e95d885016c46fa714eed09c434f87cc295894c928108bcc372` | `72d22a6c56df9e4267c20589432c58031be0fcdb0a2133302de21288a3603d8b` |

## Source change

- `server.ts` adds one optional call to
  `dayflowService?.renewQualifiedEvidenceOnSchedulerTick()` inside the existing
  `onOneShotWorkstreamTick` callback. No scheduler, timer, route, service,
  grant, or coordinator binding was added.
- The producer coalesces overlapping boot/minute callbacks and uses the
  existing commit serialization. It creates no independent timer or queue.
- A two-minute lead window selects only current, active, complete,
  canonical-backed receipts in the current persisted owner/project/namespace/
  source/configuration/consent scope. It scans only the existing automatic
  current-plus-two-prior-day bound and selects only those pre-existing source
  identities; newly observed cards are never selected by renewal.
- Re-attestation still replays the existing source export, authenticated
  `createOnly` canonical writer, and qualification authority. It accepts only
  the exact prior canonical ID, content hash, source key, and
  `already_present` response. A missing or mutated canonical note remains
  withheld rather than recreated.
- Durable scope, generation, journal identity, and current source fingerprint
  are checked before/after the bounded export and after canonical/authority
  awaits. A current scope/configuration/consent/source change prevents the
  ledger save. A failed replay is attempted at most once per existing minute
  tick; the next existing tick is its only retry.
- Former revoked-scope, foreign, pending-create/pending-delete, tombstoned,
  malformed, and unqualified rows are never renewal targets. The R3/R4 reader
  selection and its empty-current hold remain unchanged.

## Focused source evidence

- PASS — `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/dayflow_qualified_reader.test.ts src/__tests__/dayflow_coordinator_server_composition_contract.test.ts --reporter=dot` — 47/47.
  - Uses `DayflowPersistedQualificationAuthority` and
    `AuthenticatedDayflowMemoryClient`, injected source clock, and the actual
    canonical receipt path.
  - Covers pre-expiry and post-startup-expiry renewal without a new grant or
    new import; current/former/foreign/pending/tombstoned mixes; missing or
    mutated canonical evidence; source/configuration/consent changes during
    renewal; disabled/no-op behavior; duplicate ticks plus a concurrent manual
    commit.
- PASS — `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/dayflow_shared_composition.test.ts -t 'projects only a current persisted qualified producer|bounds a complete 27-reference persisted qualified producer page|requires durable explicit source consent and rechecks it around canonical import|keeps the real authenticated canonical writer receiver on a first import' --reporter=dot` — 4/4, 15 intentionally skipped.
- PASS — `cd apps/api_server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`.
- PASS — `git diff --check`.

The unfiltered `dayflow_shared_composition.test.ts` still has its separately
known generic index-rebuild failure at unchanged test line 539 (null-owner
source lookup returns no row). It was observed during this run and remains out
of scope; no memory-index/writer path was changed here.

## Review and remaining gates

GitNexus is **UNKNOWN** for this exact checkout: `.gitnexus/run.cjs` is absent.
No indexing or alternate-checkout substitution was attempted. Manual caller
review covered the producer's normal commit/automatic-import paths, the
persisted qualification authority, authenticated canonical client, qualified
reader selection, and the scheduler boot/minute callback in
`agentSchedulerService.ts`.

No live Dayflow source, database/config/ledger, API/engine/server/app, model or
SDK turn, import, grant, UI/native capture, package action, or HTTP action was
run. Root must mechanically compose the frozen bytes and run the existing
invented stock scenario through a real normal activation/expiry interval before
claiming automatic renewal, receiving context, model injection, or product
acceptance.
