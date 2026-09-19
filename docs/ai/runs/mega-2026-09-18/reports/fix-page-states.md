# Summary

- Repaired the owned page state, narrow layout, and accessibility failures without changing shared `ListInspector`, `Splitter`, or global styles.
- Kept Integrations rows selectable in read-only mode while preserving native disabled semantics for every selected inspector mutation.
- Added valid Messages conversation/transcript roles, a unique Hermes host landmark name, and an alert role for the Projects server-error state.
- Strengthened page-scoped Facilities, Integrations, and Automations contrast, and corrected three stale or ambiguous Playwright locators/setup paths without weakening expected behavior.

# Files changed

- `apps/web/src/pages/automations/styles.css` — strengthened server-error text contrast.
- `apps/web/src/pages/facilities/styles.css` — strengthened availability-detail contrast.
- `apps/web/src/pages/hermes/index.tsx` — made the embedded Hermes landmark name unique.
- `apps/web/src/pages/integrations/index.tsx` — moved the read-only mutation boundary into the inspector so list selection remains available.
- `apps/web/src/pages/integrations/styles.css` — strengthened OAuth handoff badge contrast.
- `apps/web/src/pages/messages/index.tsx` — added fixture conversation region and transcript log semantics.
- `apps/web/src/pages/messages/live.tsx` — kept live conversation semantics aligned with fixture mode.
- `apps/web/src/pages/projects/index.tsx` — exposed the server-error state as an alert.
- `apps/web/tests/pages/facilities-list-inspector.spec.ts` — scoped loading status and waited for the one-pane Back to list transition.
- `apps/web/tests/pages/messages.spec.ts` — returned to the narrow list pane before invoking its New conversation action.
- `apps/web/tests/pages/projects.spec.ts` — scoped the multilingual title assertion to the visible inspector heading.
- `REPORT.md` — recorded this run.

# Checks run

- Required launch preflight: `pwd`, `git rev-parse --abbrev-ref HEAD`, and write probe — exit 0 at the requested worktree on `mega/fix-page-states`, HEAD `0e7b933174b2`.
- `cd apps/web && npm run typecheck && npm run build` — exit 0; Vite transformed 1,695 modules and produced the production bundle. The existing large-chunk warning remains informational.
- `cd apps/web && ./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --lib ES2022,DOM,DOM.Iterable --types node,@playwright/test --skipLibCheck --esModuleInterop <11 owned page specs> tests/contract/issue-2009-integrations.spec.ts` — exit 0 with no diagnostics; the page spec list is the same explicit list in the next command.
- `cd apps/web && npx playwright test tests/pages/{automations-list-inspector,automations,facilities-list-inspector,facilities,hermes,integrations-list-inspector,integrations,messages-list-inspector,messages,projects-list-inspector,projects}.spec.ts --list` — exit 0; 65 tests discovered in 11 files without launching configured web servers.
- `git diff --check` — exit 0.
- Contrast calculation against the failing dark-theme backgrounds: Facilities 5.86:1, Integrations 4.62:1, Automations 4.80:1.
- GitNexus impact before edits: Facilities, Messages, Projects, and Integrations were LOW risk; `HermesHost` was HIGH because it reaches HermesPage, App, and renderer entry, so its edit was limited to the landmark label.
- `gitnexus detect-changes --scope compare --base-ref main` — exit 0; the existing mega branch comparison is medium risk across 322 files and 3 flows.
- `gitnexus detect-changes --scope unstaged` — exit 0; 11 owned files, 5 expected page symbols, one affected Integrations flow, medium risk.
- Rendered Playwright/Axe execution was not run because the task prohibits sockets and the configured Playwright project binds Vite and dist servers. No assertion was loosened to replace that evidence.

# Decisions

- Treated the original issue acceptance criteria as authoritative: read-only pages remain inspectable, mutations remain disabled, narrow layouts retain their Back to list path, and accessibility assertions remain intact.
- Moved only the Integrations mutation fieldset; the shared list stays interactive and the existing `integrations-mutations` disabled contract remains on the selected inspector controls.
- Used semantic roles for Messages rather than deleting accessible names, and renamed only the nested Hermes landmark to resolve duplicate-region naming.
- Used page-scoped foreground adjustments that exceed the 4.5:1 threshold on the recorded failures.
- Limited test edits to specific locators and interaction order that match the rendered one-pane contract.
- Did not edit shared components, global styles, project docs, or files outside ownership. Did not commit, stash, checkout, start servers, bind sockets, or publish the Dev Dashboard tracker.
