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
- #1123 is integrated: interactive async delegation, durable exactly-once
  completion delivery, busy-parent deferral, and live parent wake passed.
- #1132 is integrated: complete generated fork SDK, compiled-runtime
  containment fix, and all six criteria passed against the standalone engine.
- #1135 is integrated: durable audit locks, reviewed re-enable, authoritative
  execution checks, and all six criteria passed.
- #1137 is integrated: unrestricted attachment selection plus real Read and
  actionable reader discovery; both criteria passed through live API+engine.
- Other independently verified slices remain to be integrated.

## Risks / known issues

- Fork-wide typecheck has one unrelated base failure in
  `GlobalBusEmitter.emit`; core typecheck and focused fork suites pass.
- Two fork session timing tests fail in untouched base code.
- #1134's YAML quoting fix must be integrated before combined smoke.
- #1135's additive SQLite/Postgres change requires normal migration review.
- #1123 adds one Rhythm MCP tool; the eventual PR description must update the
  approximate tool count per repository instructions.

## Test status

- #1096: API/Flutter tests, signed client, and live diagnostics pass.
- #1123: API/MCP focused and aggregate suites plus real async
  dispatch→intervening parent input→child completion→parent wake pass.
- #1132: SDK/API/containment/Docker and live compiled event smoke pass.
- #1135: API/full workflow, focused 110-test, fork, and live 2/2 pass.
- #1137: Flutter 979/979, prompt 55/55, picker 8/8, API build, and live 1/1
  pass in 9.39s with no residue.
- Aggregate coordinator validation is pending after all slices land.

## Next step

Integrate the remaining clean issue commits, finish the mobile dependency
chain, run GitNexus and combined gates, then push a draft PR.
