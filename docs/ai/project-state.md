# Project State

## Current focus

**2026-06-25 — Decouple is_manager from the OpenCode agent importer.**

Branch `fix/decouple-ismanager-importer` adds comments and tests to
`agent_profile_sync.ts` to prevent the importer from ever writing `is_manager`,
keeping that flag user-controlled so any profile (e.g. Secretary) can be the
manager and survive re-syncs unchanged.

Previous focus (feature/agent-scheduler, PR #734):
Production-trigger scheduled task parity implemented and automated verification
passed locally. PR #734 open; do not auto-merge.

## Active branch / PR

- **Branch:** `fix/decouple-ismanager-importer`
- **PR:** pending push — open against `feature/agent-scheduler` (base)
- **Also active:** `feature/agent-scheduler` → [PR #734](https://github.com/ajhochy/Rhythm/pull/734) (do not auto-merge)

## In progress

`fix/decouple-ismanager-importer` — commit ready, pushing to origin and opening PR.

## Risks / known issues

- **Other agent on feature/agent-scheduler is adding isManager to the importer** — this
  PR preempts that by landing the correct decoupled behavior with enforcement tests.
- **P3 allowlist maintenance:** `AGENT_SKILL_ALLOWLIST_MAP` is hand-maintained.
- **Pre-existing flaky test:** `tasks_controller.test.ts > overdue=yes` intermittent.

## Test status

| Suite | Status |
|-------|--------|
| `apps/api_server npm run build` | **PASS** — `tsc -p tsconfig.json` |
| `apps/api_server npm test` | **PASS** — 139 files, 1182 tests (4 new is_manager tests) |
| GitNexus detect_changes | **LOW** — 2 symbols touched, 0 affected processes |

## Next step

1. Push fix/decouple-ismanager-importer and open PR against feature/agent-scheduler.
2. Human reviews and decides merge order with respect to feature/agent-scheduler.
3. Resolve any conflicts when the other agent's manager-delegation work is merged.
