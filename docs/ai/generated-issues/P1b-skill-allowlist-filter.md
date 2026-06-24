# P1b — Skill allowlist filter on both run paths

**Labels:** `feature`, `api-server`, `agent-profiles`, `skills`, `p1`
**Depends on:** P1a (requires `resolveProfileScope` to exist and return `allowedSkillsJson`)

## Context / Background

`skill_retrieval.ts` `getRelevantSkills` (~158) scores skills by relevance and returns top matches; `buildSkillsPreface` (~223) calls it and assembles the injected prompt preface. Neither function accepts an allowlist — every skill in the store is a candidate regardless of the requesting profile's `allowed_skills_json`.

After P1a, `resolveProfileScope` returns `allowedSkillsJson`. This issue adds an `allowedSkillsJson` filter parameter to both `getRelevantSkills` and `buildSkillsPreface`, then threads it through:
- `agent_runner._runOnce` (already uses `buildSkillsPreface` — thread the `allowedSkillsJson` from the resolved scope).
- `ws_gateway.handleInputFrame` (calls `buildSkillsPreface` at ~599 — thread from the resolved scope from P1a).

Null or absent `allowedSkillsJson` = all skills eligible (backward compatible; current behavior preserved).

## Likely Files

- `apps/api_server/src/services/skill_retrieval.ts` — `getRelevantSkills` (~158): add `allowedSkillsJson?: string | null` filter param; `buildSkillsPreface` (~223): add same param and forward to `getRelevantSkills`.
- `apps/api_server/src/services/agent_runner.ts` — `_runOnce` (~514 area, `buildSkillsPreface` call): pass `allowedSkillsJson` from the P1a resolved scope.
- `apps/api_server/src/services/ws_gateway.ts` — `handleInputFrame` (~599, `buildSkillsPreface` call): pass `allowedSkillsJson` from the P1a resolved scope.
- `apps/api_server/src/__tests__/skill_injection.test.ts` — extend with allowlist-filter cases.
- `apps/api_server/src/__tests__/skill_injection_runner.test.ts` — extend with runner-path allowlist cases.

## Acceptance Criteria

- [ ] `getRelevantSkills` accepts an optional `allowedSkillsJson: string | null` parameter. When provided (non-null, non-empty), only skills whose `id` or `title` appears in the parsed JSON array are eligible — a high-scoring skill outside the allowlist is excluded from results.
- [ ] `buildSkillsPreface` accepts and forwards `allowedSkillsJson` to `getRelevantSkills`.
- [ ] When `allowedSkillsJson` is `null`, `undefined`, or an empty array `"[]"`, all skills remain eligible (backward compatible — no change from current behavior).
- [ ] `agent_runner._runOnce` passes the `allowedSkillsJson` resolved from the profile scope to `buildSkillsPreface`.
- [ ] `ws_gateway.handleInputFrame` passes the `allowedSkillsJson` from the P1a scope resolution to `buildSkillsPreface`.
- [ ] New test (runner path): `buildSkillsPreface` called with `allowedSkillsJson = '["skill-a"]'` where `skill-b` scores higher — `skill-b` does NOT appear in the returned preface.
- [ ] New test (WS forwarded-prompt capture path): same exclusion assertion via the forwarded prompt string captured from `handleInputFrame`.
- [ ] All existing `skill_injection.test.ts` and `skill_injection_runner.test.ts` tests stay green.
- [ ] `tsc --noEmit` passes with zero errors.

## Required Tests

Extend `src/__tests__/skill_injection.test.ts`:
```
describe('skill allowlist filter (P1b)', () => {
  it('skill outside allowlist excluded even when highest-scoring')
  it('null allowedSkillsJson → all skills eligible (backward compat)')
  it('empty array allowedSkillsJson → all skills eligible')
})
```

Extend `src/__tests__/skill_injection_runner.test.ts`:
```
describe('runner path allowlist (P1b)', () => {
  it('runner passes allowedSkillsJson from profile scope to buildSkillsPreface')
})
```

## Dependencies

- **P1a must land first** — this issue threads the `allowedSkillsJson` value returned by `resolveProfileScope`.
- P2 and P4 do not block on P1b, but P1b should land in the same PR as P1a or immediately after.

## Safety Notes

- The allowlist filter is profile-scoped, not user-scoped. It must fail **open** to "all skills" on null — do not invert this to fail-closed (that would break all existing unscoped profiles).
- Skill body content must remain transient — never written to config, session store, or agent `.md`.
- No new database columns. No Flutter changes.
