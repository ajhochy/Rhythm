# skill-unify2-04 — Apply path: review → managed write / fork-to-managed + reload

## Context
Epic: improve all engine skills safely. Decision:
`docs/ai/decisions/2026-06-28-unify-skill-source-and-self-improvement.md`.

Issue 03 enqueues `status='proposed'` sidecar rows but never touches a file. This issue
adds the **human-reviewed apply path**: approving a proposal materializes it.
- A proposal targeting a **managed** skill (file already in the managed dir) → revise
  in place: write the new body, snapshot the prior version to `agent_skill_versions`,
  bump version, reload.
- A proposal targeting an **external/handwritten** skill (`is_external=1`) → **fork to
  a managed copy**: write a NEW managed SKILL.md with the same `name` (shadowing — see
  Known Ambiguity), version the managed copy, reload. **The original external file is
  never written and stays byte-identical.**

This is the central safety mechanism (prior art: never edit files agents don't own;
fork instead). It guarantees `sync-globals` targets are never mutated.

## Acceptance criteria
- New routes (local agent server only, `localhost:4001`):
  - `GET /skills/proposals` — list open `'proposed'` rows (optionally filtered by
    `proposed_for_name`).
  - `POST /skills/proposals/:id/approve` — apply the proposal:
    - managed target → `writeManagedSkill` with the new body (revise in place) +
      version snapshot via the existing history mechanism + `reloadSkills()`.
    - external target (`is_external=1`) → `writeManagedSkill` a managed fork
      (same `name`) + `reloadSkills()`; the original `origin_location` file is read
      before and after and asserted byte-identical in the test.
    - The applied proposal row transitions out of `'proposed'` (e.g. to `'published'`)
      and links to the materialized skill.
  - `POST /skills/proposals/:id/reject` — discard the proposal (delete or mark
    `rejected`); no file written.
- ALL writes go through `rhythm_managed_skills.writeManagedSkill` / the managed-dir
  boundary; any attempt to write a `location` outside the managed dir throws
  `InvalidSkillNameError`/is rejected (defence-in-depth assertion).
- Approving is idempotent-safe and never corrupts an unrelated skill (managed name
  collisions overwrite the same managed SKILL.md, never a different one).
- Best-effort reload: a reload failure logs but does not fail the approve (mirrors
  `skill_materializer` fire-and-forget semantics) — but the DB transition only commits
  if the file write succeeded.

## Likely files
- new `apps/api_server/src/routes/skill_proposals_routes.ts` + controller (or extend
  `opencode_skills_routes.ts`)
- `apps/api_server/src/services/skill_materializer.ts` (reuse / extend for fork-apply)
- `apps/api_server/src/services/rhythm_managed_skills.ts` (boundary already enforced)
- `apps/api_server/src/repositories/agent_skills_repository.ts` (approve/reject/transition)
- `apps/api_server/src/app.ts` (route registration)

## Dependencies / order
After 03 (consumes the proposal rows it creates).

## Safety notes
- **THE critical invariant:** approving a proposal for an external/handwritten skill
  must NEVER write the original file. It only ever writes inside
  `~/.config/opencode/rhythm-managed-skills`. A test reads the external file's bytes
  before and after approve and asserts they are unchanged.
- Never write a `sync-globals` target. `isManagedLocation` + `slugForSkillName`
  path-traversal guards are the enforcement.

## Required tests
- vitest: approve-managed → managed SKILL.md updated, version bumped, history row
  written, `reloadSkills` called.
- vitest: approve-external → a managed fork SKILL.md created with the same name AND the
  `origin_location` file bytes unchanged.
- vitest: approve attempts to write outside the managed dir → rejected.
- vitest: reject → no file written, proposal removed/marked.
- `tsc --noEmit` clean.

## Open question that changes this issue
External-fork naming: same-`name` shadow [recommended] vs `foo (rhythm)` distinct
name. If distinct, the fork uses a derived name and issue 05 lists two rows.
