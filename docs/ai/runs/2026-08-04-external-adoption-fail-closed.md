---
date: 2026-08-04
repo: Rhythm
branch: fix/external-adoption-fail-closed
pr: TBD
issues: []
status: awaiting-review
tags: [run, Rhythm]
---

# External-adoption path: fail-closed judge + relevance floor

## Files

- `apps/api_server/src/services/generators/external_discovery_search.ts` — fail-closed
  judge, absolute adoption floor, foreign-stack relevance floor on both lanes,
  honest rationale, `searchSkillCandidates` exported for testing.
- `apps/api_server/src/services/skill_refiner.ts` — `KEEP_SCORE_BAR` exported from the
  rubric's owner (was a private const in `harvested_skill_evaluator.ts`).
- `apps/api_server/src/services/harvested_skill_evaluator.ts` — imports the shared bar.
- `apps/api_server/src/services/generators/__tests__/external_discovery_search.test.ts` —
  9 → 22 tests.

## Checks

- `npx --no-install tsc --noEmit` → clean.
- `npm test --silent -- --fileParallelism=false` → 467 files pass / 0 fail / 85 skipped;
  3849 tests pass (exit 0). Same command on `main` in this worktree: 467 / 0 / 85 and
  3835 tests — delta is exactly the +14 tests added here.
- 5 deliberate mutations, each killed by the new tests (see PR body).

## Flake

Two intermediate full-suite runs each failed 2 files, on **disjoint** pairs
(`agent_sessions` + `opc_m4_3_mcp_routes`, then `issue_1060_file_find_proxy` +
`notifications`). All four pass in isolation, all four use `startTestServer`, whose
docstring already documents this load/timing-dependent class. One surfaced as an
`HTTPParserError` carrying `{"type":"Tier1","version":"1.0"}` — a handshake from a
machine-local daemon, a string absent from `apps/api_server`. Environmental; this dev box
currently has many live ephemeral-range listeners (`engraph`, the running app, etc.).

## Notes

- The fail-open was `const wins = unavailable || candScore.score > draftScore.score;`
  — a 0/0 scorer result shortlisted every candidate unjudged. With scheduler runs now
  unattended (`docs/ai/decisions/2026-08-04-unattended-scheduled-run-autonomy.md`,
  PR #1312) there is no human between that shortlist and the queue, so a scorer
  outage had become blanket approval on the lane that runs
  `npx skills add <arbitrary-github-repo>`.
- The relevance floor is a **denylist of foreign ecosystems**, not a stack allowlist:
  an allowlist would also reject every stack-neutral skill (conventional-commits,
  code review), which is most of the lane's legitimate reach. Its ceiling — an
  unlisted foreign ecosystem gets through on the score floor alone — is documented
  at the constant, and every drop logs the token that fired so the list is grep-able
  from run logs.
- `renderWouldBeDraft` is still a stub and is now documented as one. The absolute
  floor (`KEEP_SCORE_BAR`) is the real quality guard; the relative comparison is kept
  only as an "is adopting even better than writing our own?" tiebreak.
