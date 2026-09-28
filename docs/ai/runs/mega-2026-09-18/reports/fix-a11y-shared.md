# Summary

- Repaired the shared palette at the token boundary. The dark muted, accent, and danger values now clear 4.5:1 on the failing backgrounds from the supplied axe report, and light mode now owns dark-enough semantic success/warning/danger/info values instead of inheriting the dark palette.
- Made `ListInspector` expose one polite, atomic live region without adding another global `role="status"`; visible loading/search/missing copy remains visible, while errors remain alerts.
- Clamped the effective `--list-inspector-list-width` to the measured container width without changing the persisted Splitter preference, keyboard separator behavior, or the existing below-720px one-pane CSS.
- Stabilized narrow/200% zoom setup by waiting for two animation frames after viewport or CSS-zoom changes. The structural accessibility assertion was intentionally retained.

# Files changed

- `apps/web/src/components/ListInspector.tsx` — single live announcer and container-bounded effective list width.
- `apps/web/src/styles.css` — AA-safe dark tokens plus theme-specific light semantic tokens.
- `apps/web/tests/helpers/list-inspector.ts` — deterministic responsive reflow waits; no assertions loosened.
- `REPORT.md` — this handoff.

# Checks run

- Launch discipline: worktree `/Users/ajhochhalter/Documents/Rhythm/.mega-wt/fix-a11y-shared`, branch `mega/fix-a11y-shared`, write probe passed.
- `cd apps/web && npm run typecheck` — exit 0.
- `cd apps/web && npm run build` — exit 0; 1,695 modules transformed. The existing large-chunk advisory remains non-fatal.
- Focused strict `tsc --noEmit` over the changed helper, the primitive spec, and the seven neighboring list/inspector specs — exit 0.
- Deterministic WCAG calculation — exit 0: dark muted 4.72:1, dark accent 4.65:1, dark danger 4.82:1; light accent 4.54:1, success 6.17:1, warning 6.71:1, danger 5.92:1, info 5.56:1 on the warm light surface.
- `git diff --check` and ownership review — exit 0; the tracked diff contains only the three owned implementation/helper files. This required report exists at the worktree root and is intentionally ignored by the repository's local exclude rule.
- GitNexus impact was attempted before symbol edits, but the registered Rhythm index predates `ListInspector`/`Splitter` and returned `UNKNOWN`. Final `detect-changes` could not run because this worktree is not registered; no index artifacts were created outside ownership.
- Rendered Playwright/axe was not rerun: the task prohibits sockets, and direct Chromium launch is blocked by the managed sandbox's macOS Mach-port permission. The supplied list-reporter log and retained page snapshots were used for root-cause evidence. The orchestrator must rerun the rendered gate after integration.

# Decisions

- Kept the Messages structural rule strict. Its two failures are real page markup defects (`div[aria-label]` without a role), not a helper defect.
- Kept compact-row metadata in both the list and inspector. Duplicate visible text such as `VCRC` or a selected multilingual project title is required by the list/inspector contract; tests must scope to the surface they mean instead of removing useful row context.
- Did not modify `Splitter.tsx` or `Splitter.css`: the shared separator already has `role="separator"`, name/orientation/value semantics, keyboard resizing, persistence, and the ListInspector breakpoint still hides it below 720px.
- Preserved `role="alert"` for actual failures, but removed `role="status"` from ordinary ListInspector state copy so the page does not gain another ambiguous global status landmark.
- Per launch discipline, no commit, stash, checkout, server, or socket was created.

# Follow-ups

- Messages owner: in both `apps/web/src/pages/messages/index.tsx` and `live.tsx`, give `.messages-conversation[aria-label]` and `.messages-transcript[aria-label]` `role="region"`. These are the two nodes caught by the retained structural assertion.
- Integrations owner: move `ListInspector` outside the disabled `pg-integrations-mutations` fieldset (or disable only mutation controls). The current disabled ancestor makes read-only rows unselectable even though inspection must remain available.
- ToolWorkspace owner: synchronize `ToolFrame.surfaceState` when the query string changes or remount it by route state. `useState(initialToolState)` only reads the first URL, so sequential loading/error/empty fixture navigation can retain the prior state.
- Spec owners: scope missing/loading assertions to `.list-inspector-detail` or `.list-inspector-state` now that announcements use `aria-live="polite"` without `role="status"`; do not use page-global `getByRole('status')`.
- Settings spec owner: scope `VCRC` to `data-testid="list-inspector-detail"`. Projects spec owner: assert the selected multilingual heading (or selected option) explicitly. Both list and detail copies are intentional.
