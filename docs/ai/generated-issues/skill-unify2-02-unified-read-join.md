# skill-unify2-02 — Unified read: join sidecar metadata onto live engine skills

## Context
Epic: unify to ONE skill source. Decision:
`docs/ai/decisions/2026-06-28-unify-skill-source-and-self-improvement.md`.

The standalone Skills menu and any "show all skills with provenance" UI need a single
read that returns the **live engine skill set** (`GET /skill` via the existing
`GET /opencode/skills` proxy) joined to the sidecar metadata from issue 01 (by
`name`). Skills with no sidecar row return null/default metadata. This is the
cheapest-version-that-proves-the-idea step — once the unified read exists, the menu
(issue 05) can be converted.

Current proxy returns `SkillListEntry { name, description?, location, managed }`.

## Acceptance criteria
- `GET /opencode/skills` accepts an optional `?withMetadata=true` query param.
  - Without it: unchanged response (`{ name, description?, location, managed }`) —
    the Agent Profile picker is unaffected.
  - With it: each entry additionally carries `metadata` joined by `name` from the
    sidecar: `{ confidence: number|null, version: number, status: 'draft'|'published'|'proposed'|null, source: string|null, uses: number|null, hasProposals: boolean }`. When no sidecar row exists, `metadata` is `{ confidence: null, version: 1, status: null, source: null, uses: null, hasProposals: false }`.
- `managed` continues to be derived from `isManagedLocation(location)` (the source of
  truth for managed vs external), NOT from the sidecar.
- The set of `name`s returned with `?withMetadata=true` is **exactly** the set
  returned without it (and exactly mirrors the fork's `GET /skill` names) — no skill
  added or dropped by the join. (The names-alignment invariant from #775 / #778.)
- A `'proposed'`-status sidecar row does NOT appear as its own skill entry (proposals
  are surfaced via `hasProposals` and a separate proposals feed in issue 04/05), only
  as metadata on the skill it targets when that skill exists.
- Repository gains/uses `findByName` (issue 01) for the join; the join is O(n) over
  the live set, not N+1 per skill.

## Likely files
- `apps/api_server/src/routes/opencode_skills_routes.ts`
- `apps/api_server/src/repositories/agent_skills_repository.ts` (findByName / listByName map)

## Dependencies / order
After 01 (needs the sidecar columns + `findByName`).

## Safety notes
- Read-only endpoint change; no writes. `managed`/`external` classification must stay
  location-derived so external skills can never be mistaken for writable.
- Preserve the names-alignment guarantee — do not let the join filter or rename.

## Required tests
- vitest: `?withMetadata=true` returns correct joined metadata for (a) a managed skill
  with a sidecar row, (b) an external skill with a sidecar row, (c) a skill with NO
  sidecar row (null/default metadata). Use a fake fork-skill list + in-memory repo.
- vitest: name set identical with/without the flag; mirrors the fork list.
- `tsc --noEmit` clean.

## Open question that changes this issue
If the user picks a **new `GET /skills` endpoint** instead of extending the proxy
(Known Ambiguity), build that here instead. Default: extend `GET /opencode/skills`.
