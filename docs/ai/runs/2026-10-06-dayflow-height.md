---
date: 2026-10-06
repo: Rhythm
branch: integration/2026-10-06-resume
pr: 1604
issues: [1605]
status: pass
tags: [run, rhythm, dayflow]
index: "[[Rhythm]]"
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

## C9 exact-source native acceptance

At C9 `54888e924c5b31cb7700b6eb1f5da7c4c450e930` / apps tree `47f1828030f1b14c2175975e47e72a5796b0cb47`, root verified the signed normal-profile app. Original Dayflow Timeline rendered with no Rhythm outer header/footer and original native controls preserved. Native macOS CUA scrolling at 1280×560 moved down two pages to Copy timeline, Settings and Review cards, then up two pages to Today/Timeline/Daily; global navigation stayed fixed. At tall target 3440×1300 the actual zoomed window was 3440×1296; full bottom content was visible with no outer document movement. The app was left at 1280×800, Timeline top.

Approximate screenshot-only geometry: short purple surface 402px, visual document extent 576px, movement 174px. The public native API does not expose exact NSRect/intrinsic/fitting values, so this is not direct native geometry introspection. Physical-human proof remains unrun. Exact CUA receipt: `codex-dayflow-cascade-c9-build/dayflow-C9-signed-native-CUA-receipt.json`.
