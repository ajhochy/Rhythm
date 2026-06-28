---
date: 2026-06-28
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Per-agent skill scoping is enforced in the opencode fork (mirror of mcpAllowlist), not in api_server

## Context

Issue #775 asked whether per-profile skill scoping (`agent_configs.allowed_skills_json`)
is actually enforced, suspecting the same false-green as #765 (MCP allowlist:
schema said scoped, runtime served everything).

Investigation found **two** skill systems:

1. **api_server DB skills** (`AgentSkillsRepository`) → `buildSkillsPreface` prepends a
   transient relevance *hint* to the prompt. It filters by `allowed_skills_json`, but
   the names in `allowed_skills_json` are **fork** skill names (the hardcoded
   `_kAvailableSkills` picker: `docx`, `engineering:code-review`, …), not DB skill
   ids/titles — so this filter is effectively **inert**.
2. **opencode fork filesystem skills** (`SKILL.md` under `.claude/skills`, `.agents`,
   config dirs) → surfaced to the model via the `skill` tool + the system-prompt
   `<available_skills>` listing (`session/system.ts`, `tool/registry.ts`). This is what
   the model actually sees and can load — and the fork listed **every discovered skill**,
   gated only by the agent's `skill` *permission*, never by `allowed_skills_json`.

So the profile's skill allowlist never reached the engine. Exactly the #765 shape:
api_server-side "scoping" that is inert because the real serving happens in the fork.

## Decision

Enforce per-agent skill scoping in the **fork**, mirroring the proven `mcpAllowlist`
patch end-to-end:

- New per-session `skillAllowlist: { skills: string[] }` (schema, `session` SQL column,
  projector, `CreateInput`/`UpdatedInfo`, `create`/`setSkillAllowlist`, PATCH payload +
  handler) — migration `20260628000000_add_session_skill_allowlist`.
- `session/skill_allowlist.ts` (`filterSkillsByAllowlist` / `isSkillAllowed`) mirroring
  `session/mcp_allowlist.ts`.
- Filter the skill listing at both prompt seams (`SystemPrompt.skills`,
  `ToolRegistry.describeSkill`) AND block out-of-scope loads in the `skill` tool's
  `execute` (the tool schema is always present, so listing-filter alone is insufficient).
- api_server pushes the resolved `allowed_skills_json` names to the session:
  `opencodeClient.createSession(..., skillNames)` + `updateSessionSkillAllowlist(...)`,
  driven from `ws_gateway` (per-turn, `perTurnAgent ?? agentKind`) and `agent_runner`
  (scheduled) — the same resolution MCP scope uses.
- Real-binary regression guard `tools/release/smoke_skill_allowlist.sh` (PATCH→GET
  round-trip on the built binary) wired into `desktop_release.yml`, mirroring
  `smoke_mcp_allowlist.sh`.

Semantics mirror MCP: `undefined`/absent allowlist = unrestricted (back-compat);
a present list restricts to exactly those skill names; an empty push is not sent
(an unrestricted profile leaves the fork's absent allowlist untouched).

## Alternatives considered

- **Reuse the fork's native `skill` permission** (`Permission.evaluate('skill', …)`):
  fewer fork lines, but the per-session permission→`agent.permission` flow was
  unverified, and #775 explicitly asked to mirror the proven MCP method. Rejected.
- **Fix only `buildSkillsPreface`**: rejected — it is not the serving boundary, so it
  would have reproduced the original false-green.

## Consequences

- `allowed_skills_json` now actually scopes the model's available/loadable skills on
  every session turn (interactive + scheduled).
- `buildSkillsPreface`'s allowlist filtering remains but is documented as a DB-preface
  hint, NOT the capability gate (clarifying comment added in `skill_retrieval.ts`).
- Requires a fork rebuild + signed release to ship (the fork binary is bundled).
- Manual smoke still owes the live end-to-end: confirm a restricted Secretary session's
  prompt omits out-of-scope skills and the model is refused on an out-of-scope load.
- Identifier caveat: the UI `_kAvailableSkills` names must match the fork's `SKILL.md`
  frontmatter `name` (e.g. `docx` vs `anthropic-skills:docx`); a mismatch silently
  scopes to nothing matchable. Worth a follow-up to source the picker from the fork's
  `GET /skill` instead of a hardcoded list.
