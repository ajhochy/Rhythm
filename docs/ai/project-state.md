# Project State

## Current focus

Resolve and independently verify every open issue in #1076–#1175 on the
coordinator branch, then run the combined merge gate and open a draft PR.

## Active branch / PR

- Branch: `codex/issues-1076-1175-2026-07-24`
- PR: none; isolated issue worktrees are integrated only after verification.

## In progress

- #1096 is integrated: semantic-memory settings, diagnostics, installer/status
  controls, signed Flutter smoke, and real API verification passed.
- #1132 is integrated: complete generated fork SDK, compiled-runtime
  containment fix, and all six criteria passed against the standalone engine.
- #1135 is integrated: durable audit locks, reviewed re-enable, authoritative
  execution checks, and all six criteria passed.
- #1137 is integrated: unrestricted attachment selection plus real Read and
  actionable reader discovery; both criteria passed through live API+engine.
- Parallel sandbox-port infrastructure and the serial shared API merge gate are
  present. Other independently verified issue slices remain to be integrated.

## Risks / known issues

- Fork-wide typecheck has one unrelated base failure in
  `GlobalBusEmitter.emit`; core typecheck and focused fork suites pass.
- Two fork session timing tests fail in untouched base code; relevant session
  and API suites are green.
- #1134's YAML quoting fix must be integrated before combined smoke.
- #1135's SQLite/Postgres changes are additive, but the production Postgres
  bootstrap still requires normal migration review before merge.

## Test status

- #1096: API build/tests, Flutter format/analyze/tests, signed development
  client smoke, and live sandbox diagnostics/install-status flows pass.
- #1132: SDK deterministic build/typecheck, API/full and containment suites,
  Docker build, and live compiled event smoke pass.
- #1135: API/full workflow gates, focused 110-test suite, contract validation,
  fork build, and live smoke 2/2 pass.
- #1137: Flutter 979/979, prompt 55/55, picker 8/8, API build, and rebuilt
  standalone-engine/API live smoke 1/1 pass in 9.39s; no residue.
- Aggregate coordinator validation is pending after all verified slices land.

## Next step

Integrate the remaining clean issue commits, run GitNexus against `main`,
execute the combined API/fork/Flutter/live gates, and open a draft PR for human
review and merge.
