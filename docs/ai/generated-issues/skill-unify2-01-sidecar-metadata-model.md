# skill-unify2-01 — Sidecar metadata model over engine skills (dual-DB)

## Context
Epic: unify to ONE skill source (engine `SKILL.md`) + run self-improvement on ALL
engine skills. Decision: `docs/ai/decisions/2026-06-28-unify-skill-source-and-self-improvement.md`.

PR #778 made the engine filesystem store the single source of truth and kept
`agent_skills` (`+ agent_skill_versions`) as a DB store joined only by
materialize-on-publish. This issue **repurposes `agent_skills` as a name-keyed
metadata sidecar + proposal queue** over engine skills — the first step toward one
store. No behavior change yet; this is the schema + repository foundation.

Existing `agent_skills` columns (both DBs): `id, title, when_to_use, description,
steps_json, tags_json, confidence, status('draft'|'published'), source, uses, body,
version, created_at, updated_at`. `agent_skill_versions` mirrors content per version.

## Acceptance criteria
- `agent_skills` gains, in **both** `migrations.ts` (SQLite) **and**
  `postgres_bootstrap.ts` (Postgres), additive `ALTER`-style columns:
  - `proposed_for_name TEXT` (the engine skill `name` a proposal targets; null for
    non-proposals),
  - `base_version INTEGER` (the engine skill version a proposal was based on; null
    otherwise),
  - `origin_location TEXT` (the live skill's filesystem `location` at proposal time;
    null otherwise),
  - `is_external INTEGER DEFAULT 0` (1 when the target skill lives outside the
    managed dir — i.e. handwritten/external).
- The `status` column accepts a new value `'proposed'` (data-only; no enum table). A
  `'proposed'` row is the unit of the review queue and is NOT materialized.
- `AgentSkill` model (`models/agent_skill.ts`) is extended with the new fields
  (camelCase) and they round-trip through repository read/write.
- `AgentSkillsRepository` gains `findByName(name): AgentSkill | null` (the join key
  is the SKILL.md frontmatter `name`; existing `findByTitle` may delegate to it).
- A **schema-parity vitest** asserts the column set of `agent_skills` AND
  `agent_skill_versions` is identical between the SQLite migration result and the
  Postgres bootstrap DDL (parse both; compare sorted column-name sets). It FAILS if
  a column is added to one DB and not the other.
- No existing row is dropped or rewritten; migration is purely additive and
  idempotent (re-running `migrate()` is a no-op). Existing tests stay green.

## Likely files
- `apps/api_server/src/database/migrations.ts` (SQLite ALTERs, ~line 1273–1329 area)
- `apps/api_server/src/database/postgres_bootstrap.ts` (matching ALTERs, ~625–677)
- `apps/api_server/src/models/agent_skill.ts`
- `apps/api_server/src/repositories/agent_skills_repository.ts`
- new test `apps/api_server/src/__tests__/skill_schema_parity.test.ts`

## Dependencies / order
First in the epic. No deps.

## Safety notes
- New columns MUST land in BOTH DBs in the same PR (the parity test enforces it) —
  the documented Postgres/SQLite drift hazard (`docs/ai/project-state.md`,
  memory `project_postgres_sqlite_schema_drift`). SQLite-only tests pass even when
  Postgres is missing a column; the parity test is the guard.
- Additive only; never `DROP`/rewrite existing skill data.

## Required tests
- vitest: new columns persist + round-trip via the repository (SQLite in-memory).
- vitest schema-parity test (above) — the core deliverable's guard.
- `tsc --noEmit` clean; existing `vitest run` suite still green.

## Open question that changes this issue
If the user chooses to **rename** `agent_skills` → `skill_metadata` (Known
Ambiguity), do the rename here (large reference churn) instead of repurposing in
place. Default: keep the name.
