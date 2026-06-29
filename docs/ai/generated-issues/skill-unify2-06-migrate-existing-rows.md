# skill-unify2-06 — Migrate existing `agent_skills` rows to the unified model

## Context
Epic: one skill source. Decision:
`docs/ai/decisions/2026-06-28-unify-skill-source-and-self-improvement.md`.

Existing `agent_skills` rows predate the sidecar model. PR #778 already materializes
**published** rows to managed SKILL.md on publish, but historical rows and **draft**
rows need reconciling so the unified read (issue 02) shows them correctly without
duplicating engine skills.

## Acceptance criteria
- A one-time, idempotent backfill (run at boot, guarded like
  `seedAgentStackSkills` — runs only if not already done; Postgres no-op preserved
  where the existing services no-op):
  - **Published rows:** reconcile by `name`/`title` to the managed engine skill they
    materialize to. If a managed SKILL.md already exists for that name, the sidecar row
    is joined (kept as metadata) — NOT duplicated, NOT re-materialized into a second
    file. If none exists yet (e.g. materialize previously failed), it is materialized
    once.
  - **Draft rows:** keep as `status='draft'` sidecar metadata. They surface in the
    unified read under their `name` with `file absent` (no SKILL.md) until published.
  - **Collisions:** a row whose `title` equals an existing engine skill `name` is
    JOINED (metadata attached), never duplicated.
- Re-running the backfill is a no-op (no double materialization, no duplicate rows).
- No existing row is deleted by the migration; `agent_skill_versions` history is
  preserved.
- The backfill never writes outside the managed dir.

## Likely files
- new `apps/api_server/src/services/skill_metadata_backfill.ts`
- `apps/api_server/src/server.ts` (run-once wiring, mirroring the seed-import gate)
- `apps/api_server/src/repositories/agent_skills_repository.ts` (lookup/join helpers
  from issues 01–02)

## Dependencies / order
After 01 (schema) + 02 (unified read / join helpers). Can run before or in parallel
with 05; 07 depends on it.

## Safety notes
- Idempotent + one-time guarded — must not re-materialize on every boot.
- Postgres no-op guard preserved (the curation services are local-SQLite-oriented).
- Never write outside `~/.config/opencode/rhythm-managed-skills`.

## Required tests
- vitest: a published row whose name matches an existing managed engine skill → joined,
  no duplicate file, no duplicate row.
- vitest: a draft row → surfaces with metadata, file absent.
- vitest: running the backfill twice → identical state (no-op second run).
- `tsc --noEmit` clean.
