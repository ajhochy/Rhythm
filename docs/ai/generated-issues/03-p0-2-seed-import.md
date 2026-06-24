# P0-2: One-time seed import of agent-stack skills into the store

## Goal

Idempotent importer reads `~/.config/opencode/agents` and `~/.claude/skills`, maps each to `agent_skills` rows (`status='published'`, `source='agent-stack-seed'`), and stores them. Skips already-imported skills by title. Test-env guarded (zero writes under VITEST). This seed provides the initial skill library that P3 will later enhance with auto-extracted and teacher-escalated skills.

## Context

Phase 0 divorces Rhythm from the agent-stack sync write (P0-1) and gives Rhythm a one-time import of existing agent-stack skills (this issue). After this runs, Rhythm owns and evolves the skill library; agent-stack is never written to again.

**OQ-1 (unresolved):** The exact on-disk shape of `~/.config/opencode/agents` and `~/.claude/skills` files is unverified. This issue MUST:
1. Read a real sample file(s) from both locations.
2. Document the frontmatter fields / JSON structure.
3. Map each field to an `agent_skills` column (title → title, when_to_use/description → description, tags → tags_json, steps → steps_json, etc.).
4. Flag to the reviewer if a field has no corresponding column.
5. Acceptance criteria must assert `imported_count == discovered_count` after pinning the source shape.

## Likely files

- NEW `apps/api_server/src/services/skill_seed_importer.ts`
- `apps/api_server/src/server.ts` OR boot path entry point (invoke once on startup, guarded by `alreadySeeded` flag similar to memory consolidation)

## Acceptance Criteria

- [ ] **Source discovery documented:** Issue author inspects real `~/.config/opencode/agents/*.md` and `~/.claude/skills/*.md` files, documents the frontmatter structure and field names, and maps each to an `agent_skills` column. Review confirms the mapping is complete or flags unmapped fields.
- [ ] **Idempotent importer:** `skill_seed_importer.ts` reads both sources, normalizes to `AgentSkill` shape, and upserts by title (skip if title already exists in DB with `source='agent-stack-seed'`).
- [ ] **Test-env guard:** Code mirrors `opencode_agent_writer.ts::isTestEnv()` pattern (lines 53–54). Vitest asserts that with `VITEST==='true'` the importer performs ZERO writes (no DB rows inserted, no file writes, no LLM calls).
- [ ] **Boot invocation:** Importer runs once on `apps/api_server` startup (guarded by a stored flag or a `WHERE COUNT(*) FROM agent_skills WHERE source='agent-stack-seed'` check to avoid re-import). Example pattern: `if (!alreadySeeded) { await skillSeedImporter.import(); }`.
- [ ] **Assertion:** After import, `imported_count == discovered_count` (all discovered skills from the on-disk sources are now in the DB).
- [ ] **tsc + vitest:** `tsc --noEmit && npx vitest run` passes; no regression in baseline 966+ tests.

## Dependencies

- **P1-1:** `agent_skills` table and `AgentSkillsRepository` must exist first.

## Out of Scope

- Rebuilding the agent-stack skill source files.
- Persisting the import status elsewhere than the DB (use the DB count check).
- Handling skill updates from agent-stack after the seed (Rhythm owns them after this point).
