---
date: 2026-10-05
repo: Rhythm
branch: codex/rhythm-dayflow-qualification-refresh-20261005
pr: null
issues: []
status: partial
tags: [run, rhythm, dayflow, source-only, qualification]
---

# Dayflow qualified-receipt freshness — source handoff

The R1 expiry-renewal record frozen at `2026-10-05T21:03:35Z` is retained
below. The current R2 additive derivative remains uncommitted, source-only
work in this isolated checkout, from preimage
`16eeeb89b64a3dfeb012f227fa218e0d9d63dab8`.

## Changed paths and SHA-256 delta

| Path | Preimage | Current |
| --- | --- | --- |
| `apps/api_server/src/integrations/dayflow/service.ts` | `1dc7746f9c72cd2f319d56b5469464d7eca0e586cad4d563c9db549e9781fb43` | `cacf00783c25c885c24b6e82b1f1ed0d88b708cfbab02033cafa66e101fb477f` |
| `apps/api_server/src/__tests__/dayflow_qualified_reader.test.ts` | `c4586c9cad83dbacb6f39738a07eb2a9833269d747b24900739720584c049684` | `b7feb9d16880a61b3ed3453d3b1706f9c857b291327da6591cca84761146e74b` |

## Source change

- The existing 15-minute automatic cadence already revisits unchanged cards, but previously skipped a completed same-revision row before renewing its 15-minute qualification receipt.
- An expired receipt can now renew only when its durable ledger receipt is parseable, active, current-scope/current-configuration matched, same revision/content/export version, and backed by the existing durable operation ID.
- Renewal replays the existing authenticated `createOnly` path and accepts only an `already_present` receipt for the same canonical ID. That path validates canonical provenance and owner consent; a newly-created response, absent/malformed/foreign/retracted receipt, pending state, changed source, revoked consent, or failed post-await proof remains withheld.
- A renewed ledger receipt is saved only after the existing source/authority post-await checks. It is reported as `skipped`, not a new import/task completion.

## Focused evidence

- PASS — `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/dayflow_qualified_reader.test.ts --no-file-parallelism` — 29/29.
  - Includes actual `DayflowPersistedQualificationAuthority` plus `AuthenticatedDayflowMemoryClient` wiring across receipt expiry and the existing automatic cadence.
  - Covers consent revoke and journal identity change during canonical re-attestation, and a changed revision after an uncertain original create remaining pending/conflicted rather than being promoted.
- PASS — `cd apps/api_server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`.
- PASS — `git diff --check`.
- GitNexus: `gitnexus status` reported this exact checkout unindexed. Supported CLI impact attempts could not identify an exact-checkout graph; no indexing or alternate-checkout substitution was performed. Manual caller review covered `server.ts` composition, the automatic cadence, management commit route, authenticated canonical client, persisted authority, and qualified-reader consumers.

## Held / out-of-scope evidence

- OUT OF SCOPE — `dayflow_shared_composition.test.ts` has an isolated existing failure in its generic index-rebuild fixture: the writer's vault-root-relative source key differs from the rebuild scan's memory-subdirectory-relative key, so its lookup is empty. The failure reproduces alone and occurs before any changed producer path; none of its writer/index/test files changed here. It was not repaired in this narrowly owned slice.
- The source-only test proves a changed revision behind a pending create must remain held. It does not establish that this is the cause of the ten observed live pending creates, and no live ledger/canonical data was read. A safe promotion would require the old exact canonical source payload and provenance, which the durable pending ledger intentionally does not retain.
- `qualifiedEvidenceStateNow` still omits expired receipts, so before the next successful cadence its page can be `available` with an empty qualified set. The coordinator/core complete-page consumer must not treat that temporary empty page as durable evidence absence, including any bounded-page (`>25`) decision. No C2 consumer code was edited.
- A distinct in-process canonical-conflict classification difference was observed during source review; it may affect response labeling but does not safely recover a pending revision and is not linked to the observed ten rows. It remains untouched to avoid expanding this repair.

