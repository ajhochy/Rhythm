---
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: ["11-followup-skill-body-column", "opc_curated_mcp_token_bridge-c4-flake"]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Two Odysseus follow-ups: agent_skills.body column + hermetic token-redaction test

Two small, independent follow-ups from the Odysseus self-improving skill-library
run, stacked on `feature/agent-scheduler` (PR #734). Committed separately, each
pushed and Server-CI-green; not merged.

## Follow-up A — `agent_skills.body` column (commit a06de6e)

Issue: `docs/ai/generated-issues/11-followup-skill-body-column.md`. The agent-stack
seed skills are prose (markdown procedure under YAML frontmatter), but `agent_skills`
only had `description` + `steps_json`, so the seed importer dropped the full
procedure body. Added a nullable `body TEXT` column so the store owns the prose.

### Files changed
- `apps/api_server/src/database/migrations.ts` — guarded additive ALTER (pragma
  `table_info(agent_skills)` check + `ALTER TABLE ... ADD COLUMN body TEXT`),
  since the table already exists on dev DBs (mirrors the agent_configs pattern).
- `apps/api_server/src/database/postgres_bootstrap.ts` — `ALTER TABLE agent_skills
  ADD COLUMN IF NOT EXISTS body TEXT` (dual-DB rule honored).
- `apps/api_server/src/models/agent_skill.ts` — nullable `body` on `AgentSkill`
  (required-but-nullable, consistent with `stepsJson`/`tagsJson`) + `AgentSkillInput`.
- `apps/api_server/src/repositories/agent_skills_repository.ts` — row interface,
  `rowToModel`, `create` INSERT, `update` patch.
- `apps/api_server/src/services/skill_seed_importer.ts` — new exported `extractBody()`
  (markdown after the closing frontmatter `---`); `frontmatterToSkillInput` takes an
  optional `body`; both discovery loops read content once and pass it. **All guards
  intact**: `isTestEnv()` short-circuit (zero writes under VITEST) + Postgres no-op.
- Tests: `agent_skills_repository.test.ts` (round-trip + update + null default),
  `skill_seed_importer.test.ts` (extractBody mapping + null cases),
  `issue_p1_1_agent_skills.test.ts` (schema-parity column list + model contract literal),
  and `body: null` added to fixtures in `skill_injection.test.ts` / `skill_retrieval.test.ts`.

### Checks
- `npx tsc --noEmit` — PASS
- `npx vitest run` (full) — **1073 passed** (baseline 1070 + 3 new body tests)
- Server CI on a06de6e — **success**

## Follow-up B — hermetic c4 token-redaction test (commit e5194d5)

`opc_curated_mcp_token_bridge.test.ts` c4 ("route response redacts env values") was
CI-flaky: intermittently `expected undefined to deeply equal { ...: '***' }` because
`body.servers[0].environment` came back undefined. Root cause: the c3/c4 block
replaced the whole `opencode_engine` module via `vi.doMock`; in the full CI suite that
override intermittently failed to apply, so the route called the **real**
`ensureCuratedMcps` — whose verified catalog has no google/pco entry — and the response
carried the real, ambient-account-dependent server list (no environment).

### Files changed
- `apps/api_server/src/__tests__/opc_curated_mcp_token_bridge.test.ts` — test setup
  only. Replaced the whole-module `vi.doMock('../services/opencode_engine')` with
  `vi.spyOn(opencodeClient, 'ensureCuratedMcps')` on the **real singleton the route
  holds a reference to** (imported post-`resetModules`), so the stub applies
  deterministically regardless of ambient Google/PCO state. Spy defaults to a benign
  empty result (so the real method — which touches `~/.config/opencode.json` — never
  runs through the singleton); c4 stubs with `mockResolvedValue` (persistent, not Once).
  **Redaction behavior (`redactServerEnv`) untouched.**

### Checks
- `npx tsc --noEmit` — PASS
- Hermeticity proof: c4 passes identically with ambient `GOOGLE_OAUTH_ACCESS_TOKEN` /
  `PCO_ACCESS_TOKEN` **present and unset**.
- Stability: token-bridge file 10/10 green; c4 isolated 20/20 green.
- `npx vitest run` (full) — **1073 passed** (test-only change, count unchanged).
- Server CI on e5194d5 — **success**

## Notes
- Both commits stay on `feature/agent-scheduler`; PR #734 not merged (manual merge only).
- Leftover untracked `docs/ai/contracts/issue-P1-1.json` from the prior run was left
  alone (not part of either follow-up).
- Out of scope / possible further follow-up: wiring `body` into the P3-2 injected
  "Available skills" preface (injection stays metadata-only for now).
