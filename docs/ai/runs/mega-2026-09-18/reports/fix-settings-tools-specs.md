# Fix B Report

## Summary

- Repaired the owned Agent Settings, Agent Tools, and main Settings list-inspector specs against the current rendered contracts from issues #1513, #1514, and #1521.
- Kept all behavior assertions intact. The changes correct stale navigation/setup assumptions and scope locators to the inspector that owns the asserted content.
- Added the repo-standard `RHYTHM_LIVE_E2E` gate to the two live-only Agent Settings persistence cases so the default fixture server does not run them in the wrong gateway mode.
- Made no product-source changes. The captured failures were caused by spec setup or locator drift after the accepted wiring changes.
- Left the supplied untracked `apps/web/test-results-detail/` evidence directory untouched.

## Files changed

- `apps/web/tests/pages/agent-settings-list-inspector.spec.ts`
  - Expects the Profiles destination to preserve `settingsSection=profiles`.
  - Gates live account and MCP persistence cases behind `RHYTHM_LIVE_E2E=1` without changing their assertions.
- `apps/web/tests/pages/agent-tools-list-inspector.spec.ts`
  - Scopes the missing-item status assertion to the inspector.
  - Drives loading, error, empty, read-only, and ready states through the visible state selector so React receives an actual state transition.
- `apps/web/tests/pages/settings-list-inspector.spec.ts`
  - Scopes duplicate `VCRC` text to the inspector.
  - Matches the shared primitive's rendered loading copy, `Loading Settings sections…`.
- `REPORT.md`
  - Records this handoff.

## Checks run

- `pwd && git rev-parse --abbrev-ref HEAD` plus reversible write probe — pass; exact worktree and `mega/fix-settings-tools-specs` confirmed.
- GitNexus upstream impact for `FixtureAgentSettingsTool`, `LiveBrainTool`, and `SettingsPage` — LOW risk; three, three, and five upstream dependants respectively.
- `cd apps/web && npx playwright test tests/pages/agent-settings-list-inspector.spec.ts tests/pages/agent-tools-list-inspector.spec.ts tests/pages/settings-list-inspector.spec.ts --list` — pass; 20 tests loaded from 3 files.
- `cd apps/web && ./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --lib ES2022,DOM,DOM.Iterable --types node,@playwright/test --skipLibCheck --esModuleInterop tests/pages/agent-settings-list-inspector.spec.ts tests/pages/agent-tools-list-inspector.spec.ts tests/pages/settings-list-inspector.spec.ts` — pass; no diagnostics.
- `cd apps/web && npm run typecheck && npm run build` — pass; TypeScript exited 0 and Vite built 1,695 modules. The existing large-chunk warning remains informational.
- `git diff --check` — pass.
- Browser execution was not run because this work order forbids sockets. The supplied failing artifacts were used for rendered evidence.
- GitNexus `detect-changes` could not inspect this worktree because only the integration worktree is indexed; its comparison reported no changes for that other checkout and is not counted as evidence for this diff.

## Decisions

- Treat `#/profiles?settingsSection=profiles` as the intended deep link. Preserving selection in the URL satisfies the refresh/deep-link contract; stripping it would regress expected behavior.
- Keep the removed destructive-confirmation checkbox removed. The #1521 spec already asserts that this retired control is absent, matching the #1521 send-key/destructive-confirmation decision.
- Scope ambiguous matches instead of changing product copy or removing assertions. Both `VCRC` renderings are valid, and several application-wide live regions legitimately use `role=status`.
- Exercise Tool state changes through `View state`. Repeated same-route `page.goto` calls changed the hash without remounting `ToolFrame`, so its mount-time state remained stale.
- Gate live persistence tests rather than weakening them. Their account authorization, default restoration, MCP credential, OAuth, and reload assertions are unchanged and run when `RHYTHM_LIVE_E2E=1` launches a live-gateway build.

## Follow-ups

- In the socket-capable integration gate, run the three targeted specs with the default fixture server, then run the Agent Settings live-persistence cases with `RHYTHM_LIVE_E2E=1` and the existing synthetic live-gateway Vite variables.
- Run GitNexus `detect-changes({ scope: "compare", base_ref: "main" })` from an index registered for this exact worktree before any later commit. No commit, stash, checkout, or push was performed here.
- The canonical project-state/run log and Dev Dashboard tracker are outside this worker's strict ownership and writable root; the integrating owner should record this report after the socket-capable gate.
