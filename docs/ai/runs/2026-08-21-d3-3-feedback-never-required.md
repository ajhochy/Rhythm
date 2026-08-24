---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d3-desktop-feedback-sonnet
pr: none
issues: [1438]
status: verified
tags: [run, Rhythm, D3]
---

# D3.3 — Verify feedback is never required for promotion

## Context

Recovered mid-flight after an account-limit interruption. A test file
(`org_proposal_experiment_service.test.ts`) was already modified,
uncommitted, on the branch — two new test cases under a `D3.3` heading that
matched this issue's two required tests exactly. Before doing anything else
this pass inspected whether the underlying production behavior already
satisfied the issue (per the C3/C4 design, it should): read
`feedback_metric_adapter.ts` (`computeExplicitUserVerdictRate` — returns
`value: null`, never `0`, below the predeclared minimum coverage or with zero
responses) and the `isFeedbackMetric` branch of `decideExperiment` in
`org_proposal_experiment_service.ts` (an objective-metric bundle never reads
the feedback ledger at all; a feedback-metric bundle with an unavailable
value returns `collecting`, never `decided`).

Both were already correct. This issue is explicitly a verification issue
("Add a test that verifies..."), not an implementation issue, so per the
task's own instruction no production code was touched — the job was to
confirm the two already-written tests are the right regression proof, run
them, and close out the contract/run-note evidence trail.

## What changed this pass

- `apps/api_server/src/services/__tests__/org_proposal_experiment_service.test.ts`
  — the two pre-existing uncommitted test cases were kept as-is (no edits
  needed):
  - `D3.3 feedback is never required for promotion > promotes to verified
    from objective evidence alone, with zero explicit feedback events on
    either cohort` — seeds 20 receipt-backed outcomes per cohort on a default
    objective-success-rate bundle, confirms directly against the ledger
    (`listFeedbackAsync`, `listLatestExplicitUserVerdictsAsync`) that not one
    seeded run has any feedback event, then asserts `judgeExperimentAsync`
    still reaches `promote` / `outcomeStatus: 'verified'`.
  - `C3-4 ... > D3.3: treats zero feedback events on both cohorts as
    unavailable (no signal) — never a fabricated zero, never a block or
    regress` — declares a feedback-metric bundle with zero verdicts on either
    cohort, asserts `computeDecisionAsync` returns `status: 'collecting'`
    (never `decided`, so never `promote`/`regress`/`inconclusive`), reason
    matching `/unavailable/i`, and `responseRate: 0` on both cohorts.
- `docs/ai/contracts/issue-1438.json`, this run note — new.

## Checks

- `cd apps/api_server && npx vitest run
  src/services/__tests__/org_proposal_experiment_service.test.ts
  src/models/__tests__/feedback_metric_adapter.test.ts
  src/models/__tests__/proposal_evidence_bundle.test.ts
  src/services/__tests__/proposal_evidence_validator.test.ts` (Node 22):
  **145/145 passed** (4 files), confirming both new D3.3 cases pass and no
  existing C3/C4 case regressed.
- `npx tsc --noEmit` (apps/api_server, Node 22): 0 errors.
- `npm run build` (apps/api_server, Node 22, `PATH=/opt/homebrew/opt/node@22/bin:$PATH`):
  passed (`tsc -p tsconfig.json` + postbuild advisories copy).
- `git diff --check`: clean.
- Added-line secret/security scan (grep for key/token/password/
  connection-string/private-key/API-key shapes) on the diff: no matches.
- GitNexus `detect-changes`/`analyze`: intentionally not run — the task
  explicitly forbids it on this branch because it rewrites AGENTS.md/CLAUDE.md.
  Mitigated by direct `git status --short` / `git diff --stat` inspection:
  exactly the 2 files listed above changed (the test file's diff was already
  present before this pass and is unmodified by it).

## Risk

Zero production code changed. The only durable artifact this pass adds is
test coverage plus contract/run-note documentation. The two new test cases
exercise the real `judgeExperimentAsync` / `computeDecisionAsync` /
`decideExperiment` path (no mocking of the decision logic itself), so they
will catch a future regression where the feedback branch is accidentally
wired into the objective-metric path or where an unavailable feedback value
starts being treated as a real zero.