## Runtime gates

No API, engine, model/SDK turn, native/UI, capture, import, consent, configuration, database, package install/build, service, or live HTTP action was run. Root must still run the normal authenticated status/context check and actual automatic-context admission before any runtime or end-to-end usefulness claim.

## R2 — explicit same-scope re-attestation after a fenced configuration rotation

Source derivative checked at `2026-10-05T21:25:16Z`. The supplied
metadata-only receipts establish only that the prior consent generation was
durably revoked after a configuration rotation while owner/project/namespace/
source identity matched. They are diagnostic evidence, not current authority;
no live consent, source, ledger, database, HTTP, or canonical content was read
or changed.

| Path | R1 SHA-256 | R2 current SHA-256 |
| --- | --- | --- |
| `apps/api_server/src/integrations/dayflow/service.ts` | `cacf00783c25c885c24b6e82b1f1ed0d88b708cfbab02033cafa66e101fb477f` | `9f898da91dd559af89e1c254542cdb98ce9f6c5ddc55a13ff7f3af00a82bcddb` |
| `apps/api_server/src/__tests__/dayflow_qualified_reader.test.ts` | `b7feb9d16880a61b3ed3453d3b1706f9c857b291327da6591cca84761146e74b` | `8c473222102fb9ca8a98063e914f966699c568eeca2a588362f146f13100cbb2` |

R2 source freeze: `2026-10-05T21:30:14Z`. The two hashes above are the
mechanical-composition inputs; this run note is a new handoff artifact and its
final file hash is reported with the handoff rather than recursively embedded.

- The importer now permits the existing bounded automatic cadence to
  re-attest an unchanged completed observation after a new current explicit
  consent only if a synchronous persisted authority scope matches the old
  receipt's owner, project, namespace, and native source identity.
- The old receipt is provenance only. The producer validates its opaque source
  and revision identity, content/export/normalizer fields, canonical ID,
  canonical key/hash/version, and durable operation ID; it deliberately does
  not treat its old consent/configuration generation as authority.
- Canonical replay must return `already_present` for the exact same canonical
  ID, private source key, and content hash. A `created` response or any key/
  hash mismatch leaves the old row withheld; no renewal recreates a note.
- The strict reader match remains unchanged, so the old consent/configuration
  receipt remains invalid for retained receiving history. Existing post-await
  source, current-scope, revocation, and generation checks remain in front of
  every save.
- Pending recovery remains before re-attestation and still requires matching
  revision/content/operation ID. The R2 change neither infers authority from
  the 16 pending rows nor claims they are recoverable without a current scope.

### R2 focused evidence

- PASS — `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/dayflow_qualified_reader.test.ts --no-file-parallelism` — 34/34.
  - Uses actual `DayflowPersistedQualificationAuthority` and
    `AuthenticatedDayflowMemoryClient` with an invented canonical writer.
  - Covers import → configuration rotation/durable revoke → withheld → new
    synthetic same-owner/project grant → existing 15-minute cadence → exact
    `already_present` re-attestation; an unrelated owner/project grant is
    denied before canonical replay.
  - Covers a rejected `created` replay and rejected differing canonical key/
    hash, plus same-revision pending recovery only after a current scope exists;
    it preserves R1 expiry, revoke-during-await, source-change, and
    changed-pending-revision holds.
- PASS — `cd apps/api_server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`.
- PASS — `git diff --check`.
- Test-authoring note: the first pending-recovery assertion used
  `toMatchObject({ pendingCreateAt: undefined })`; the recovered ledger
  correctly omits that optional field. The focused failure reproduced, then the
  assertion was corrected to `toBeUndefined()` without changing producer code.
- GitNexus exact checkout remains unregistered (`gitnexus status`); supported
  exact-checkout impact calls reported no selectable graph. No indexing or
  alternate-checkout substitution occurred. Manual caller review covered the
  automatic importer, persisted authority, authenticated canonical client,
  reader integrity gate, and management composition boundary.

