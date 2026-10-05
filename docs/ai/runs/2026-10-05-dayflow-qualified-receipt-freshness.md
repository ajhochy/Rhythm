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
