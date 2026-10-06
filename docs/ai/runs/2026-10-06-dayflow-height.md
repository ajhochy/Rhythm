---
date: 2026-10-06
repo: Rhythm
branch: codex/chat-only-bounded-workflow
pr: 1604
issues: []
status: pending
tags: [run, rhythm, dayflow]
---

## Files

`DayflowTool.tsx` and scoped `ToolWorkspace.css`: the native viewing region uses the remaining vertical space in its finite desktop container. A nonshrinking footer keeps Settings reachable; the existing body scrolls when the window is too short. The native attach/block/bounds/teardown implementation is unchanged.

The browser harness now mirrors the actual shell's finite-height parent. The added contract changes viewport height at fixed width, compares the native facade's last bounds against the current DOM rectangle, and checks Settings reachability in both fitting and overflowing short windows.

## Checks

- GitNexus `impact DayflowTool --direction upstream`: LOW, one direct caller (`ToolWorkspace`), three total affected symbols, no indexed execution processes. Reviewed before the component edit.
- Genuine pre-fix browser RED: nine existing tests passed; new geometry test failed because host height remained 420px at both 560px and 900px viewport heights.
- Dedicated browser command from `apps/web`: `DAYFLOW_VIEW_PORT=48440 PLAYWRIGHT_BROWSERS_PATH=/Users/ajhochhalter/Library/Caches/ms-playwright node_modules/.bin/playwright test tests/dayflow-view.spec.ts tests/sol-dayflow-view-negatives.spec.ts --config /Users/ajhochhalter/Documents/Codex/2026-10-06/chat-bounded-workflow/contract-ui-env/dayflow-view-chromium-1223.config.ts --reporter=list`: exit 0, 16/16 passed.
- At width 1280, host and facade heights matched at 318.5px for viewport height 560 and 658.5px for height 900. Settings was visible at height 480 and reachable by body scrolling at height 300.
- Web `npm run build`: exit 0. Existing bundle-size warning remains.

## Notes

These are dirty-source focused checks. Red/green output, trace and hashes are preserved externally in `chat-bounded-workflow/contract-ui-env/dayflow-view-receipt.md`. Exact committed-source checks and signed normal-profile native height/scrolling acceptance remain pending. The browser facade cannot prove embedded native pixels or native scroll-wheel behavior.
