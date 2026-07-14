---
tags: [decision, Rhythm]
---

# Content writes in boot/sync paths are one-time, marker-guarded — the DB row is the single authority for user-editable config

## Context

Rhythm duplicated agent/skill/task configuration across three representations
(DB row ↔ on-disk opencode file ↔ live engine registry) with no single
reconciliation authority, and `runMigrations()` runs on every boot. Repeated
production incidents (#1039 family, Config Doctor re-specs, Secretary roster,
deny-all scopes widening) all reduced to one anti-pattern: **a one-time
seed/repair coded as eternal enforcement** — an unguarded (or weakly-guarded)
write firing on every boot or every picker refresh against a field users and
agents also edit through the API.

## Decision

1. The **DB row is unconditionally authoritative** for user-editable config.
   The `.md` agent file is a projection of the DB (writer), never a source
   that feeds back into user-owned fields. Engine state seeds NEW rows on
   first import only.
2. Every migration/seed/sync write is one of exactly four kinds:
   create-if-absent, backfill-when-NULL, **one-time repair under a durable
   `schema_meta` marker** (`runOnce()` in migrations.ts, `seed_once.ts` for
   services, the same marker table in postgres_bootstrap.ts), or structural
   DDL. Shipping a new default value = a NEW versioned marker key, never an
   unguarded literal.
3. A user's **delete is an edit**: seeded records carry `seeded_task:<name>`
   tombstone markers so deletion survives reboots.
4. The contract is enforced structurally by
   `migrations_replay_guard.test.ts`: sentinel-edit every user-editable field,
   re-run the boot write path, assert the entire DB is byte-identical.

## Alternatives considered

- **Per-instance guards** (`WHERE ... = <stale value>` on each repair):
  rejected — this is what kept regressing; nothing stops the next unguarded
  UPDATE from being merged.
- **Versioned migration runner** (full schema_migrations rewrite of the 2k-line
  migrations.ts): rejected as high-risk/large-diff; runOnce gives the same
  once-per-install semantics with a minimal, incremental diff and keeps the
  existing idempotent-DDL style.
- **Collapse the DB↔file↔engine triangle entirely** (stop syncing engine → DB):
  partially adopted — sync no longer updates user-owned fields on existing
  rows (session_selectable is insert-only) — but full removal was rejected
  because first-import discovery of externally-defined agents is a real
  feature.

## Consequences

- Editing ANY agent/skill/task setting through the app's UI or API and
  restarting is guaranteed by test to never silently revert.
- Default-value updates now require an explicit new marker key (small friction,
  full auditability).
- Existing installs upgrade seamlessly: markers absent → each repair applies
  once more, then never again; row-existence seeds are adopted into markers on
  first boot.
- CLI preset rows became genuinely user-ownable (promotion/demotion sticks);
  the scheduling guard had to learn presets are never delegation-only.
