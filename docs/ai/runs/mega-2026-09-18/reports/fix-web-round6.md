# Summary

- Repaired the seven rendered web failures and the e20 Electron assertion with one product CSS correction and five focused spec corrections.
- Kept the #1521 Composer shortcut behavior unchanged: the saved chord controls sending and the default remains Enter.
- Did not start servers or browsers; verification stayed within the requested no-socket boundary.

# Files changed

- `apps/web/src/styles.css` — anchor the attachment picker to the inside edge of the Composer control so it remains clickable instead of being clipped beneath the Agents rail.
- `apps/web/tests/splitter.spec.ts` — drag from the center of the separator's visible viewport intersection, avoiding the off-pane diagnostics area on tall Planner and Tasks splitters.
- `apps/web/tests/secondary-tool-paths.spec.ts` — select the migrated Email ListInspector row by its accessible title.
- `apps/web/tests/pages/agent-tools-list-inspector.spec.ts` — return to the list before checking and selecting a narrow-layout row.
- `apps/web/tests/pages/facilities-list-inspector.spec.ts` — scope the empty-state option count to the Facility reservations listbox rather than native form options elsewhere on the page.
- `apps/web/tests/electron-e20-session-ordering.spec.ts` — expect the parent's continuation row to hide with the collapsed child rows and reappear after expansion.
- `REPORT.md` — this report.

# Checks run

- `cd apps/web && ./node_modules/.bin/playwright test --list tests/splitter.spec.ts tests/secondary-tool-paths.spec.ts tests/pages/agent-tools-list-inspector.spec.ts tests/pages/facilities-list-inspector.spec.ts` — passed; 47 tests discovered and compiled.
- `cd apps/web && ./node_modules/.bin/playwright test --config tests/electron-e20-playwright.config.ts --list` — passed; 30 tests discovered and compiled.
- `cd apps/web && node --test tests/settings-behavior-1521.test.mjs` — passed; 2/2 shortcut contract tests.
- `cd apps/web && npm run typecheck && npm run build` — passed; TypeScript completed and Vite built 1,695 modules. The existing large-chunk advisory remained non-fatal.
- `git diff --check` — passed.
- Rendered Playwright tests were not rerun because they require a local server/socket, which this task explicitly prohibited.

# Decisions

- Planner and Tasks already mount bounded, labelled Splitters on the fixture routes. Their failures came from the test dragging at a clamped `y=899`, outside the visibly interactive pane, so the spec helper was corrected instead of changing product mounting or persistence behavior.
- The attachment and mention recovery tests exposed a product layout defect, not a send-key defect: the attachment menu was right-anchored to a left-side button and clipped by the conversation pane. The product CSS was fixed; validation assertions and Composer shortcut logic were preserved.
- The Email secondary path remained present after the ListInspector migration. The obsolete test ID was replaced with the shared accessible row-selection path; endpoint-ledger and inspector assertions were kept.
- Narrow ListInspector mode intentionally shows the selected detail pane first. The Agent Tools spec now uses the visible `Back to list` control before asserting row truncation and selection.
- Facilities correctly rendered an empty reservation list. The failing global `option` locator also counted unrelated native select options, so it was narrowed to the reservation listbox.
- Per #1512 and the orchestrator decision, a parent's continuation row belongs to its child-row group: collapse hides it, expansion restores it. Every other e20 assertion remains intact.
