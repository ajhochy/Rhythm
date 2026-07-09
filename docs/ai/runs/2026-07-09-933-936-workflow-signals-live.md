---
date: 2026-07-09
repo: Rhythm
branch: issues-933-936-workflow-signals
pr: pending
issues: ["#933", "#934", "#935", "#936"]
status: verified-live
tags: [run, Rhythm]
---

# Run — Workflow-failure-signals chain (#933-#936)

## What each issue delivers

- **#933 — read-only workflow failure signal extractor.** Scans workflow
  activity for known failure shapes: stale-redo, retry-loop,
  hallucinated/unverified-claim, delegate-result, missing-scope,
  tool-unavailable, repeated-correction. Read-only — no side effects.
- **#934 — wire signals into the org audit snapshot.** `buildOrgAuditSnapshot`
  now surfaces extracted signals alongside existing audit data. Read-only
  behavior of the snapshot is preserved; this only adds a new read-only
  input.
- **#935 — feed signals into existing optimizer lanes.** Reuses the already
  shipped approve → apply proposal machinery instead of adding a new lane:
  `missing-scope` → `broaden-scope`; every other signal category →
  `create-recipe`.
- **#936 — dedup/cap/stale-fixed safeguards.** Prevents proposal spam:
  dedups repeat signals, caps proposal volume, and retires proposals for
  issues that have since been fixed.

## Live-gate bug + fix

`apps/api_server/src/__tests__/live_e2e_933_936.test.ts` (added in this run,
gated behind `RHYTHM_LIVE_E2E=1`, run against the real fork-engine backend)
caught a real bug that the mocked unit tests missed:

> The create-recipe proposal dedup key was built from the agent profile,
> which is EMPTY ('unattributed') for agent-less sessions — so every
> stale-redo pattern collapsed into one dedup key
> (`create-recipe:workflow:stale-redo:` with empty token, observed live in
> the DB) and #936's dedup suppressed all but the first, so distinct issues
> never surfaced.

Fix (commit `e3feef0cd`, `fix(#936): dedup workflow proposals on signal
identity, not empty profile`): the extractor now emits a stable per-category
`dedupToken` (issue-scoped for stale-redo, session-scoped for
single-session incidents, profile-scoped otherwise), and the generator keys
the create-recipe `dedupKey` + `signalRef` on it. A live probe confirmed
distinct issues now each produce their own proposal.

## Verification evidence

- **Live gate PASSED**: `apps/api_server/src/__tests__/live_e2e_933_936.test.ts`
  under `RHYTHM_LIVE_E2E=1` against the real fork-engine backend — the test
  `a stale-redo pattern flows extractor -> audit snapshot (read-only) ->
  proposal -> dedup on rerun` shows PASS (verified twice, including verbose
  run).
- **Full api_server unit suite**: 290 files / 2485 passed / 2 skipped (the
  live-gated tests) — `tsc --noEmit` clean.
- Live E2E test explicitly not re-run as part of this documentation/PR
  step — evidence above is from the already-completed verification.

## Commits (newest first)

- `e3feef0cd` fix(#936): dedup workflow proposals on signal identity, not
  empty profile
- `b9b970608` test(#933-936): live E2E for the workflow-failure-signals
  chain (gated)
- `62680b5c0` test(#936): prove dedup/cap/stale-fixed safeguards end-to-end
- `31c54d6a6` feat(#935): feed workflow failure signals into existing
  optimizer lanes
- `05320ffe4` feat(#934): wire workflow failure signals into org audit
  snapshot
- `901a9a75f` feat(#933): add read-only workflow failure signal extractor
- (base) `09253cd55` Merge pull request #926

## Notes

- This branch was cut from `origin/main` **before #949 merged**, so it does
  not contain #949 — that's fine, the chain touches unrelated files. The
  reviewer should merge #949-dependent PRs (#940, #955) independently of
  this PR.
