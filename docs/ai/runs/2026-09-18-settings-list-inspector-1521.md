---
date: 2026-09-18
repo: Rhythm
branch: mega/ws-1521-main-settings
pr: null
issues: [1521]
status: pending
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Settings list-and-inspector adoption (#1521)

## Files changed

- `apps/web/src/pages/settings/index.tsx` adopts the shared list/inspector, persisted section selection, protected local drafts, permission-aware inspectors, navigation rows, and state feedback.
- `apps/web/src/pages/settings/SettingsPage.css` contains the page-scoped responsive and form/member styling.
- `apps/web/tests/pages/settings-list-inspector.spec.ts` defines the rendered selection, actions, state, responsive, zoom, keyboard, and axe contract.
- `apps/web/tests/electron-e40-harness.tsx` adds deterministic loading/error/empty and logout fixture behavior.
- `apps/web/tests/electron-e40-settings-rendered.spec.ts` selects inspector rows before exercising preserved actions.
- `apps/web/tests/electron-e40-settings.spec.ts` asserts the shared primitive and URL selection adapter remain wired.
- `docs/ai/contracts/issue-1521.json` maps all eight acceptance criteria to the rendered spec.

## Checks run

- `cd apps/web && npm run typecheck` — exit 0.
- `cd apps/web && npm run build` — exit 0; Vite transformed 1,683 modules and produced the production bundle. The existing large-chunk advisory remains non-fatal.
- Focused `tsc --noEmit` over the new/updated Settings spec and harness files — exit 0.
- `git diff --check` plus contract/test-ID and shared-primitive scope checks — exit 0; eight criteria mapped and the shared primitive is unchanged.
- Playwright, axe execution, screenshots, and Electron launch — not run because this worker brief prohibits socket binding, Playwright, Vite dev, and Electron launch.

## Notes

- Keyboard/safety fields now have an explicit local save boundary so changing sections can confirm before discarding unsaved edits; theme remains immediate and device/account scoped.
- Agent Settings, Integrations, Mobile Access, and Memory are navigation-only list rows and do not duplicate their editors.
- The focused test-file compiler initially failed because the fixture logout mock inferred `Promise<number>` from `Array.push`. Failure triage isolated it to the mock; a block body restored `Promise<void>`, and the exact check then exited 0.
- GitNexus impact and change detection were unavailable in this worker (no callable MCP tools and no `.gitnexus/run.cjs` in the worktree); manual callers are the `/settings` route and E40 harness.
- Rendered acceptance remains pending for the orchestrator's browser-capable stage.
