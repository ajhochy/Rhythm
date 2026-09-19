# Summary

Persisted Settings now drives Composer send behavior. The device and account scoped preference accepts two validated values: `Enter` and `Meta+Enter` (shown as `Cmd/Ctrl+Enter`). Composer reads the saved value, submits only on the selected chord, keeps plain Enter as a newline when the modifier chord is selected, and updates its shortcut hint. The preference is re-read for same-window changes, cross-window storage changes, account changes, and reloads.

The destructive-action confirmation checkbox was removed because the web app has no shared destructive confirmation path. Its destructive actions use separate `window.confirm` calls and page-specific `FocusDialog` state, so wiring a subset would leave a misleading global control. Existing confirmations remain intact.

# Files changed

- `apps/web/src/gateway/user-preferences.ts` — added validated local preference values, account-scoped storage helpers, change notification, chord matching, and labels.
- `apps/web/src/pages/settings/index.tsx` — uses the shared helpers, replaces free-form shortcut input with a validated selector, and removes the no-op destructive confirmation control.
- `apps/web/src/components/Composer.tsx` — consumes the saved shortcut for keyboard submission and the rendered hint.
- `apps/web/tests/settings-behavior-1521.test.mjs` — Node tests for validation and exact shortcut matching.
- `apps/web/tests/settings-behavior-1521.spec.ts` — rendered specification for Settings save, reload persistence, plain Enter, Meta+Enter, Control+Enter, and hint behavior.
- `apps/web/tests/electron-e40-settings-rendered.spec.ts` — updated existing rendered persistence coverage.
- `apps/web/tests/pages/settings-list-inspector.spec.ts` — updated existing Settings acceptance coverage for the validated selector and removed control.
- `docs/ai/runs/2026-09-18-fix-settings-behavior.md` — recorded this run and its verification boundary.
- `REPORT.md` — this report.

# Checks run

- Initial contract run: `node --experimental-strip-types --test tests/settings-behavior-1521.test.mjs` — failed before implementation because the preference API did not exist.
- Final Node tests: `node --experimental-strip-types --test tests/settings-behavior-1521.test.mjs` — passed, 2 tests.
- `cd apps/web && npm run typecheck` — passed.
- `cd apps/web && npm run build` — passed; Vite emitted only its large chunk advisory.
- `git diff --check` — passed.
- GitNexus impact analysis — LOW risk for `SettingsPage` and `Composer`.
- GitNexus change detection — LOW risk, 12 indexed symbols, no affected processes. The index is stale relative to this branch, so source call sites were also checked directly.
- Playwright/Electron/Vite runtime checks — not run, as required by the no-socket and no-Playwright constraint. Rendered specs were written for later execution.

# Acceptance criteria

- [x] Saved send key is validated and retains the existing device, account, and localStorage scope.
- [x] `Enter` submits on plain Enter and retains Shift+Enter for a newline.
- [x] `Cmd/Ctrl+Enter` does not submit on plain Enter and submits on Meta+Enter or Control+Enter.
- [x] Composer help text reflects the active shortcut.
- [x] Composer re-reads the preference after save events, storage changes, account changes, and reload.
- [x] Unsupported persisted values fall back to `Enter`.
- [x] The no-op destructive confirmation setting is no longer presented.
- [x] Existing destructive confirmations remain reachable and unchanged.
- [x] Rendered specifications cover save, reload, keyboard behavior, and the removed no-op control.
- [ ] Rendered specifications were not executed because socket binding and Playwright were prohibited for this run.

# Decisions

- Kept the existing `rhythm.settings.<user-id>` localStorage key so persistence scope and existing theme/send values remain compatible.
- Restricted the send preference to `Enter` and `Meta+Enter`; Settings no longer accepts strings that Composer cannot interpret.
- Displayed `Meta+Enter` as `Cmd/Ctrl+Enter` and accepted either Meta or Control so the same saved value works on macOS and other platforms.
- Removed `dangerousConfirm` from the validated stored shape and UI. A partial implementation would still leave most destructive dialogs ignoring the setting.
- Preserved every existing action-specific destructive confirmation.
- Added a same-window preference event plus the browser `storage` listener so consumers react without relying only on remounts.
- Did not commit, stash, checkout, start a server, bind a socket, or run Playwright/Electron.

# Follow-ups

- Run `npx playwright test tests/settings-behavior-1521.spec.ts tests/electron-e40-settings-rendered.spec.ts tests/pages/settings-list-inspector.spec.ts` in an environment where the configured Vite test server may bind its socket.
- Perform the normal Electron manual smoke before merge; this run qualifies source, TypeScript, the production web build, and pure keyboard matching only.
