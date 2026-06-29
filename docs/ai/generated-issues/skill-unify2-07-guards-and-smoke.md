# skill-unify2-07 — Guards: names-alignment + no-in-place-external-write + parity smoke

## Context
Epic: one skill source, safely. Decision:
`docs/ai/decisions/2026-06-28-unify-skill-source-and-self-improvement.md`.

The epic introduces a propose→approve→apply path and a fork-to-managed write for
external skills. The existing guards (`smoke_skill_alignment.sh`,
`skill_names_alignment.test.ts`, `smoke_skill_allowlist.sh`) protect #775/#778
invariants; this issue extends them so the new behavior can't silently regress the
single-source / no-skill-lost / never-touch-external-files invariants.

## Acceptance criteria
- `tools/release/smoke_skill_alignment.sh` (real-binary, against the built fork) gains:
  - a **propose → approve → materialize → reload** round-trip: enqueue a proposal for a
    managed skill, approve it, confirm the managed SKILL.md changed and the reloaded
    `GET /skill` reflects it;
  - an **external-skill safety** assertion: stage an external skill outside the managed
    dir, run the approve path for a proposal targeting it, and assert (a) a managed fork
    appears with the same name, AND (b) the original external file's bytes are
    UNCHANGED;
  - the existing **names-alignment** invariant still holds: every derived
    `allowed_skills_json` name ⊆ live `GET /skill` names; managed forks are added to the
    live set so the subset relation is preserved.
- `apps/api_server/src/__tests__/skill_names_alignment.test.ts` is extended (or a sibling
  test added) to cover the unified read (`?withMetadata=true`) name set mirroring the
  fork name set, and that a `'proposed'` row does not leak into the skill name set.
- The schema-parity test from issue 01 is wired so CI fails on a one-DB-only column add.
- Guards run in CI without a signed release (real-binary fork smoke uses the built
  binary, consistent with #775/#778).

## Likely files
- `tools/release/smoke_skill_alignment.sh`
- `apps/api_server/src/__tests__/skill_names_alignment.test.ts`
- `.github/workflows/desktop_release.yml` (only if a new guard needs wiring; the
  alignment smoke is already wired)

## Dependencies / order
Last. After 04 (apply path) + 06 (migration) so the round-trip and external-safety
assertions have something to exercise.

## Safety notes
- The external-file-unchanged assertion is the guard for the epic's central safety
  invariant — do not weaken it.
- The smoke must use the BUILT fork binary, not a mock (per
  memory `project_opencode_fork_rebuild_resign_gotcha` — verify against the built
  binary, not a stub).

## Required tests
- `smoke_skill_alignment.sh` exits 0 against a built fork with all assertions above.
- `vitest run` green including the extended alignment + parity tests.
