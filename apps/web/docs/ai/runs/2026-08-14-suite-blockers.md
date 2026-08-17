---
date: 2026-08-14
repo: rhythm-desktop-agents
branch: unavailable
pr: null
issues: [suite-blockers]
status: ready-for-verification
tags: [run, rhythm-desktop-agents]
---

# Deterministic suite blockers

## Contract

- Contract: `docs/ai/contracts/task-suite-blockers.json`
- Failing acceptance run: `npm test` — 11 failed, 227 passed, 1 skipped.
- Final acceptance run: `npm test` — 0 failed, 238 passed, 1 skipped.

## Files changed

- `tests/contract/issue-2001-dashboard.spec.ts`
- `tests/pages/dashboard.spec.ts`
- `tests/contract/issue-2002-planner.spec.ts`
- `tests/contract/issue-2003-tasks.spec.ts`
- `tests/contract/issue-2005-projects.spec.ts`
- `tests/contract/issue-2006-messages.spec.ts`
- `tests/contract/issue-2009-integrations.spec.ts`
- `tests/shell.spec.ts`
- `docs/ai/contracts/task-suite-blockers.json`
- `docs/ai/runs/2026-08-14-suite-blockers.md`

## Checks run

- `npx playwright test tests/contract/issue-2001-dashboard.spec.ts tests/pages/dashboard.spec.ts tests/contract/issue-2002-planner.spec.ts tests/contract/issue-2003-tasks.spec.ts tests/contract/issue-2005-projects.spec.ts tests/contract/issue-2006-messages.spec.ts tests/contract/issue-2009-integrations.spec.ts tests/shell.spec.ts --workers=1` — 95 passed, 2 failed. The remaining failures exposed grouped task ordering and the intended CORS-enabled dist server.
- `npx playwright test tests/contract/issue-2003-tasks.spec.ts tests/shell.spec.ts --workers=1` — 18 passed, 0 failed.
- `npm test` — build passed; Chromium launched; 238 passed, 0 failed, 1 skipped in 5.9m.
- `npm run test:dist-smoke` — passed; launcher target, index, and 2 relative assets verified.
- GitNexus change detection — unavailable because this workspace has no Git metadata and is outside the indexed Rhythm worktree.

## Notes

- Updated stale expectations to current deterministic UI copy and fixture punctuation.
- Kept task title-sort verification within each rendered bucket, matching the grouped UI contract.
- Corrected the Messages URL regex escaping.
- Pointed the sandboxed shell test at the existing CORS-enabled local dist server on `127.0.0.1:4174` instead of an unavailable port.
- No product source, fixture truth, endpoint semantics, permissions, or live-service behavior changed.
- `RHYTHM_LIVE_E2E` was not enabled; tests remained loopback-only.
