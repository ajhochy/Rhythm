---
date: 2026-06-28
repo: Rhythm
branch: fix/issue-775-skill-allowlist-guard
pr: pending
issues: [775]
status: verified-local
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #775 — per-session skill allowlist enforcement (mirror of mcpAllowlist)

## Files changed

**opencode fork** (`apps/opencode_fork/packages/opencode`):
- `src/session/session.ts` — `SkillAllowlist` schema; `skillAllowlist` on Info/CreateInput/UpdatedInfo; row map (read+write); `create`/`createNext` carry; `setSkillAllowlist` impl + interface + service return.
- `src/session/session.sql.ts` — `skill_allowlist` JSON column.
- `src/session/projectors.ts` — `skill_allowlist` projection (the #765 persistence path).
- `src/session/skill_allowlist.ts` (new) — `filterSkillsByAllowlist` / `isSkillAllowed` (mirror of `mcp_allowlist.ts`).
- `src/session/skill_allowlist.test.ts` (new) — 8 unit tests for the filter/gate.
- `src/session/system.ts` — `SystemPrompt.skills(agent, skillAllowlist?)` filters the listing.
- `src/tool/registry.ts` — `tools` input + `describeSkill(agent, skillAllowlist?)` filter.
- `src/session/prompt.ts` — passes `session.skillAllowlist` to both seams.
- `src/tool/skill.ts` — execute-time guard (rejects out-of-scope skill loads).
- `src/server/routes/.../groups/session.ts` + `handlers/session.ts` — PATCH `skillAllowlist` → `setSkillAllowlist`.
- `migration/20260628000000_add_session_skill_allowlist/migration.sql` (new).

**api_server** (`apps/api_server/src`):
- `services/opencode_client_service.ts` — `createSession(..., skillAllowlist?)` body + `updateSessionSkillAllowlist`.
- `services/ws_gateway.ts` — parse `allowed_skills_json` names, push per-turn + at createSession.
- `services/agent_runner.ts` — push skill names at scheduled createSession.
- `services/skill_retrieval.ts` — clarifying comment (DB preface ≠ capability gate).

**CI / guard / docs:**
- `tools/release/smoke_skill_allowlist.sh` (new) + `.github/workflows/desktop_release.yml` step.
- `docs/ai/contracts/issue-775.json`, `docs/ai/decisions/2026-06-28-skill-scope-enforcement.md`.

## Checks run

- Fork `bun run typecheck` ✓; api_server `tsc --noEmit` ✓.
- Fork `bun test` skill+mcp allowlist: 13 pass.
- api_server vitest skill_injection/skill_retrieval/interactive_scope_parity: 30 pass.
- Built single fork binary (`--single`, 22 migrations bundled).
- `smoke_skill_allowlist.sh` PASS + `smoke_mcp_allowlist.sh` PASS against the BUILT binary.

## Notes

- Root cause was a false-green: `buildSkillsPreface` (api_server) filters DB skills, but
  the model's real skills come from the fork and were unscoped. See decision doc.
- A build bug was caught only by testing the real binary: the schema column was added
  without a migration → `table session has no column named skill_allowlist` on every
  session create. Fixed by adding the migration dir. (Lesson reinforced: verify the
  built binary, not the unit suite.)
- Follow-up worth filing: source the Flutter `_kAvailableSkills` picker from the fork's
  `GET /skill` so allowlist names always match the fork's `SKILL.md` `name`.
- Ship requires a fork rebuild + signed release. Manual smoke owes the live end-to-end
  (restricted session prompt omits out-of-scope skills + load is refused).
