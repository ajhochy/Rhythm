---
date: 2026-07-17
repo: Rhythm
branch: fix/skill-scope-task-children
pr: (draft — see PR body)
issues: []
status: verified-draft
tags: [run, rhythm]
---

# Fix first-turn token bloat: scope task-tool child sessions to their profile's skills

## Problem

Delegated subagent sessions created by the engine's `task` tool
(`apps/opencode_fork/.../tool/task.ts`) were created with **no** `skillAllowlist`.
An undefined skill allowlist means "inject ALL discovered skills"
(`session/skill_allowlist.ts` back-compat). With 105 skills installed
(~89k tokens of descriptions), every delegated child paid a 115–135k-token first
turn. The #1012 MCP fix scoped children's MCP tools but never projected skills.

## Files

- `apps/api_server/src/services/agent_profile_scope.ts` — new exported
  `expandProfileSkillAllowlist(allowedSkillsJson)` → `{skills:[...]} | undefined`
  (reuses `_normalizeAllowedSkillsJson`; null → undefined).
- `apps/api_server/src/services/opencode_agent_writer.ts` — project the profile's
  skill allowlist into the agent `.md` `options.skillAllowlist` alongside
  `mcpAllowlist` (one combined `options:` line).
- `apps/opencode_fork/packages/opencode/src/tool/task.ts` — new
  `childSkillAllowlist(agent, parent)` + `isSkillAllowlist`, passed to
  `sessions.create({ skillAllowlist })`. Precedence: own profile → parent
  inheritance → undefined (see decision doc).
- `apps/api_server/src/repositories/agent_sessions_repository.ts` +
  `opencode_stream_bridge.ts` — recording-gap fix: persist the child's
  `mcpAllowlist` from the `session.created` event into the existing
  `mcp_allowed_tools_json` column (no migration).
- Tests: fork `test/tool/task.test.ts` (childSkillAllowlist unit + e2e);
  api_server `expand_profile_skill_allowlist.test.ts`,
  `opencode_agent_writer_projection.test.ts`,
  `issue_743_child_session_persistence.test.ts`, `opencode_stream_bridge.test.ts`.
- Decision: `docs/ai/decisions/2026-07-17-child-session-skill-scope.md`.

## Checks

- api_server `npx tsc --noEmit` → exit 0.
- fork `bun run typecheck` (tsgo) → exit 0.
- api_server `npx vitest run` → **2889 passed, 0 failed** (32 skipped).
- fork `bun test test/tool/task.test.ts` → 16 pass, 0 fail.
- fork `bun run build --single` → exit 0 (binary + smoke; version
  `0.0.0-fix/skill-scope-task-children-...`).
- api_server `npm run build` → exit 0.

## Live behavioral test (RHYTHM sandbox — real engine + api_server)

Built the fork + api_server from this branch and ran the isolated sandbox
(`tools/dev/sandbox.sh up`, api :4098 / engine :4097, isolated HOME/DB, all 105
skills copied). Routed the orchestrator + 3 specialists to
`openrouter/anthropic/claude-haiku-4.5` (only provider with a static key in the
sandbox HOME — Anthropic OAuth is keychain-bound and unavailable there; token
accounting is provider-independent). Drove a real `workflow-orchestrator` session
over `ws://…/ws/agents` that called the `task` tool three times.

Measured each spawned child in
`~/.local/share/opencode/opencode-<branch>.db` (`session` table). First-turn cost
= `tokens.input + tokens.cache.read + tokens.cache.write` of the first assistant
message.

| child (via task tool) | session skills | profile skills | match | mcp_allowlist | first-turn tokens |
|---|---|---|---|---|---|
| coding-agent | 6 | 6 | ✅ exact | SET (gitnexus, rhythm) | **12,562** |
| planning-agent | 4 | 4 | ✅ exact | SET (gitnexus, memory, 9 rhythm) | **11,961** |
| verification-gate | 6 | 6 | ✅ exact | SET (9 rhythm) | **10,393** |

Same-environment unscoped baseline (root session, `skill_allowlist=NULL` → all
105 skills, identical engine/skills/model): **85,498 tokens**.

Live before-fix data (production `opencode-main.db`, real unscoped task-tool
children from the 2026-07-17 mega run): coding-agent **116,017**, planning-agent
**126,305**.

Untouched paths (unchanged by this fix, from production DB): secretary **root**
session first turn ~72k (scoped via `ws_gateway` per-turn PATCH, not via
`options`); background skill-refiner (`skill-measure-score`) scoped to
`{"skills":[]}`, ~15–16k.

Recording-gap fix confirmed: the new child `agent_sessions` rows carry
`mcp_allowed_tools_json` (previously NULL).

**Result:** task-tool child first turns drop ~10× (≈116–126k → 10–13k), well under
the ≤40k acceptance threshold. Root sessions and background loops unchanged.

## Notes

- NULL semantics decision (parent-inheritance fallback) flagged for human review
  in the decision doc + PR body.
- Sandbox torn down; live services (:4001 api, :4096 engine) confirmed healthy
  and untouched throughout.
