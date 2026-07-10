---
date: 2026-07-10
repo: Rhythm
branch: codex/optimizer-shadow-epic
pr: 982
issues: [977]
status: fixed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `apps/api_server/src/__tests__/ministry_recipes_seed.test.ts` — only file touched. No production code changed.

## Checks run

- `tsc --noEmit` (apps/api_server) — clean.
- `npx vitest run src/__tests__/ministry_recipes_seed.test.ts` — 6/6 passed.
- `npx vitest run` (full suite) — 297 files / 2616 tests passed, 23 skipped, 0 failed.
- CI run `29066250846` (`server-checks` on `codex/optimizer-shadow-epic`) — conclusion `success`, commit `d9c382ca9483e7e919f6f19656d1bce271779194`.

## Notes

PR #982's `server-checks` job was failing on 4 tests in `ministry_recipes_seed.test.ts`
(`TypeError: Cannot read properties of null (reading 'body')` and an empty-array
length assertion). Root cause: this epic's #977 work decoupled
`apps/api_server/src/services/ministry_recipes_seed.ts` from the `agent_skills`
DB table — the seed now writes each recipe's `SKILL.md` file directly
(write-if-absent) as the sole content source, and no longer creates a
`published` `agent_skills` row mirroring the body (the retired DB→file shadow,
per the `docs/ai/decisions/2026-07-09-*` skill-content-shadow decision). The
test suite still asserted the pre-#977 contract (3 DB rows with `.body`).

Fix: reconciled the test with the intended #977 behavior rather than forcing
it green —
- Added a `readSkillMd(title)` helper that reads the materialized SKILL.md file
  via `managedSkillsRoot()` / `slugForSkillName()` (same resolution the seed
  itself uses), replacing all `AgentSkillsRepository.findByTitle(...).body`
  reads.
- The idempotency test (`issue-846-c3`) now asserts on the seed's own
  `skillsSeeded`/`skillsSkipped` result counters (3 seeded on the first call,
  0 seeded / 3 skipped on repeats) plus a directory-listing count, instead of
  querying DB rows that no longer exist.
- No behavior/production code changed; this was a stale-test-only fix.

PR #982 remains open, NOT merged — awaiting AJ's review/sign-off per the
existing plan in `docs/ai/project-state.md`.
