# Summary

Implemented the nine-file repair set targeting all 19 deterministic rendered-spec failures from `.orchestrator/gate-web-failing-detail-2.log`:

- Removed the duplicate hidden ListInspector announcement and made the single visible loading, empty, no-results, and missing-item states accessible live/status regions.
- Restored multi-word tool searches with token-wise AND matching.
- Corrected Profiles bulk-action accessible names and kept the read-only editor's scroll region focusable while disabling its editing controls.
- Kept Composer shortcut guidance visible at narrow conversation widths and made the settings behavior harness explicitly use its fixture gateway.
- Made the Settings fixture return persisted Facilities Manager changes.
- Replaced the inaccurate canvas approximation of CSS `72ch` and kept splitter drag origins inside the viewport.

The product build and all requested no-socket static checks pass. The 19 rendered Playwright cases were not rerun because their configured web servers require sockets, which this round explicitly forbids.

# Files changed

- `apps/web/src/components/ListInspector.tsx`
- `apps/web/src/components/Profiles.tsx`
- `apps/web/src/components/Profiles.css`
- `apps/web/src/styles.css`
- `apps/web/tests/electron-e22-harness.tsx`
- `apps/web/tests/electron-e40-harness.tsx`
- `apps/web/tests/reading-comfort-1509.spec.ts`
- `apps/web/tests/settings-behavior-1521.spec.ts`
- `apps/web/tests/splitter.spec.ts`
- `REPORT.md`

The pre-existing untracked `apps/web/test-results-detail2/` evidence directory was not modified.

# Checks run

- Launch discipline: exact worktree confirmed; branch `mega/fix-web-round5` confirmed; write probe passed and its probe file was removed.
- GitNexus impact review: `ListInspector` was CRITICAL impact; `Profiles` and `CapabilityGroup` were LOW impact. The shared fix was kept inside the existing component contracts; no Splitter product symbol was changed.
- `cd apps/web && npm run typecheck` — passed, exit 0.
- `cd apps/web && npm run build` — passed, exit 0; only the existing Vite chunk-size warning was emitted.
- Focused `tsc --noEmit` over the five changed spec/harness files, with a temporary ambient declaration matching the normal project graph — passed, exit 0. The temporary declaration was removed.
- `cd apps/web && npx playwright test tests/reading-comfort-1509.spec.ts tests/settings-behavior-1521.spec.ts tests/splitter.spec.ts --list` — passed; 48 tests collected from three changed specs without starting a server.
- `cd apps/web && node --test tests/settings-behavior-1521.test.mjs` — passed, 2/2.
- `git diff --check` — passed.
- Rendered Playwright execution — not run because its configured web servers require prohibited sockets.
- Dev Dashboard publication — not run because it is outside this worktree and this round prohibits sockets/external publication.

# Decisions

- Kept one source of truth for ListInspector state text: the visible state element now performs the live announcement, so strict text locators see only one node.
- Used token-wise AND matching for ListInspector search. This preserves exact one-term behavior while allowing expected searches such as `handoff owner` to match text with intervening words.
- Replaced hidden suffixes in Profiles bulk buttons with explicit `aria-label` values. The expected accessible names are unchanged; only the browser whitespace ambiguity is removed.
- Moved the disabled boundary inside the Profiles scroll region. Read-only controls and immediate actions remain disabled, while the named scrollable region stays keyboard-focusable and axe-compliant.
- Removed the narrow-container rule that visually hid Composer's active shortcut. The saved per-user preference key and Composer consumer remain unchanged.
- Made the E22 behavior harness opt into fixture mode only when requested; its default remains live. This keeps the no-socket behavior test deterministic without changing its send/reload assertions.
- Made E40's successful fixture mutation update the member readback, matching the real gateway's controlled-input persistence contract.
- Changed the reading-width spec to measure an actual browser `72ch` element. The bounded-width threshold and expected product width were not loosened.
- Clamped splitter pointer coordinates into the viewport. ARIA bounds, resize delta, persistence, and reload assertions were not loosened.
- No product expectation was removed or weakened, and no commit, stash, checkout, socket, server, or user evidence mutation was performed.
