---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1574]
status: in_progress
tags: [run, rhythm]
---

# Engraph startup ownership proof

## Files

`engraph_manager.ts` now verifies the full relay and child identity from one OS snapshot after authenticated health. It takes at most three snapshots, 75 ms apart, only when evidence is unavailable. Conflicting nonce, configuration hash or process identity fails immediately. Health alone cannot mark a starting managed process ready. Failure messages identify the failed proof without exposing process commands.

## Checks

The original concurrent-manager test passed in isolation after failing in the aggregate API run. Its historical failed operand was not logged and remains unknown. New deterministic tests cover a single unavailable OS snapshot, persistent absence and conflicting child start identity. The transient test failed before implementation; all three now pass. No ownership assertion or timeout was weakened.

Candidate ownership/manager/routes tests: 62 passed; API build passed. Parent integrated replay: 55 ownership/manager tests and 7 route tests passed. Parent first attempted Vitest from the monorepo root and received `vitest: command not found`; the corrected API workspace commands produced these results. GitNexus impact on `_doStart` and `checkHealthNow` was LOW against a stale sibling index.

## Notes

Tests use disposable fake Engraph executables and actual OS child processes. They do not qualify the installed Engraph binary or the complete native feature. A full integrated API rerun is still required; the previous aggregate failure must not be relabeled as passed solely from focused results.
