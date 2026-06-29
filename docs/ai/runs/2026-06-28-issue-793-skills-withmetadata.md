---
date: 2026-06-28
repo: Rhythm
branch: worktree-agent-ac659d2d43b6f8e25
pr: pending
issues: [793]
status: verified-pending-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #793 — Unified read: join #792 sidecar metadata onto live engine skills

Skill-unify2 epic #791, issue 2/7. Builds on #792 (sidecar columns +
`AgentSkillsRepository.findByName`), based on `feature/skill-unify2`.
Commit `6ddbcaadf` (not pushed).

## Files changed

- `apps/api_server/src/routes/opencode_skills_routes.ts` — `GET /opencode/skills`
  now accepts optional `?withMetadata=true`.
  - **Without** the flag: response unchanged — `{ name, description?, location,
    managed }`. The Agent Profile picker (which calls the plain endpoint) is
    untouched.
  - **With** the flag: each entry gains `metadata`, joined onto the live engine
    skill by `name` via `AgentSkillsRepository.findByName` (O(n) over the live
    fork set — one lookup per live name, not N+1):
    `{ confidence: number|null, version: number,
       status: 'active'|'measuring'|'reverted'|null, source: string|null,
       uses: number|null, baselineScore: number|null, postScore: number|null,
       isExternalFork: boolean }`.
  - **Default when no sidecar row** exists for a live skill:
    `{ confidence:null, version:1, status:'active', source:null, uses:null,
       baselineScore:null, postScore:null, isExternalFork:false }`.
  - `managed` stays **location-derived** (`isManagedLocation(location)`), never
    from the sidecar — external skills are never mistaken for writable.
  - Legacy status values (`draft`/`published`, reconciled in #797) map to `null`
    via a `VALID_STATUSES` allowlist.
- `apps/api_server/src/__tests__/opencode_skills_routes.test.ts` — 4 new cases in
  a `?withMetadata=true` describe block: (a) managed skill + sidecar row, (b)
  external skill + sidecar row (`isExternalFork:true`, `managed:false`), (c)
  skill with no sidecar row → defaults; names-alignment (name set identical
  with/without the flag and equal to the fork list; a ghost `measuring` sidecar
  row that targets no live skill is absent); falsification (zero live skills →
  `[]` despite a `measuring` sidecar row); and no `metadata` key without the flag.
- `docs/ai/project-state.md` — appended the coding-agent run entry under
  *Recent coding-agent runs* (done during the coding-agent step).

## Checks run

- `node_modules/.bin/tsc --noEmit` → exit 0.
- `npx vitest run opencode_skills` → 9 passed (5 original + 4 new).
- `npm test` (full vitest) → 1355 pass / 161 files (was 1351 at #792 baseline;
  exactly +4 new tests, no regressions).
- `npm run build` (tsc -p) → exit 0.
- **Falsification proven:** injecting a "leak sidecar rows as their own entries"
  bug failed the names-alignment test and the empty-set falsification test, then
  reverted. Assertions are `toEqual` on full metadata objects + sorted name
  arrays (not mocks / call-counts / bare status codes).

## Notes

- **Names-alignment (#775/#778):** the live fork set is the sole source of truth
  for which names appear. The join attaches metadata to existing entries only —
  it never adds or drops a name. Sidecar rows with `status='measuring'`/
  `'reverted'` surface only as metadata on the skill they target, never as their
  own entry; there is no proposals feed.
- **Decision (no separate decisions file):** join key is `name` resolved through
  `findByName` (which collates onto the `title` column per #792). The route's
  no-arg `AgentSkillsRepository()` uses the global DB (`getDb()`), matching the
  test harness's `setDb`. These are direct applications of #792's design, not a
  new architectural choice, so no `docs/ai/decisions/` entry was warranted.
- **For #794 (auto-apply pipeline) / #796 (unified menu):** consume
  `GET /opencode/skills?withMetadata=true` for the "show all skills with
  provenance" view; the plain (no-flag) call remains the picker's read and must
  stay untouched. The auto-apply lifecycle is `active`/`measuring`/`reverted`
  with baseline/post scores — not a review queue.
