# Project State

## Current focus

Resolve and independently verify every open issue in #1076–#1175 on the
coordinator branch, then run the combined merge gate and open a draft PR.

## Active branch / PR

- Branch: `codex/issues-1076-1175-2026-07-24`
- PR: none; isolated issue worktrees are integrated only after verification.

## In progress

- #1096 is integrated: semantic-memory settings and signed/live diagnostics.
- #1123 is integrated: interactive async delegation with durable callbacks.
- #1132 is integrated: complete generated SDK and compiled containment fix.
- #1134 is integrated: session-bound external email approvals, outbound
  injection defenses, fail-closed model routing, and live security probes.
- #1135 is integrated: durable audit locks and reviewed re-enable.
- #1137 is integrated but under adversarial follow-up for a newly found fork UI
  post-selection gate and binary @mention containment path.
- Other independently verified slices remain to be integrated.

## Risks / known issues

- #1137 independent review found a P1 fork-UI consumption gap and is validating
  a possible containment regression; completion is frozen until fixed/retested.
- Fork-wide typecheck has one unrelated base failure in
  `GlobalBusEmitter.emit`; focused fork/core suites pass.
- Two fork session timing tests fail in untouched base code.
- #1135's additive SQLite/Postgres change requires normal migration review.
- #1123 adds one Rhythm MCP tool; update the PR tool count.

## Test status

- #1096: API/Flutter, signed client, and live diagnostics pass.
- #1123: API/MCP suites and real async parent wake pass.
- #1132: SDK/API/containment/Docker and live compiled event smoke pass.
- #1134: API build/full suite, six-criterion contract, rebuilt-engine security
  smoke, and zero external-send counters pass.
- #1135: API/full workflow, fork, and live 2/2 pass.
- #1137: prior automated/live gates pass, but independent review is now FAIL
  pending the P1 repair and rerun.
- Aggregate coordinator validation is pending after all slices land.

## Next step

Repair and independently re-review #1137, integrate the remaining issue
commits, finish the mobile dependency chain, then run combined gates and push a
draft PR.
