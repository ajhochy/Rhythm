---
date: 2026-07-08
repo: Rhythm
branch: issue-949-harvest-to-file
pr: pending
issues: ["#949"]
status: implementation-complete
tags: [run, Rhythm]
---

# #949 — skill harvester writes draft SKILL.md files + auto-binds to source agent

## Files

### Changed
- `apps/api_server/src/services/skill_extractor.ts` — `distillFromSession()`
  now writes a draft `SKILL.md` to the `drafts/` namespace under the
  Rhythm-managed skills dir (instead of an `agent_skills` DB row). Adds:
  `skillNameFromTitle()`, `renderDraftBody()`,
  `resolveExtractingAgentConfigId()` (mirrors #818 attribution:
  `mcp_role` → `agent_kind`), `autoBindDraftToExtractingAgent()` (skips when
  `allowedSkillsJson === null` to avoid lock-down), `triggerSkillReload()`.
  Returns a synthetic `AgentSkill` with `source: 'harvested'` +
  `originLocation` = the written file path.
- `apps/api_server/src/services/rhythm_managed_skills.ts` — added drafts
  namespace helpers: `DraftManagedSkillInput`, `draftsRoot()`,
  `draftSkillDir()`, `draftSkillExists()`, `renderDraftSkillMarkdown()`,
  `writeDraftManagedSkill()`. Same context-injection scan (#873) +
  path-traversal guards as `writeManagedSkill`.
- `apps/api_server/src/__tests__/skill_extractor.test.ts` — rewritten to
  assert file-write + auto-bind (using `RHYTHM_MANAGED_SKILLS_DIR` temp dir
  + seeded `agent_configs` row). 9 tests: draft file exists with correct
  frontmatter, `allowedSkillsJson` appended, unrestricted skip, DB dedup,
  file dedup, confidence gate, round-count gate, LLM-decline/garbage,
  VITEST guard.

### Added
- `docs/ai/decisions/2026-07-08-harvest-to-file-autobind.md` — supersedes
  point 4 ("System B fate — materialize-on-publish") of the Unify-2
  decision. Records the reversal + justification (bridge never built,
  drafts went invisible, loop unclosed).
- `docs/ai/project-state.md` — updated.

## Checks

- `tsc --noEmit` (api_server) — **PASS** (clean).
- `skill_extractor.test.ts` — **9/9 PASS**.
- Related suites (rhythm_managed_skills, agent_configs, skill_refiner,
  skill_retrieval) — **62/62 PASS** across 4 files.
- Import smoke (`npx tsx -e "import('./src/services/skill_extractor.ts')"`)
  — **PASS**.
- GitNexus `detect_changes({scope: "compare", base_ref: "main"})` —
  **LOW risk**, 13 touched symbols, 0 affected processes, 0 downstream
  impact.
- Pre-existing failures (22 across memory-vault + auth-middleware suites) —
  unrelated to #949 (ENOENT temp-dir + 401 env issues on main).

## Notes

- **Critical correctness guard:** `allowedSkillsJson` semantics are
  `null = unrestricted; array = scoped`. Auto-bind SKIPS when null (writing
  `[name]` would lock the agent down to only the draft). Implemented + tested.
- `AgentSkillsRepository` + `agent_skills` table NOT deleted (32 direct
  callers, GitNexus CRITICAL). Only the `distillFromSession` write site
  changed. Refiner path still uses the repo for legacy DB skills. Cleanup is
  a follow-up.
- Cold-start gate (`isEngineColdStart()` / 90s) + Postgres no-op guard stay
  unchanged.
- The coding-agent subagent failed twice (empty results, zero file changes)
  — implemented inline by the orchestrator per AJ's direction.
- `#929` work (14 uncommitted files on `issue-929-skill-self-regulation`)
  stashed as `wip-929-inflight-stashed-for-949` to isolate this branch.

## Follow-ups NOT done (per hard constraints)

- Delete `agent_skills` table / `AgentSkillsRepository` — separate follow-up.
- Cross-agent promotion (org-optimizer gated) — unchanged.
- Flutter Skills UI visual badge for `status: draft` — not in scope (UI
  already shows draft files since they're engine-discovered).
- `skill_retrieval.ts` text-hint injection path — not retired (can be
  repurposed later once drafts are real files).
