# Project State

## Current focus

**2026-06-25 — ACTUALLY remove is_manager forcing write from the importer.**

PR #741 (`fix/decouple-ismanager-importer`) has been rebased onto
`feature/agent-scheduler` and now contains the real fix:
- `const isManager = name === DEV_FRONT_DOOR_PRIMARY` deleted.
- `isManager` removed from both the UPDATE patch and the INSERT call.
- `DEV_FRONT_DOOR_SECONDARY` extended with `build`, `codex`, `gemini-cli`,
  `opencode` so CLI agents stay hidden from the session picker across every sync.
- 3 new tests: CLI agents hidden, claude-code selectable, re-sync stability.
- Existing is_manager decoupling tests (4 from prior commit) pass.
- Updated `issue-P4-manager-delegation-c6` test to assert `isManager=false`.

The app must be REBUILT from `feature/agent-scheduler` (after #741 merges) for
the churn to actually stop. Until then, every sync/restart will flip
`workflow-orchestrator` back to `is_manager=true`.

## Active branch / PR

- **Branch:** `fix/decouple-ismanager-importer`
- **PR:** [#741](https://github.com/ajhochy/Rhythm/pull/741) — open against `feature/agent-scheduler` (do not merge)
- **Also active:** `feature/agent-scheduler` → [PR #734](https://github.com/ajhochy/Rhythm/pull/734) (do not auto-merge)

## In progress

Awaiting human review and merge decision on PR #741.

## Risks / known issues

- **Merge order:** #741 must land before any code that reads `isManager` from
  the importer result. The feature/agent-scheduler branch already removed the
  importer's forced write so they are compatible.
- **P3 allowlist maintenance:** `AGENT_SKILL_ALLOWLIST_MAP` is hand-maintained.
- **Pre-existing flaky test:** `tasks_controller.test.ts > overdue=yes` intermittent.

## Test status

| Suite | Status |
|-------|--------|
| `apps/api_server npm run build` | **PASS** — `tsc -p tsconfig.json` |
| `apps/api_server npm test` | **PASS** — 141 files, 1196 tests |
| Hygiene test suite (20 tests) | **PASS** — all is_manager + CLI agent tests |
| GitNexus detect_changes | **LOW** — 2 symbols touched, 0 affected processes |

## Next step

1. Human reviews PR #741 and merges into `feature/agent-scheduler`.
2. Rebuild app from `feature/agent-scheduler` — churn stops.
3. Optional: run manual sync smoke to verify `workflow-orchestrator.isManager`
   stays false after restart.
