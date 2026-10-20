---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: unverified
tags: [run, Rhythm]
---

# Repair unassigned Advanced session branch requests

## Files

- `apps/web/src/components/SessionRail.tsx` — clear prior branch options and request project branches only when the current Advanced context has a nonempty project ID. Task catalog loading still runs for unassigned sessions.
- `apps/web/tests/issue-1557-project-plus.spec.ts` — live-mode rendered gateway regression uses the actual unassigned session row (`projectId: ''`), checks no branch request, then checks exact Beta and Alpha requests/options and a return to unassigned without stale options.

## Checks

- Parent's old packaged `d7fb554735` RED run: named-session case reproduced `GET /projects//branches — Project not found`; the four-case focused command exited 1. No new package had been built.
- Focused source RED, before the product edit: `RHYTHM_E2E_PORT=4783 RHYTHM_DIST_PORT=4784 npm run build:guard -- /bin/zsh -f -c 'cd apps/web && npx playwright test -c playwright.branch-repair.config.ts issue-1557-project-plus.spec.ts -g "unassigned Advanced sessions" --reporter=line'` exited 1, with actual `branchRequests = ['/projects//branches']` against expected `[]`.
- The same focused command after the edit passed 1/1. The full `issue-1557-project-plus.spec.ts` file with the same guarded command and without `-g` passed 6/6. `cd apps/web && npm run typecheck` and `git diff --check` passed.
- Playwright's expected Chromium revision 1234 was absent. A temporary test-only config selected the installed Google Chrome executable for the RED/GREEN runs; it was removed afterward. The first attempt without it failed before page launch and is not behavioral evidence.
- Repaired packaged behavior remains unverified until the parent rebuilds the app and reruns the strict session/conversation error audit against the new exact build.

## Notes

- Root cause: `advancedContextProject?.id ?? selected.projectId` yielded the real empty-string project ID for an unassigned live session, and the effect sent it to `branches(projectId)`. The gateway constructed `/projects//branches`; the rejected response was hidden in the dialog but remained a backend ERROR.
- The GitNexus index available in the original checkout is stale and not present in this worktree. Its disambiguated `SessionRail` upstream impact returned LOW with zero indexed direct callers or affected processes/modules; the rendered tests and parent packaged check are the authoritative behavior evidence.
- No backend, engine, native app, account setting, project record, commit, push or PR was changed in this lane.