### R2 remaining qualification blockers

- No new live grant exists. The user's restore/off choice remains the only
  authority for any actual sharing action; elapsed time cannot restore it.
- Root must mechanically compose the source bytes and run its normal stock
  authenticated HTTP/status/context check. This source result does not claim
  live restoration, useful coordinator context, or end-to-end automatic import
  success.

## R3 — mixed-ledger current-qualified selection

Source derivative frozen at `2026-10-05T22:25:09Z`. This is the bounded delta
from the locally loaded R2 source state; it does not alter R1/R2 behavior,
native source identity, source consent, configuration, ledger data, or runtime
composition.

| Application path | R2 local SHA-256 | R3 frozen SHA-256 | R3 Git blob |
| --- | --- | --- | --- |
| `apps/api_server/src/integrations/dayflow/service.ts` | `9f898da91dd559af89e1c254542cdb98ce9f6c5ddc55a13ff7f3af00a82bcddb` | `f6ac5b9a794e604b4356a83ff7c714507f2496e757eabe6e1287ac17fa1c68c0` | `30de784693b3043a0a52da021d59482dd5f0d2b2` |
| `apps/api_server/src/__tests__/dayflow_qualified_reader.test.ts` | `8c473222102fb9ca8a98063e914f966699c568eeca2a588362f146f13100cbb2` | `0b839a58ce136ae803091b51e3121412dc32d01240447b41aa62518563ece016` | `0639ef0ff1baf2ab3fb1674f716beb183309394e` |

- `qualifiedEvidenceStateNow` now first reconstructs the complete signed,
  exact-current-scope selection. An entry without a qualification is never
  evidence and never grants scope.
- It can exclude an unqualified pending create only when the signed selection
  is nonempty; the pending row has no canonical key or receipt, no pending
  delete, has a structurally valid durable source/canonical/operation identity,
  and all three identifiers differ from every exact current-scope signed row.
  No timestamp, count, grant time, or ledger-management metadata is used as
  authority.
- Empty signed selections, completed-but-unqualified rows, pending deletes,
  missing or malformed durable identity, canonical-key-bearing pending rows,
  and any source/canonical/operation collision remain closed. The old
  same-current-row pending-create and pending-delete holds are unchanged.
- The strict receipt-to-ledger match, persisted current-scope snapshot,
  revocation fence, source/journal revalidation, final admission proof, and
  R2 re-attestation rules are unchanged. No new authority store, grant,
  timer, queue, reader fallback, or canonical-writer policy was introduced.

### R3 focused evidence

- PASS — `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/dayflow_qualified_reader.test.ts` — 35/35.
- PASS — `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/dayflow_qualified_reader.test.ts -t 'excludes only durable-identity-distinct' --no-file-parallelism` — 1/1 (34 intentionally skipped).
  - Uses the actual `DayflowPersistedQualificationAuthority` and
    `AuthenticatedDayflowMemoryClient` with synthetic content only.
  - Seeds 27 active current signed receipts and 19 unqualified pending creates;
    the qualified page remains available with exactly the 27 signed candidates.
  - Holds a canonical-ID collision, a current qualified pending create, a
    pending delete, a pending row carrying a canonical key without a receipt,
    a malformed persisted ledger, and a consent/configuration change.
- PASS — `cd apps/api_server && ./node_modules/.bin/tsc --noEmit`.
- PASS — `git diff --check`.
- GitNexus exact-checkout attempt:
  `node .gitnexus/run.cjs impact qualifiedEvidenceStateNow --direction upstream`
  failed because this checkout has no `.gitnexus/run.cjs`. No index creation,
  alternate-checkout substitution, or graph fallback was used. Manual caller
  review covered `readQualifiedEvidence`,
  `readQualifiedEvidenceWithAdmission`,
  `captureQualifiedEvidenceAdmission`,
  `isQualifiedEvidenceAdmissionCurrent`, and their evidence-service callers.

