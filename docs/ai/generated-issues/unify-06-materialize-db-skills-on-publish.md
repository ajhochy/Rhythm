# api_server: materialize DB skills to SKILL.md on publish

**Order:** 6 · **Depends on:** #2 (managed-dir write helper) · **Milestone:** Unify skills source of truth

## Why

System B (the DB skill store + extractor/refiner/retrieval/seed services) stays as the
authoring/metadata layer, but its skills are invisible to the model today (`buildSkillsPreface`
is an inert hint). To reach one source of truth, a published DB skill must be **materialized**
into the canonical engine store as a `SKILL.md`.

## What

Add a `skill_materializer` service that renders a DB skill record to a valid `SKILL.md`
(frontmatter `name` + `description`, body = skill content) and writes it into the Rhythm-managed
dir via the issue-2 write helper, then triggers the fork reload. Hook it into the publish path.

## Acceptance criteria

1. Publishing a DB skill writes a `SKILL.md` into the managed dir whose frontmatter `name`
   equals the skill's canonical name and `description` is populated.
2. After publish, the skill appears in `GET /opencode/skills` (reload round-trip) and is
   therefore selectable in the Flutter picker and scopable via `allowed_skills_json`.
3. **Done-definition:** re-publishing an edited DB skill overwrites its managed `SKILL.md`
   (idempotent by name), not a duplicate.
4. Unpublishing (if supported) removes the materialized `SKILL.md` from the managed dir.
5. `buildSkillsPreface` is left as an inert hint and documented as NOT the capability gate
   (clarifying comment, consistent with the #775 decision).

## Likely files

- `apps/api_server/src/services/skill_materializer.ts` (new)
- `apps/api_server/src/controllers/agentSkillsController.ts` (publish hook)
- `apps/api_server/src/repositories/agent_skills_repository.ts` (publish state, if needed)
- `apps/api_server/src/services/skill_retrieval.ts` (doc comment on the inert preface)

## Required tests

- Vitest: publish writes a valid SKILL.md (parseable frontmatter) into the managed dir;
  it appears via the proxy after reload; re-publish is idempotent by name.

## Data-safety / out-of-scope

- Writes confined to the managed dir (reuse issue-2 boundary checks).
- Do not delete or rewrite external skills.
- No removal of the extractor/refiner/retrieval/seed services.

## Verification

- `ai-workflow checks --level issue` (api_server vitest).
