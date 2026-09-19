---
date: 2026-09-18
repo: Rhythm
branch: mega/fix-settings-behavior
pr: null
issues: [1521]
status: static-pass-rendered-unrun
tags: [run, rhythm]
---

# Issue #1521 settings behavior review fix

## Files

- `apps/web/src/gateway/user-preferences.ts` centralizes validated device preference values and keyboard matching.
- `apps/web/src/pages/settings/index.tsx` uses the shared preference helpers and removes the no-op destructive confirmation control.
- `apps/web/src/components/Composer.tsx` consumes the saved send shortcut and renders its current hint.
- `apps/web/tests/settings-behavior-1521.test.mjs` covers validation and chord matching with `node:test`.
- `apps/web/tests/settings-behavior-1521.spec.ts` renders the save, reload, plain Enter, Meta+Enter, and Control+Enter behavior.
- Existing Settings rendered specs now use the validated shortcut selector and assert the no-op control is absent.

## Checks

- `node --experimental-strip-types --test tests/settings-behavior-1521.test.mjs` — 2 tests passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; Vite reported its large chunk advisory.
- `git diff --check` — passed.
- `gitnexus detect-changes -r /Users/ajhochhalter/Documents/Rhythm --scope unstaged --limit 100` — LOW risk, 12 indexed symbols, no affected processes. The index reports an August 26 snapshot and is stale relative to this branch.
- Rendered Playwright specs were written but not run because this task explicitly prohibited socket binding and Playwright execution.

## Notes

- Supported send shortcuts are `Enter` and `Meta+Enter`, displayed as `Cmd/Ctrl+Enter`; the latter accepts either platform modifier.
- The persisted `dangerousConfirm` checkbox was removed. Web destructive actions do not share a confirmation service, so a global switch could not truthfully control all of them with a small scoped change. Existing action-specific confirmations remain in place.
- No commit, stash, checkout, server, Electron, Vite dev server, or Playwright run was performed.
