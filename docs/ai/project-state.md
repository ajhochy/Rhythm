# Project State

## Current focus

Finish #1174 mobile parity against a rebuilt, sandbox-scoped OpenCode engine,
then run the cumulative merge-readiness gates for open issues #1076–#1175.

## Active branch / PR

- Branch: `codex/mobile-1172-agents-activity`
- PR: none yet; this is the isolated mobile integration worktree.

## In progress

- Integrated and verified: #1096, #1123, #1132, #1134, #1135, #1137,
  #1157, #1161, #1162, #1164, #1166, #1167, #1168, #1169, #1170, #1171,
  #1172, and #1173.
- #1171 corrective commit `df75c94cf` independently passes with no P0–P2
  findings: malformed scans recover, Playwright owns dedicated ports, and
  secure-write rollback/recovery remains truthful across restart.
- #1172/#1173 now use the authenticated paired-Mac transport in production:
  safe project catalog, opaque project headers, SSE, PTY headers, activity,
  chat, and cloud/paired tool routing are scoped by account, host, and device.
- #1174 contract/parity work is still active. The live gate is initializing
  Git before asserting project update semantics, then rerunning the complete
  real-engine matrix.

## Risks / known issues

- Compare-to-main impact is expected HIGH/CRITICAL because this branch
  intentionally accumulates the full #1076–#1175 implementation.
- #1135's additive SQLite/Postgres change requires normal migration review.
- #1123 adds one Rhythm MCP tool; the draft PR description must update the
  approximate tool count.
- Signed distribution remains pending after aggregate simulator/live gates.

## Test status

- Required backend slices have focused checks and live sandbox evidence in
  `docs/ai/runs/`; #1096 also has signed Flutter UI evidence.
- #1137's final immutable review passes at `0c8ab294b`, including the guarded
  six-test live endpoint suite.
- #1170 passes focused contracts, API build, non-baseline regressions, and
  rebuilt-fork SSE/PTY live smoke.
- #1171 passes 22 paired-host scenarios, local/CI occupied-port rejection,
  3/3 corrective browser checks, and independent re-review.
- Paired production browser smoke passes QR pairing, project catalog, chat
  creation/completion over SSE, Activity, and an audit proving no filesystem
  paths or credentials crossed the mobile boundary.
- Current aggregate gates pass mobile `test:ci:static`, API build, and 13
  focused mobile gateway/project/SSE tests. GitNexus staged scope for the
  production wiring commit is LOW with zero affected indexed flows.

## Next step

Land and independently approve #1174, run cumulative API/mobile/fork/Flutter
gates plus native simulator smoke, then push the integration branch and update
the existing draft PR with exact live evidence and production review notes.
