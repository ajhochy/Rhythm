---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-1524-splitter
pr: null
issues: [1524]
status: pending
tags: [run, Rhythm]
---

# Shared resizable panes

## Files

- Added `apps/web/src/components/Splitter.tsx` and `Splitter.css` for persisted pointer and keyboard resizing.
- Replaced the resize handles in `AgentsWorkspace.tsx` and `SessionRail.tsx`.
- Added the shared list/inspector boundary in `ListInspector.tsx` and `ListInspector.css`.
- Added the current Shell navigation/content boundary in `Shell.tsx` and `styles.css`.
- Added Reset layout to main Settings.
- Added `apps/web/tests/splitter.spec.ts` and updated the existing shared keyboard-step assertions.
- Added `docs/ai/ui-contracts/resizable-panes.md` with the rule, storage keys, and route/tool inventory.

## Checks

- `pwd && git rev-parse --abbrev-ref HEAD; echo ok > .write-probe && rm .write-probe` — PASS: exact worktree, branch `mega/ws-1524-splitter`, writable.
- `gitnexus impact <symbol> --direction upstream ...` — PASS for indexed symbols: `AgentsWorkspace`, `SessionRail`, `Shell`, `LiveArtifactsShell`, and `SettingsPage` were LOW risk. `ListInspector` was absent from the stale index.
- `gitnexus analyze .` — FAIL before edits: native worker `Napi::Error`; the existing Rhythm index remained usable for symbol impacts.
- `cd apps/web && git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD && npm run typecheck && npm run build` — PASS on `mega/ws-1524-splitter` at `5cd2eec7`; 1,684 modules transformed, Vite built in 10.22 s. Existing bundle-size warning remained.
- `cd apps/web && npx playwright test tests/splitter.spec.ts --list` — PASS: 6 tests discovered in 1 file.
- `git diff --check` — PASS: no whitespace errors.
- `gitnexus detect-changes --scope unstaged --repo /Users/ajhochhalter/Documents/Rhythm --limit 200` — PASS: 8 indexed files/symbols, 0 affected processes, LOW risk. New untracked splitter files are newer than the index.
- Rendered Playwright and Electron smoke — NOT RUN: the worker brief prohibits socket binding, Playwright execution, Vite, and Electron launch. The orchestrator owns these runs.

## Notes

- `LiveArtifactsShell` has no fixed adjacent preview pane in this branch. The artifact iframe is flex-sized and receives the shared window resize event.
- The current web Shell renders navigation above content, so its actual boundary uses a horizontal splitter while retaining the stable `layout.shell.navigation` key.
- Route-specific fixed layouts outside the exact integration list are recorded as follow-ups in the UI contract rather than edited in this worktree.
