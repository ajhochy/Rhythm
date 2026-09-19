# Summary

Repaired the two deterministic late-merge regressions behind the rendered-spec spike while preserving #1524's shared resizable panes. The directory-picker page was blank because both standalone `SessionRail` harnesses omitted its newly required project-selection callback; Messages went blank at 640px/200% because pre-`ListInspector` mobile CSS hid the conversation inside the primitive's already-selected inspector pane.

Also repaired the three pre-existing axe failures visible in the retained focused rerun: the dark accent missed AA contrast on warm surfaces (4.45:1), and destructive-button text had 2.35:1 contrast. The adjusted shared tokens calculate to 4.61:1 and 6.28:1. Two failing assertions were scoped to the list/inspector controls they intended to test instead of matching unrelated shell statuses and fixture `<select>` options.

`ListInspector` and `Splitter` were not changed. The separator remains focusable, keyboard-operable, bounded, persistent, and hidden by the existing `<720px` container rule. Available axe output contained color-contrast findings, not separator-role findings.

# Files changed

- `apps/web/src/pages/messages/styles.css` — removed obsolete page-owned mobile pane hiding.
- `apps/web/src/styles.css` — made the dark accent AA-safe and added an accessible destructive-button foreground token.
- `apps/web/tests/directory-picker-harness.tsx` and `apps/web/tests/electron-e21-harness.tsx` — supplied the required `SessionRail` project-selection contract.
- `apps/web/tests/pages/messages-list-inspector.spec.ts` and `apps/web/tests/pages/projects-list-inspector.spec.ts` — scoped ambiguous locators to the shared primitive.
- `docs/ai/project-state.md` and `docs/ai/runs/2026-09-18-web-rendered-spec-root-fix.md` — recorded current state, failure triage, checks, and the pending rendered rerun.
- `REPORT.md` — this handoff.

# Checks run

- Launch discipline — PASS: exact worktree, branch `mega/fix-web-specs-3`, and write probe.
- GitNexus impact — LOW risk: `SessionRail` has three direct callers; `MessagesPage` has one.
- `cd apps/web && npm run typecheck` — PASS.
- `cd apps/web && npm run build` — PASS; 1,695 modules transformed. Existing large-chunk advisory only.
- Focused strict `tsc --noEmit` over `src/main.tsx`, both changed harnesses, and both changed specs — PASS.
- `cd apps/web && npm run test:list` — exit 0; main, rendered-repair, Electron, and session-opening specs compiled/listed. The root config also invoked two pre-discovery issue-1447 probes; sandbox policy blocked their attempted listeners/cache writes with `EPERM`, so those probes were not treated as executed checks.
- `git diff --check` — PASS.
- Rendered Playwright — NOT RUN, per the no-sockets instruction. The orchestrator must rerun the targeted rendered gate.
- No commit, stash, checkout, server, or external dashboard publish was performed.

# Decisions

- Kept `SessionRail`'s production props required and repaired stale harness callers; making the callback optional would hide a real integration error.
- Made the shared `ListInspector` the sole owner of narrow one-pane visibility instead of layering legacy Messages state CSS over it.
- Kept the splitter implementation unchanged because its ARIA/keyboard contract and responsive hiding already match #1524, and retained evidence did not implicate it.
- Updated only assertions that targeted the wrong accessible elements; no behavioral expectation or axe rule was weakened.
- Fixed shared contrast tokens rather than adding page-specific axe exceptions.
- Left rendered qualification pending rather than claiming the 36-test gate green without an allowed browser rerun.
