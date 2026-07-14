---
date: 2026-07-12
repo: Rhythm
branch: fix/scheduled-task-registry-sync
pr: null
issues: [1039]
status: diagnosed-baseline-fix-confirmed
tags: [run, Rhythm]
---

# Scheduled-agent registry diagnosis

## Files

- `apps/api_server/src/services/__tests__/opencode_agent_writer_projection.test.ts`
  - Strengthened the existing #1039 regression: a profile projection must call
    `reloadConfig(process.cwd())`, not merely call `reloadConfig` once.
- `docs/ai/project-state.md`
  - Added the required coding-agent run record.

No production source was changed. The minimal production fix was already present
on the baseline in commit `7c949ef5b`.

## Confirmed mechanism

- Scheduler dispatch passes the scheduled row's config id into `AgentRunner`.
- `AgentRunner` resolves `oc_agent`, creates the engine session under
  `effectiveCwd = process.cwd()`, and prompts with `agent: oc_agent` in that same
  directory-scoped engine instance.
- The fork holds the agent registry in infinite-TTL global/config/agent caches;
  the config and agent service state is per directory.
- The #1015 controller refresh invalidated the default instance only. A profile
  write/promotion could therefore be visible in the default registry while the
  scheduled/headless `process.cwd()` registry remained stale and threw
  `Agent not found`.
- Commit `7c949ef5b` changed the writer to request
  `reloadConfig(process.cwd())`; the client reloads both default and that exact
  directory.

Timestamp correlation from the real database (read-only) and git history:

- failures: `2026-07-12T00:33:00Z` through `00:35:00Z` (17:33-17:35 PDT)
- per-directory fix authored: `2026-07-11T17:38:22-07:00`
- same scheduled task succeeded: `2026-07-12T00:40:00Z` (17:40 PDT)

The prior live run `docs/ai/runs/2026-07-12-uso-followups-live-verified.md`
records the decisive hot-engine demote -> promote -> trigger proof: zero
`Agent not found` errors after the directory-targeted reload and a completed
Theological-Researcher run.

## Checks

- `cd apps/api_server && npx tsc --noEmit` - PASS (exit 0, no output).
- `cd apps/api_server && PATH=/usr/local/bin:$PATH npx vitest run src/services/__tests__/opencode_agent_writer_projection.test.ts --reporter=verbose`
  - PASS: 1 file, 5 tests.
- `cd apps/api_server && PATH=/usr/local/bin:$PATH npx vitest run src/__tests__/issue_739_scheduler_agent_runner.test.ts --reporter=verbose`
  - PASS: 1 file, 4 tests.
- `cd apps/api_server && PATH=/usr/local/bin:$PATH npx vitest run src/__tests__/p2_systemprompt_ocagent.test.ts --reporter=dot`
  - PASS: 1 file, 10 tests (expected non-fatal warnings from partial SDK mocks).
- `cd apps/api_server && npm run build`
  - PASS: TypeScript build + postbuild advisory copy.
- `ai-workflow checks --level issue`
  - API TypeScript subcheck PASS.
  - Flutter analyze/format blocked because the managed sandbox cannot write
    `/Users/ajhochhalter/development/flutter/bin/cache/engine.stamp`.
- Full `npm test -- --reporter=dot` was started but intentionally interrupted:
  sandbox-denied local socket connections/listeners produced extensive unrelated
  noise, and the user-required relevant suites above had already completed.

## Live attempt and limits

Attempted a fresh backend using:

- temporary HOME: `/tmp/rhythm-sched-registry.*/home`
- temporary SQLite DB: `/tmp/rhythm-sched-registry.*/rhythm.db`
- port `4098`
- the built Rhythm fork through `RHYTHM_OPENCODE_BIN_DIR`

The isolated DB initialized and the fork spawn path was selected, but Node was
blocked at `listen(4098)` with `EPERM`. No HTTP/live reproduction could be run in
this sandbox. The real `~/Library/Application Support/Rhythm/rhythm.db` was only
queried with `sqlite3 -readonly`; it was never opened by the test server or
modified.

GitNexus MCP tools and `.gitnexus/run.cjs` were unavailable, so no graph impact
report or `detect_changes()` result could be generated. The diff is limited to
one existing test assertion plus project documentation.

