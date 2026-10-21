---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, rhythm, coordinator, playwright]
---

# Completed primary open was overwritten by an older catalog continuation

## Files

- `apps/web/src/components/AgentsWorkspace.tsx`: capture the exact pending primary handoff before awaiting catalog reads; after the await, stop if that handoff was already completed or replaced. Preserve a completed exact-root Ready state and avoid dereferencing the cleared request. Existing actor, gateway, generation and selection fences remain.
- `apps/web/tests/rhythm-primary-entry.test.mjs`: deterministic ordering regression with a successful delayed catalog response after the selected root's scoped open has completed.

## Checks

- Exact local signed `6101edfc0c1711c5c9296896019fa2ca82a92e27` broad native selection: **57 passed, 3 failed**, 0 skips/flaky, 266.923s, exit1. Log `/private/tmp/rhythm-private-6101-broad-native-confirm-20261020.log`; full JSON and failure artifacts `/private/tmp/rhythm-private-6101-broad-failure-evidence-20261020/`.
- Primary missing-workspace case is a genuine product failure: restore reused the same inode; resolve/open/status/history all returned 200 for the same root/revision, header Ready, but entry notice remained could-not-open throughout the 10-second assertion. Dedicated trace copy `/private/tmp/rhythm-primary-stale-6101-c4vi26b7/`.
- The other two broad failures were test bugs, not additional product repairs: ambiguous Cron selector and a Skills catalog response from an old document. Their repairs retain real full-page reload and real API/engine assertions. Focused timing passed all five types, but exposed late history reads during API cleanup; cleanup now unmounts and drains those reads before deletion. These test repairs require a new independent native run.
- Component RED: `npm run build:guard -- node --test --test-name-pattern='completed primary open stays Ready' apps/web/tests/rhythm-primary-entry.test.mjs` — 0/1, expected Ready but observed stale failure after the successful delayed catalog completion. Earlier rejected-catalog diagnostic was superseded; the final regression does not invent a catalog rejection.
- After identity guard: `npm run build:guard -- /bin/sh -c 'node --test apps/web/tests/rhythm-primary-entry.test.mjs && ./apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.app.json --noEmit'` — 14/14, TypeScript exit0. Log `/private/tmp/rhythm-primary-late-catalog-identity-green-20261020.log`.
- Fresh local rebuilt native Confirm remains pending; this note does not report overall qualification complete.

## Notes

`navigateRhythmRoot` installs a pending ref and awaits catalog reads. Those reads can trigger rendering while the intended root is already selected. The scoped open can complete, publish Ready and clear that ref before the earlier await finishes. The older continuation then attempted to write `selectionRequested` through null; its outer catch replaced Ready with the failure notice. This is distinct from the earlier starting-header projection fix.

GitNexus upstream impact for `navigateRhythmRoot` and `AgentsWorkspace`: LOW, 0 indexed direct callers/processes; index 316 commits stale. Manual risk is HIGH because this is shared chat navigation. The production diff is limited to request identity ownership across the existing await; no backend, journal, routing, ordinary session mutation or prompt dispatch changes. Staged detect_changes and surrounding selection/rendered checks are required before commit.

Rendered follow-up: `npm run build:guard -- ./apps/web/node_modules/.bin/playwright test --config /private/tmp/rhythm-primary-entry-existing-vite-20261020.config.mjs` against a guarded standalone Vite on4194 — **11/11**,1.1m; focused new case1/1,8.2s. The new case holds the second entry's real fixture account-catalog GET, allows a model-catalog update to render the already-selected root, proves scoped open/status/history Ready before releasing the successful catalog, then checks Ready, exact root/ordinary navigation and zero SDK/message dispatch. Vite stopped. These are browser-fixture checks; native GREEN still requires a rebuilt bundle.
