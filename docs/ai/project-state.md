# Project State

## Current focus

Permission ask/reply pipeline work for #1341, #1367, #1322, and server-side #1340 is implemented and committed. See `docs/ai/runs/2026-08-10-permission-pipeline.md`.

## Active branch / PR

- Branch: `mega-ws/permissions`.
- No push and no PR, per mega-worker mandate.

## In progress

- No code work remains in this workstream.
- Orchestrator verification remains: run the env-gated #1322 live sandbox test and the full API suite in a socket-capable environment.

## Risks / known issues

- The managed worker forbids loopback socket binding, so socket-backed API tests fail in setup with `listen EPERM`.
- `apps/api_server` still has no effective lint gate; its configured lint script is a placeholder.
- The canonical permission WS payload intentionally replaces the older `permissionId/toolName/summary` ask shape with `permissionID/directory/tool/patterns/title/createdAt` for both asked and replied events.

## Test status

- Fork typecheck and permission scope: PASS (80 tests).
- API local TypeScript compiler: PASS.
- Focused final permission scope: PASS (130 tests).
- Full `npm test`: ENVIRONMENT BLOCKED after 367 files / 3,334 tests passed; 126 files / 719 tests hit the sandbox socket restriction.
- #1322 live sandbox test: authored, not run in this no-socket worker.

## Next step

Run `RHYTHM_LIVE_E2E=1` for `live_e2e_1322_plan_permission.test.ts` through `tools/dev/sandbox.sh`, then rerun `npm test` in a socket-capable worker before merge readiness.
