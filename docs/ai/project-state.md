# Project State

## Current focus

Implementing **#949** — skill harvester writes draft `SKILL.md` files +
auto-binds to the source agent, closing the self-improvement loop. This
supersedes the Unify-2 "materialize-on-publish" section (point 4 of
`2026-06-28-unify-skills-source-of-truth.md`), which was never built and left
harvested drafts as invisible DB rows.

A separate inflight branch (`issue-929-skill-self-regulation`) carries
uncommitted #929 agent-profile-permission work — stashed as
`wip-929-inflight-stashed-for-949` to isolate the #949 implementation on a
clean base off `main`.

## Active branch / PR

- **`issue-949-harvest-to-file`** (off `main` @ #926 merge) — #949
  implementation in progress. Draft PR pending.
- `issue-929-skill-self-regulation` — 14 uncommitted #929 files stashed;
  restore + finish after #949 lands.
- PR #924 (`issue-912-913-opencode-continuity`) — MERGED.
- PR #925 (`issue-batch-july4`) — MERGED.

## In progress

- **#949** — `distillFromSession()` now writes a draft `SKILL.md` to
  `~/.config/opencode/rhythm-managed-skills/drafts/<name>/` (not a DB row),
  auto-binds to the extracting agent's `allowedSkillsJson` (skips when
  unrestricted to avoid lock-down), and triggers `reloadSkills`. Decision doc
  filed. Tests updated. Awaiting commit + draft PR.

## Risks / known issues

- `AgentSkillsRepository` + the `agent_skills` table are **not deleted** in
  this pass (32 direct callers, GitNexus CRITICAL). Only the
  `distillFromSession` write site changed. The refiner path still uses the
  repo for in-place refinement of legacy DB skills. Cleanup is a follow-up.
- **Auto-bind correctness guard:** `allowedSkillsJson === null` means
  unrestricted — the bind MUST skip in that case (writing `[name]` would lock
  the agent down to only the draft). Implemented + tested.
- Pre-existing test failures (22 across memory-vault + auth-middleware suites)
  on `main` — unrelated to #949 (ENOENT temp-dir + 401 auth env issues).
- `#929` work is stashed but not lost — restore with
  `git stash apply wip-929-inflight-stashed-for-949` on
  `issue-929-skill-self-regulation`.

## Test status

- #949: `tsc --noEmit` clean; `skill_extractor.test.ts` 9/9 pass;
  related suites (managed skills, agent configs, refiner, retrieval) 62/62
  pass; import smoke OK; GitNexus `detect_changes` vs main = LOW risk, 0
  affected processes.

## Next step

- Commit + push `issue-949-harvest-to-file`, open draft PR.
- Manual smoke: run a 2+ round agent session, confirm a
  `drafts/<name>/SKILL.md` appears, the agent's `allowedSkillsJson` includes
  it, `GET /opencode/skills` lists it, and the Flutter Skills UI shows it.
- Restore #929 stash and finish that branch after #949 review.
