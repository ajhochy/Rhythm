---
date: 2026-10-02
repo: Rhythm
branch: mega/2026-09-29-consolidation
pr: null
issues: []
status: unverified
tags: [run, Rhythm, semantic-memory]
---

# Semantic memory freshness — slice 5 manager API

## Files

- `apps/api_server/src/services/engraph_manager.ts` — manager-owned refresh scheduler, approved-root-only `requestMemoryRefresh`, same-process owner delegation, foreign-owner blocking, forced serialized reindex/restart, fail-closed managed retrieval while freshness is non-idle, additive freshness status, and disable/shutdown pause.
- `apps/api_server/src/services/engraph_refresh_scheduler.ts` — pause/resume support so disable cancels timers while retaining pending revisions for a later explicit enable.
- `apps/api_server/src/__tests__/issue_1574_engraph_ownership.test.ts` — synthetic approved-root refresh and pending retrieval fallback regression.

## Checks

- PASS — elevated synthetic `engraph_refresh_scheduler`, manager, ownership, and route suites: 4 files, 70 tests.
- PASS — `npx tsc --noEmit` and `npm run build`.
- PASS — `git diff --check`.

## Notes

- No default writer/sync subscriber is present. No external/foreign process is signaled by the refresh API.
- Normal sandbox loopback/process probes are denied; the synthetic suite ran elevated against temporary fake binaries and test homes only.
