---
date: 2026-08-11
repo: Rhythm
branch: mega-ws/research
pr: null
issues: [1300]
status: blocked-live-gate
tags: [run, Rhythm]
---

# Issue #1300 — Research Projects rollout gate

## Files

- Added guarded flag-on and flag-off live E2E suites.
- Added state-preserving sandbox restart and gateway listener accounting.
- Added rollout, recovery, metrics, and manual desktop smoke documentation.
- Added pass/synthesis completion identifiers and generic project-completion indexing needed for real canonical artifacts.
- Updated the MCP registration guard from 99 to 100 tools for `rhythm_discuss_research_report`.

## Checks

- `npx vitest run` for issue #1288–#1300 API contracts: 12 files / 65 tests passed after the final generic-index regression; focused #1289/#1292/#1293/#1300: 4 files / 22 tests passed.
- `npm run build` and `npx tsc --noEmit` in `apps/api_server`: passed.
- `npm run typecheck` in `apps/mcp_server`: passed.
- Focused MCP registration/security: 2 files / 8 tests passed; registry count is 100.
- `bash -n tools/dev/sandbox.sh`: passed.
- Direct Flutter analyze with `FLUTTER_ALREADY_LOCKED=true`: exit 0 with 309 pre-existing infos; format inspected 465 files and reported 0 changed, then telemetry write outside the sandbox caused exit 1.
- Full MCP and flag-off legacy runner suites: socket-backed cases failed with expected `listen EPERM`; non-socket specialist flag-off tests passed 2/2.
- Live flag-on/off suites and Flutter widget/visual smoke: not run because this worker cannot bind sockets. Exact orchestrator commands are in `docs/ai/testing-guide.md`.

## Notes

- The live gate remains failed/blocked until the orchestrator runs both fresh-process modes, clean teardown, and native Flutter print/export smoke.
- GitNexus impact/detect-changes could not run: this worktree lacks `.gitnexus/run.cjs` and no GitNexus MCP tool is exposed. Narrow symbol tests and `git diff --check` are the fallback, not a substitute.
- No rollout or feature-flag enablement was performed. AJ approval is still required after the complete gate.
