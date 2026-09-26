## Request

Improve the Facilities UI in the Electron app. AJ requested this follow-up during hands-on review of the mega-branch desktop candidate in #1544.

The specific visual changes have not yet been itemized. Review the running Electron page and record the concrete layout and interaction improvements before implementation. Use Agents → Tasks as the established design reference.

## Current qualification observation

The final native smoke created a marked room successfully, but its option did not appear in the list within five seconds. Exact-marker cleanup succeeded. The cause is not yet established; investigate this alongside the live room workflow without treating the test failure alone as a proven layout defect. Evidence: `docs/ai/runs/2026-09-19-connected-phone-relay.md`.

## Acceptance criteria

- [ ] Review room and reservation browsing, selection, details, and action placement in the actual Electron app; document the proposed improvements with before screenshots.
- [ ] Apply the agreed UI improvements consistently with the shared list-and-inspector pattern from #1515.
- [ ] Keep room and reservation creation, editing, deletion, recurrence/group operations, and conflict/availability feedback usable.
- [ ] Verify keyboard focus, long names, narrow windows, and light/dark appearance; capture after screenshots from Electron.

## Likely files

- `apps/web/src/pages/facilities/index.tsx`
- `apps/web/src/pages/facilities/live.tsx`
- `apps/web/src/pages/facilities/styles.css`
- `apps/web/src/components/ListInspector.tsx`, only if a shared change is needed
- `apps/web/tests/pages/facilities.spec.ts`
- `apps/web/tests/electron-e15-facilities-safety.spec.ts`

## Required evaluation

Exercise the room and reservation workflow in the packaged Electron app using disposable test data. Check both live and fixture rendering, keyboard navigation, responsive layout, and existing Facilities safeguards.

## Related work

Follow-up to #1515 and mega PR #1544. Coordinate with #1509 for reading comfort and #1513 for the shared component contract.

## Safety / out of scope

UI improvements only. Preserve permissions, confirmation dialogs, existing data, and API contracts. No changes to accounts or login, no production migrations, and no deployment are part of this issue.
