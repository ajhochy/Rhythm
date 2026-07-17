---
tags: [decision, rhythm]
date: 2026-07-17
---

# Child (task-spawned) session skill-allowlist semantics

## Context

Delegated subagent sessions created by the engine's `task` tool
(`apps/opencode_fork/.../tool/task.ts`) were created with **no**
`skillAllowlist`. In the fork, an undefined skill allowlist means "inject ALL
discovered skills" (`session/skill_allowlist.ts` back-compat pass-through).
`~/.config/opencode/skills` now holds **105 skills ≈ 89k tokens** of
descriptions, so an unscoped child's first turn cost ~115–135k tokens instead
of the ~5–30k a scoped agent needs.

The #1012 fix already solved the MCP half: `opencode_agent_writer.ts` projects
each profile's expanded MCP allowlist into the agent `.md`
`options.mcpAllowlist`, and `task.ts::childMcpAllowlist()` reads it onto the
child session. The skill half was never projected — profiles declare tight
`allowed_skills_json` in the DB, but that list never reached task-spawned
children.

Root chat sessions are unaffected: they are scoped **per turn** by
`ws_gateway.ts` (#765/#775), which PATCHes both allowlists onto the fork
session before each prompt. That path must not change.

## Decision

Mirror #1012 for skills, with a child-only inheritance fallback:

1. `opencode_agent_writer.ts` projects the profile's `allowedSkillsJson` into
   the agent `.md` as `options.skillAllowlist = { skills: [...] }` (alongside
   the existing `options.mcpAllowlist`). Unscoped profile
   (`allowedSkillsJson === null`) → key omitted.
2. `task.ts::childSkillAllowlist(agent, parent)` resolves the child's scope by
   precedence:
   - **own profile** — `agent.options.skillAllowlist` if present, else
   - **parent inheritance** — `parent.skillAllowlist`, else
   - **undefined** — only if BOTH the profile and the parent are unscoped.

The parent-inheritance rung is the deliberate change from a pure #1012 mirror.
"undefined → all 105 skills" is no longer a sane default for a child session
when a self-improvement loop keeps adding skills. Inheritance means a delegated
child can only reach "all skills" if it descends from a genuinely unrestricted
root — never by silent omission.

**This never changes root-session behavior.** Root sessions do not pass through
`childSkillAllowlist()`; their scope is set explicitly by `ws_gateway.ts`
(null = unrestricted, [] = deny-all), and `filterSkillsByAllowlist`'s
`undefined → all` back-compat is preserved for them.

## Alternatives considered

- **Pure #1012 mirror (no inheritance).** Simplest. Fixes every *current*
  specialist (all declare `allowed_skills_json`), but a future unscoped profile
  that delegates would still bloat. Rejected: the loop keeps minting skills, so
  the safe default matters.
- **Empty (deny-all) when the profile declares none.** Cheapest tokens, but
  silently strips skills from a subagent whose profile author simply forgot to
  list them. Rejected as too surprising.

## Consequences

- Every specialist child (coding-agent, planning-agent, verification-gate, …)
  is now scoped to its profile's declared skills at creation time — first turns
  drop from ~115–135k to the ~15–30k range.
- **Flag for human review:** the parent-inheritance rung is a behavioral choice.
  If a reviewer prefers the pure #1012 mirror (undefined → all when the profile
  is unscoped), delete the `return parent.skillAllowlist` line and return
  `undefined`. The projection (item 1) is uncontroversial and stands either way.
- Additive only. No change to the DB `session.skill_allowlist` column contract
  or to `filterSkillsByAllowlist`.
