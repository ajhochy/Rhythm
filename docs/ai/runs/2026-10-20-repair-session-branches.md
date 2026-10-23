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
- At the source-test checkpoint, packaged behavior was still unverified; the parent subsequently built and ran the signed `cf49` candidate below.
- Parent's signed `cf49` focused packaged run removed the former empty-project branch error. The named-session case's behavior reached deletion, but the strict log audit failed on one expected post-delete read. Its trace shows `DELETE /agent-sessions/9295a4c6-735a-4303-88dd-69e6904ff11f/hard` → 204, then exactly three same-ID GET 404 responses: `?transcriptLimit=50`, `/pending-permissions`, and `/model-provenance`. The first two were already admitted as exact owned-deletion reads; the third was a test-authoring audit gap. No other HTTP error responses appeared in that trace.
- After the audit adjustment, `cd apps/web && npm run typecheck` and `git diff --check -- apps/web/tests/packaged/feature-test.ts docs/ai/runs/2026-10-20-repair-session-branches.md` passed. The parent owns the next packaged rerun; this typecheck does not establish runtime pass.

## Notes

- Root cause: `advancedContextProject?.id ?? selected.projectId` yielded the real empty-string project ID for an unassigned live session, and the effect sent it to `branches(projectId)`. The gateway constructed `/projects//branches`; the rejected response was hidden in the dialog but remained a backend ERROR.
- The GitNexus index available in the original checkout is stale and not present in this worktree. Its disambiguated `SessionRail` upstream impact returned LOW with zero indexed direct callers or affected processes/modules; the rendered tests and parent packaged check are the authoritative behavior evidence.
- No backend, engine, native app, account setting, project record, commit, push or PR was changed in this lane.
- `apps/web/tests/packaged/feature-test.ts` now admits only that additional same-ID `/model-provenance` NOT_FOUND after nonce-owned deletion. The audit also includes Electron main-process lines beginning `Error occurred in handler for `; all other server and handler errors remain unexpected.

- Exact signed local 92af confirmation passed the named unassigned session case twice; final seven-case repair confirmation was 7/7. API/DB/engine persistence and hard deletion passed the strict audit without `/projects//branches`. Full-suite receipt is recorded in the umbrella repair run.
