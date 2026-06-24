# FOLLOW-UP (from P0-2): add `body`/`content` column to agent_skills

## Origin
Surfaced during P0-2 (seed import). The agent-stack skills are **prose** (a markdown
procedure body under YAML frontmatter), but `agent_skills` only has `description` +
`steps_json` (a JSON step array). The seed currently stores frontmatter
`description` and does NOT persist the full procedure body — flagged rather than
fabricating steps.

## Why it's a follow-up, not a P0-2 expansion
- Retrieval/matching (P3-1) scores on title/description/when_to_use/tags — metadata
  is sufficient for matching, so the seed is functional without the body.
- The full procedure still exists in opencode's `~/.config/opencode/agents/*.md` and
  is loadable at runtime via opencode's `skill` tool by name.
- Adding a column would expand P0-2's scope (scope policy: file follow-ups instead).

## Goal
Make the skill store self-contained so Rhythm fully owns the procedure text
(consistent with "Rhythm owns + evolves skills"):
- Add `body TEXT` (nullable) to `agent_skills` in BOTH migrations.ts (SQLite,
  additive ALTER guard like the agent_configs column pattern, since the table
  already exists on dev DBs) AND postgres_bootstrap.ts (`ADD COLUMN IF NOT EXISTS`).
- Add `body` to the `AgentSkill` model + repository (rowToModel, create, update).
- Update `skill_seed_importer.ts` to populate `body` with the markdown body
  (everything after the frontmatter block).
- Test: importer mapping test asserts `body` captured; repository round-trip covers it.

## Dependencies
P1-1 (schema), P0-2 (importer). Should land before P3-2 injection if the body is to
be injected; otherwise injection uses metadata + opencode skill-tool load.

## Out of scope
Changing how extracted (P2) skills use `steps_json` — body is for prose/seed skills.