### R3 remaining gate

The metadata-only receipt counts diagnosed the mixed-ledger condition but are
not a qualification proof. This source patch makes no live-context or
automatic-import-success claim. Root must mechanically compose the frozen
application bytes and re-run the normal stock authenticated status/context
scenario before treating the current 27-receipt selection as coordinator
context.

## R4 — proven former revoked-configuration receipt exclusion

Source derivative frozen at `2026-10-05T22:56:31Z`. The R3 application bytes
were the preimage; this remains uncommitted source-only work in the same
isolated checkout.

| Application path | R3 SHA-256 | R4 frozen SHA-256 |
| --- | --- | --- |
| `apps/api_server/src/integrations/dayflow/service.ts` | `f6ac5b9a794e604b4356a83ff7c714507f2496e757eabe6e1287ac17fa1c68c0` | `d85f98468e6dd502c1af949f1b35d3a930a314d363c3873804cf935d85276461` |
| `apps/api_server/src/__tests__/dayflow_qualified_reader.test.ts` | `0b839a58ce136ae803091b51e3121412dc32d01240447b41aa62518563ece016` | `b93425a8a74355e8cfc71785b25cb6fdec5002ee7ca3e24306109d11bcf2a5ab` |

- The strict current-generation receipt matcher remains the default. A failed
  match is excluded only when the parsed completed receipt has exact stored
  immutable canonical provenance, is active, matches the current owner,
  project, namespace, source instance, and prepared scope, has both a former
  consent/configuration generation, and its former consent is durably revoked
  in the existing ledger fence.
- A former receipt alone cannot produce an authoritative empty `available`
  result. The complete scan must also contain at least one active, unexpired,
  strict current-scope candidate; otherwise the reader remains unavailable.
- The excluded former receipt never enters the current candidate set or
  current identity set. A retained old manifest consequently fails the
  producer's synchronous admission recomputation. Pending deletes, current
  pending creates, source/canonical/operation collisions, malformed receipts,
  canonical provenance tampering, source changes, and consent changes retain
  their existing closed behavior.

### R4 focused evidence

- Read-only metadata receipt review only:
  `../../rhythm-qualified-reader-recovery-delivery-20261005/activation/`
  `final-runtime-metadata.json`, `dayflow-consent-preservation-after.json`,
  `coordinator-dayflow-import-context.json`,
  `after-current-refresh-coordinator-dayflow-status.json`,
  `current-reader-flat-ledger-metadata.json`, and
  `current-reader-receipt-generation-metadata.json`.
  Their counts/timestamps were diagnostic only and were not used as authority.
- PASS — `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/dayflow_qualified_reader.test.ts` — 36/36.
- PASS — `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/dayflow_qualified_reader.test.ts -t 'selects only the current scope' --no-file-parallelism` — 1/1 (35 intentionally skipped).
  - Synthetic path: initial two receipts → configuration rotation/durable
    revoke → explicit same-owner synthetic grant → one `already_present`
    re-attestation plus one retained former receipt and 15 identity-distinct
    unqualified pending creates.
  - The reader exposes only the new current receipt; the retained old manifest
    is not current, and a former-row canonical-key mismatch closes the reader.
- PASS — `cd apps/api_server && ./node_modules/.bin/tsc --noEmit`.
- PASS — `git diff --check`.
- GitNexus exact-checkout impact remains unavailable because
  `.gitnexus/run.cjs` is absent. No index, alternate checkout, or graph
  substitution was used; manual flow review covered the direct reader,
  admission capture/recomputation, and evidence-service final-admission
  callers.

### R4 remaining gate

No live source, API, engine, SDK/model turn, UI, grant, import, configuration,
ledger/database, package, or service action was performed here. Root must
mechanically compose these frozen application bytes and re-run the normal
stock authenticated reader/status/context scenario. This source handoff does
not claim live qualified context or automatic import success.
