---
date: 2026-10-06
repo: Rhythm
branch: uncommitted isolated Dayflow renewal checkout
pr: null
issues: []
status: source-checked
tags: [run, rhythm, dayflow, source-only, renewal]
---

# Dayflow canonical renewal deletion safety

## Scope

This is the narrow correction to the scheduler/automatic receipt-renewal work
against immutable base `5da2f764b5f240bb9650c58ce558a32aac2381e1`.
It preserves the prior scheduler binding and changes reattestation only: an
expired receipt now requires a matching canonical observation inside the
existing vault mutation lock. It cannot use the ordinary conditional-create
path to recreate a deleted observation.

Normal first import and pending-create recovery retain `createOnly`. The
reattest path uses the new optional `validateExisting` contract. The normal
authenticated writer implements it by passing `requireExisting: true` into
`createObservationIfAbsentInVault`; a client without that capability is held
rather than falling back to create.

## Changed paths

- `apps/api_server/src/integrations/dayflow/service.ts` — both the existing
  fifteen-minute importer and the minute scheduler converge on exact
  existing-only canonical validation before minting a fresh receipt.
- `apps/api_server/src/integrations/dayflow/memory_client.ts` — adds the
  no-create reattestation contract.
- `apps/api_server/src/integrations/dayflow/authenticated_memory_client.ts` —
  carries that contract through the authenticated scope/owner checks to the
  vault writer.
- `apps/api_server/src/services/memoryVaultWriteService.ts` — adds a locked
  `requireExisting` mode: absent canonical data returns
  `MEMORY_CREATE_CONFLICT` before note, index, or navigation creation.
- `apps/api_server/src/__tests__/dayflow_create_only_writer.test.ts` — real
  temporary-vault first create, exact replay, conflicting content, and a
  lock-ordered delete-versus-two-renewals regression.
- `apps/api_server/src/__tests__/dayflow_qualified_reader.test.ts` — real
  persisted authority plus authenticated writer coverage for deletion during
  each renewal cadence; existing source/consent/configuration/restart tests
  assert strict mode.

The retained R5 scheduler files remain part of the full uncommitted delta from
`5da`: `apps/api_server/src/server.ts` and
`apps/api_server/src/__tests__/dayflow_coordinator_server_composition_contract.test.ts`.
They are unchanged by this deletion correction.

## Safety result

- A valid existing canonical observation still returns `already_present` and
  can be requalified under the unchanged current authenticated scope.
- Missing/deleted or differing canonical content fails closed before a new
  note, index record, derived navigation content, or qualification receipt is
  written.
- The validation happens under the established canonical mutation lock, so a
  preflight/read cannot race with a delete into an ordinary create.
- Existing post-await source, consent, owner/project, namespace,
  configuration-generation, operation, canonical-key/hash, revoke, and
  archive checks remain in place. Old/revoked receipts and unqualified pending
  rows are not adopted.

## Focused checks

All commands ran in `apps/api_server` without launching an API, engine, model,
or native application.

- `./node_modules/.bin/vitest run src/__tests__/dayflow_create_only_writer.test.ts src/__tests__/dayflow_qualified_reader.test.ts src/__tests__/dayflow_coordinator_server_composition_contract.test.ts --reporter=dot`
  — 3 files, 59 tests passed.
- `./node_modules/.bin/vitest run src/__tests__/dayflow_shared_composition.test.ts -t 'projects only a current persisted qualified producer|bounds a complete 27-reference persisted qualified producer page|requires durable explicit source consent and rechecks it around canonical import|keeps the real authenticated canonical writer receiver on a first import' --reporter=dot`
  — 1 file, 4 selected tests passed (15 intentionally skipped).
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — passed.
- `npm run build` — passed (`tsc -p tsconfig.json`, security advisory copy
  postbuild only).
- `git diff --check` — passed.

GitNexus exact-checkout analysis remains `UNKNOWN`: this isolated checkout has
no `.gitnexus/run.cjs`, and no reindex or substitute repository was used.
Manual caller review established that the ordinary authenticated server path
uses `AuthenticatedDayflowMemoryClient`, and both renewal cadences meet at
`DayflowIntegrationService.commitInternal`.

## Frozen application bytes

Frozen at `2026-10-06T00:20:51Z` after the checks above:

```
cf118dbff4bcbcc1ba7f89f6bca793ecb1a23b172c74faac02f86722c2da8fa8  apps/api_server/src/integrations/dayflow/service.ts
43489d403f47f7746cfebcdc82feee4ae090aaf8806af4f0fd20f13019d14f70  apps/api_server/src/integrations/dayflow/memory_client.ts
4bc0a2a0f69f52d58f145edf60ec7fe55f64687cbb984d93e18d1547ba90c77e  apps/api_server/src/integrations/dayflow/authenticated_memory_client.ts
8e20842739605fe321d1126adeb25e144711b97a7065271775be0fb9ae040eba  apps/api_server/src/services/memoryVaultWriteService.ts
cf2daf18e9f478b6fd81d1682ad753d7080ec2fc687fc937bdd4c31347167d46  apps/api_server/src/__tests__/dayflow_qualified_reader.test.ts
4cb63f7381e4e0f42b4e4cf9776789cfcec938f72bcab3bf29d200a7285012ab  apps/api_server/src/__tests__/dayflow_create_only_writer.test.ts
a54b32cb044d9b2c285bedb6c85e2ea7a6506beb938715be35b80a05342722cd  apps/api_server/src/server.ts
72d22a6c56df9e4267c20589432c58031be0fcdb0a2133302de21288a3603d8b  apps/api_server/src/__tests__/dayflow_coordinator_server_composition_contract.test.ts
```

## Remaining limits

This is uncommitted, source-only evidence. No normal API/engine run, actual
Dayflow import, consent/configuration action, receiving-context exposure, or
automatic reader-continuity claim was performed. Root must compose these exact
bytes and run the existing invented stock scenario followed by safe normal
qualification before product acceptance.
