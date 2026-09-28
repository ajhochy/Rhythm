---
date: 2026-09-18
repo: Rhythm
branch: mega/fix-web-specs-3
pr: null
issues: [1496, 1513, 1514, 1515, 1516, 1517, 1518, 1519, 1521, 1522, 1523, 1524]
status: pending
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Web rendered-spec root fix

## Files

- Repaired the two stale `SessionRail` harness callers after the required project-selection contract was added.
- Removed Messages mobile rules that hid the detail pane after the page adopted the shared `ListInspector` responsive state.
- Restored WCAG AA contrast for the shared dark accent and danger-button foreground.
- Scoped two rendered-spec locators to the shared list/inspector state they actually assert.

## Checks

- `cd apps/web && npm run typecheck` — PASS.
- `cd apps/web && npm run build` — PASS; 1,695 modules transformed. The existing large-chunk advisory remains non-fatal.
- Focused strict `tsc --noEmit` over `src/main.tsx`, both repaired harnesses, and both adjusted specs — PASS.
- `cd apps/web && npm run test:list` — exit 0; the main suite compiled/listed 497 tests in 66 files, the rendered-repair suite listed 15 tests, and the Electron/session-opening slices listed successfully. Before discovery, the root config also ran two issue-1447 contract probes that attempted listeners and dependency-cache writes; the sandbox blocked those side effects with `EPERM`, so they are not counted as executed product checks.
- `git diff --check` — PASS.
- GitNexus impact from the indexed integration tree — LOW risk for `SessionRail` and `MessagesPage`.

## Notes

- Failure triage: the supplied 36-failure log was amplified by host load; retained traces from the focused rerun isolated a `SessionRail` callback exception, stale Messages mobile visibility CSS, two unscoped locators, and the three pre-existing contrast failures. All are repaired in this branch; no follow-up issue was filed.
- The shared `Splitter` remains keyboard-operable and continues to be hidden by `ListInspector` below the 720px one-pane breakpoint; the available axe evidence did not identify the separator as a violation.
- Rendered Playwright execution remains outside this no-sockets worker; the orchestrator must rerun the targeted rendered gate.
