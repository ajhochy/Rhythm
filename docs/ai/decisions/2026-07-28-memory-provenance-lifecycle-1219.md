---
date: 2026-07-28
repo: Rhythm
branch: issue/1219-memory-provenance
issues: [1219]
tags: [decision, rhythm, memory, provenance, lifecycle]
index: "[[Rhythm]]"
---

# Define canonical memory provenance and lifecycle semantics

## Context

Rhythm mirrors canonical Markdown memory notes into `agent_memory` for search
and retrieval. Existing rows and notes have partial source metadata, but the
system needs a stable contract for provenance, verification, staleness,
deprecation, audit, and rollback without inventing history for legacy data or
deleting useful evidence.

The vault note remains the canonical user-readable representation. The
database remains a derived, queryable index plus an append-only audit ledger.

## Decision

### Canonical provenance

Each memory exposes these provenance fields:

- `sources`: an immutable, ordered list of source references. A source
  reference has a required `type` and `ref`, with optional `label`,
  `capturedAt`, and source-owned context. Once a reference has been recorded,
  lifecycle or content updates may preserve or append references but must not
  rewrite or remove existing entries.
- `generatedBy`: the actor that created the memory content, represented as a
  stable namespaced identity string (`human:<id>`, `agent:<id>`, or
  `system:<id>`). Unknown legacy authors remain `null`; the migration must not
  infer an actor.
- `generatedAt`: the creation/generation timestamp when known. Unknown legacy
  timestamps remain `null`; `createdAt` is not silently re-labelled as
  generation provenance.
- `source` and `sourceId`: compatibility fields describing the immediate
  storage/import channel and its stable identifier. They do not replace the
  immutable `sources` list.
- `trustTier`: `human`, `agent`, or `unverified`. Legacy rows default to
  `unverified`.

Vault frontmatter is the canonical serialized form of `sources`,
`generatedBy`, `generatedAt`, and `trustTier`. The index stores equivalent
JSON/scalar values so write, reindex, update, list, get, and search return the
same provenance.

### Lifecycle

Lifecycle is represented without removing the memory:

- `active`: the effective state for a non-deprecated memory whose
  `staleAfter` date is absent or has not passed.
- `stale-after`: a time-based transition. `staleAfter` is an optional
  `YYYY-MM-DD` boundary; once the boundary has passed, the effective lifecycle
  is stale while the stored memory and provenance remain available.
- `deprecated`: an explicit terminal advisory state. Deprecation excludes a
  memory from automatic prompt injection but does not delete the vault note,
  index row, provenance, verification history, or audit entries.

The persisted status is `active` or `deprecated`; staleness is derived from
`staleAfter` so time can change the effective state without an unaudited
background write. API/UI presentation may expose the effective lifecycle as
`active`, `stale`, or `deprecated`. A memory is `unverifiable` when it has no
valid source references and no verification history; this is a provenance
quality indicator, not a hidden fourth destructive state.

### Verification history

Verification is an append-only ordered history. Each entry records:

- verifier `actor`;
- verification `timestamp`;
- the action (`verified` or `deprecated`);
- source context supporting the action;
- prior lifecycle/provenance state or an explicit rollback target.

Verification never overwrites earlier entries. Re-verification appends a new
entry and may set a new `staleAfter` boundary. Legacy memories start with an
empty history and remain visibly unverified.

### Change log and rollback

Every lifecycle or provenance-affecting change also creates an immutable
change-log entry in a dedicated audit table. The entry records the memory id,
actor, timestamp, action, source context, a snapshot of the prior state, and a
`rollbackTarget` identifying the immediately preceding audit entry or original
snapshot.

Rollback is additive: restoring a prior snapshot writes a new change entry
that points to the selected target. It never edits or deletes old audit
entries. Rollback restores mutable memory/lifecycle fields while retaining the
complete audit chain and immutable source references.

### Non-destructive semantics

Stale, deprecated, and unverifiable memories remain addressable through
explicit list/get/search and visible in the desktop Memory/Brain UI with their
provenance. Only automatic memory injection filters deprecated or currently
stale memories. Vault synchronization must not interpret lifecycle state as a
request to delete a note or row.

Physical deletion remains the existing explicit forget/delete operation and is
outside this lifecycle contract. No migration drops columns, deletes rows, or
fabricates source history.

## Alternatives

- Replace existing source fields with one mutable provenance object: rejected
  because it breaks compatibility and permits history to be rewritten.
- Materialize `stale` as a database status: rejected because elapsed time would
  make the row inaccurate unless a background mutation ran.
- Treat deprecation as deletion: rejected because it destroys auditability and
  prevents safe review or rollback.
- Backfill legacy provenance from timestamps or paths: rejected because those
  values do not prove actor identity or originating sources.

## Consequences

- SQLite migrations and Postgres bootstrap must add matching safe-default
  columns and an append-only audit table.
- Vault write/update/reindex paths must preserve provenance and verification
  fields exactly; content edits cannot erase them.
- The API and `rhythm_verify_memory` MCP tool must expose the same lifecycle
  contract and use server-controlled actor identities.
- Retrieval keeps issue #1218 behavior: curated atomic memories continue to
  outrank synthesis, while automatic injection additionally excludes stale
  and deprecated rows.
- Rollback of the schema is operationally non-destructive: stop writing the
  additive fields/table and leave them in place. Dropping them would discard
  history and therefore requires a separately reviewed destructive migration.
