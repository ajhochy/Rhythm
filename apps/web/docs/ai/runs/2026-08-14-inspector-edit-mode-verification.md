---
date: 2026-08-14
repo: rhythm-desktop-agents
branch: unavailable
pr: null
issues: [inspector-edit-mode-verification]
status: partial
tags: [run, rhythm-desktop-agents]
---

# Inspector edit-mode verification

## Acceptance

Initial Phase 0 line: `WAIVED: verification-only request with no planned behavior change; verification is the existing deterministic Playwright suite (npm test) and isolated affected-spec reruns if failures occur.`

The waiver was superseded after the first suite run exposed inspector-related regressions. The first `npm test` run supplied the required failing acceptance evidence (32 failed, 206 passed, 1 skipped). Canonical contract: `docs/ai/contracts/task-inspector-verification.json`.

## Files

- `src/pages/facilities/index.tsx` — made the scrollable readonly room inspector keyboard-focusable.
- `src/pages/rhythms/styles.css` — restored the 44px minimum close-button target.
- `tests/pages/{facilities,integrations,projects,rhythms}.spec.ts` — scoped create-dialog controls, synchronized fixture text, and asserted no redundant Rhythm Edit action.
- `tests/contract/issue-2003-tasks.spec.ts` — scoped the updated heading assertion to the selected inspector.
- `tests/contract/issue-2004-rhythms.spec.ts` — synchronized punctuation expectation.
- `tests/contract/issue-2005-projects.spec.ts` — synchronized responsive fixture punctuation.
- `tests/contract/issue-2007-facilities.spec.ts` — scoped add-space controls, replaced the removed room Edit action expectation, and proved two consecutive reservation saves remain PATCH operations while selected.
- `tests/contract/issue-2008-automations.spec.ts` — scoped builder focus assertions away from the direct editor.
- `tests/contract/issue-2009-integrations.spec.ts` — selected the intended provider before inspector assertions and synchronized responsive fixture text.
- `docs/ai/contracts/task-inspector-verification.json` — executable acceptance mapping.
- `docs/ai/runs/2026-08-14-inspector-edit-mode-verification.md` — this note.

No fixture data or endpoint semantics changed.

## Checks

- `npm test` (initial): build passed; Chromium launched; 206 passed, 32 failed, 1 skipped in 8.0m.
- `npx playwright test tests/pages/facilities.spec.ts tests/pages/rhythms.spec.ts tests/contract/issue-2003-tasks.spec.ts tests/contract/issue-2004-rhythms.spec.ts tests/contract/issue-2007-facilities.spec.ts tests/contract/issue-2008-automations.spec.ts tests/contract/issue-2009-integrations.spec.ts --workers=1`: 82 passed, 5 failed. Three failures were unrelated; two stale inspector expectations were then corrected.
- `npx playwright test tests/pages/planner.spec.ts tests/pages/tasks.spec.ts tests/pages/rhythms.spec.ts tests/pages/projects.spec.ts tests/pages/facilities.spec.ts tests/pages/automations.spec.ts tests/pages/integrations.spec.ts --workers=1` (first): 35 passed, 1 stale Projects fixture expectation failed.
- `npx playwright test tests/contract/issue-2007-facilities.spec.ts --grep "issue-2007-c5|issue-2007-c12" --workers=1 && npx playwright test tests/contract/issue-2009-integrations.spec.ts --grep "issue-2009-c7|issue-2009-c12" --workers=1`: 4 passed, 0 failed.
- `npx playwright test tests/pages/planner.spec.ts tests/pages/tasks.spec.ts tests/pages/rhythms.spec.ts tests/pages/projects.spec.ts tests/pages/facilities.spec.ts tests/pages/automations.spec.ts tests/pages/integrations.spec.ts --workers=1` (final): 36 passed, 0 failed in 1.4m.
- `npm test` (final): build passed; Chromium launched; 227 passed, 11 failed, 1 skipped in 6.6m.
- `npm run test:dist-smoke`: passed; launcher target, index, and 2 relative assets verified.
- GitNexus impact/detect-changes: unavailable for this workspace because it has no Git metadata and is outside the indexed Rhythm worktree.

`RHYTHM_LIVE_E2E` was not enabled. The default Playwright config launched local servers on `127.0.0.1:4173` and `127.0.0.1:4174`; `tests/helpers.ts` aborted every non-loopback request. No live service was contacted.

## Remaining full-suite failures

1. **Stale test expectation** — `issue-2001-c9`: handoff now says “Local preview · no request sent,” not “client-side/fixture handoff.”
2. **Stale test expectation** — `issue-2002-c6`: Planner create UI works in the page suite, but the contract still expects dialog accessible name “Create task.”
3. **Stale test expectation** — `issue-2002-c8`: completion toast now says “Task marked complete.”
4. **Stale test expectation** — `issue-2002-c9`: same obsolete Planner dialog accessible name.
5. **Product regression (unrelated to inspectors)** — `issue-2003-c2`: filtered rows change but `tasks-visible-count` remains `8 tasks` instead of `1 task`.
6. **Stale test expectation** — `issue-2003-c6`: completion toast now says “Task marked complete.”
7. **Stale test expectation** — `issue-2005-c9`: fixture uses `Sunday Service - August 16`, while the contract expects an em dash.
8. **Stale/broken test expectation** — `issue-2006-c13`: dynamically constructed URL regex produces invalid `(?:?|$)`.
9. **Stale test expectation** — `issue-2009-c13`: rendered copy begins with capitalized “Full Google Calendar and Gmail.”
10. **Stale test expectation** — `tests/pages/dashboard.spec.ts`: handoff now says “Local preview · no request sent.”
11. **Product regression (unrelated to inspectors)** — `tests/shell.spec.ts`: the local Studio iframe does not render `connection-status`.

Environment-problem count: 0. The prior MachPortRendezvousServer denial did not recur.

## Notes

All requested inspector behavior, readonly/ownership restrictions, Facilities repeat-PATCH behavior, Automation selected-rule editing, Planning Center direct filters, and responsive/axe coverage passed in the focused runs. The remaining 11 failures are outside the requested inspector scope and were not changed.
