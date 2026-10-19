---
date: 2026-10-02
repo: Rhythm
branch: mega/2026-09-29-consolidation
pr: null
issues: []
status: unverified
tags: [run, Rhythm, semantic-memory]
---

# Semantic memory freshness — slice 4 lifecycle serialization

## Files

- `apps/api_server/src/services/engraph_manager.ts` — serializes public enable, retry, rebuild, disable, shutdown, and boot-start transitions through one manager queue. Disable/shutdown publish disabled state before cancellation/drain. The internal owned-stop primitive no longer awaits its own active lifecycle promise.

## Checks

- PASS — elevated synthetic fixtures: `npx vitest run src/__tests__/engraph_manager.test.ts src/__tests__/issue_1574_engraph_ownership.test.ts src/__tests__/engraph_manager_routes.test.ts --maxWorkers=1` — 3 files, 64 tests.
- PASS — `npx tsc --noEmit`.
- PASS — `npm run build`.
- PASS — `git diff --check`.

## Notes

- Normal sandbox execution cannot run these fixtures because loopback/process-identity probes return `EPERM`; it was rerun elevated against the existing fake binary and temporary test homes only.
- No refresh scheduler is instantiated in the manager yet. No memory writer/sync default callback, server, model, app, config change, or live vault was used.
