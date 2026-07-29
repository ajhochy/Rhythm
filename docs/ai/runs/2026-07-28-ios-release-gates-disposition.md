---
date: 2026-07-28
repo: Rhythm
branch: mega/post-1241-20260728
pr: 1242
issues: [1197, 1198, 1199, 1200, 1175]
status: bounded
tags: [run, rhythm, release]
---

# iOS release-gate disposition — post-#1241 mega run

These five issues form the human/hardware/credential-gated tail of the iOS
release train. Automatable parts were executed; the rest is documented as the
bounded gaps the issues' own stop clauses define. **None are closed by PR
#1242.**

## Candidate SHA invalidation (applies to all five)

#1197–#1200 pin candidate source SHA `6dd2516f96b357d99854b8fbcb0ef6ad1206ae07`.
This mega run (and PR #1241 beneath it) materially changes mobile product code
(#1235 headers, #1237 status authority, #1238 composer, #1231 catalog sync).
Per #1197's own rule ("if any product code changes after review begins, stop
and establish a new candidate SHA"), **a new candidate SHA must be established
after PR #1241 + #1242 merge**, and the review → signed build → device matrix
→ TestFlight chain restarts from there.

## Per-issue disposition

- **#1197 (independent review):** superseded-by-drift; a fresh-context review
  of the consolidated branch runs as part of this PR's Phase-6 verification
  (see PR body), but the formal release-candidate review must target the
  post-merge SHA. Remains open.
- **#1198 (signed dev build):** blocked at the credential gate — `eas whoami`
  on this machine: **Not logged in**; the orchestrator does not handle
  credentials. Read-only config verified: development profile resolves
  `EXPO_APP_VARIANT=development`, `developmentClient: true`, `distribution:
  internal`, `credentialsSource: remote`; EAS project
  `bd873c89-2fe2-45db-805c-ab819e582e5c` matches the issue. Human step: log in
  with secure tooling and run `cd apps/mobile && npm run eas:development:ios`
  against the post-merge SHA. Remains open.
- **#1199 (physical iPhone matrix):** requires a physical device on the test
  Apple account + tailnet; not automatable from this environment. Canonical
  checklist unchanged (docs/testing/manual-smoke.md §14). Remains open.
- **#1200 (TestFlight production):** requires #1199 green plus AJ's explicit
  authorization by its own preconditions. Remains open.
- **#1175 (aggregate gates):** the automatable aggregate gates were run on the
  consolidated branch during this run (api 3663+/0 modulo isolated load
  flakes, mobile static + e2e 62/62 at #1235 integration, flutter 1014/1014,
  fork typecheck/tests/build, mcp build+tests, live sandbox E2Es per issue).
  Signing/TestFlight tail remains with #1198–#1200. Remains open.
