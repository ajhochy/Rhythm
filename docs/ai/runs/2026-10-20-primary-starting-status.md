---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, rhythm, web, coordinator, coverage]
index: "[[Rhythm]]"
---

# Inert primary root header showed Starting after coordinator Ready

## Files

- `apps/web/src/components/AgentsWorkspace.tsx`: extend the existing exact-primary Ready/Opening header projection to the inert metadata root's durable `starting` status. The existing actor, root, SDK-less, connection, and coordinator-phase predicates remain unchanged.
- `apps/web/tests/rhythm-primary-entry.spec.ts`: cover a normal starting root, ordinary starting, SDK-backed ordinary error, and status 503 → 200 recovery.
- `apps/web/tests/rhythm-primary-entry.test.mjs`: cover Opening → Ready for both prior error and inert starting rows, plus offline-root fallback.

## Checks

- Exact signed local package `2b8c0a8ed042`: the private synthetic root detail GET returned `status=starting`, `sdkSessionId=null`, owner 1. The initial and post-restore coordinator status responses returned 200, schema 4, the same primary root/project, and revision 1. The missing-cwd status returned 503. After restore, the native observer timed out waiting for the Ready entry notice; its terminal DOM showed selected Rhythm Coordinator, header Starting, stale failure notice, and enabled composer. Private trace: `/private/tmp/rhythm-ai-next-coverage-recon/output/missing-cwd-recon--P0-priv-30cf8-al-journal-or-ordinary-chat/trace.zip`; log: `/private/tmp/rhythm-private-2b8c0a8ed0-settled-coverage-recon.log`.
- Before the header change, `npm run build:guard -- ./apps/web/node_modules/.bin/playwright test --config /private/tmp/rhythm-primary-entry-existing-vite-20261020.config.mjs --grep 'starting metadata'` failed 2/2: both rendered cases kept the Starting header after the fixture's authoritative coordinator status. The fixture's recovery notice itself passed; it did not reproduce the native stale-notice path.
- After the change, `npm run build:guard -- ./apps/web/node_modules/.bin/playwright test --config /private/tmp/rhythm-primary-entry-existing-vite-20261020.config.mjs` passed 10/10 against a standalone guarded Vite fixture on port 4194. `npm run build:guard -- node --test apps/web/tests/rhythm-primary-entry.test.mjs` passed 13/13. `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.app.json --noEmit` and `git diff --check` passed.
- GitNexus upstream impact for `AgentsWorkspace` reported LOW and zero indexed callers/processes, but its index was 311 commits behind this worktree; the local `presentation` binding was unindexed. Manual blast is HIGH because the selected-chat header spans ordinary, SDK-backed, offline, and coordinator paths. The change retains the narrow existing exact-primary gates.

## Notes

This is rendered source coverage, not a native green result for the new bytes. The native stale failure notice after restored status remains a separate unresolved lifecycle/race observation. No notice logic or backend contract was changed here.
