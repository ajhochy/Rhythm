---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
status: open
tags: [follow-up, testing, rhythm]
---

# Broad gate failures after local Hermes Desktop validation

Priority P2. These failures prevent an all-repository verification claim. No mobile or OpenCode source files changed in the Desktop replacement (`git diff 25c5f4b2..6ed3ba03 -- apps/mobile apps/opencode_fork` is empty). Their cause has not been attributed to this change or proven pre-existing by a clean-baseline execution.

## Reproduction and evidence

`ai-workflow checks --level pr` exited1. Full captured gate summary: `/tmp/rhythm-hermes-workflow-pr.log`.

- OpenCode: `cd apps/opencode_fork/packages/opencode && bun test test/session/ src/session/` -> 395passed, 5skipped, 1todo, 1failed. `cancel finalizes interrupted bash tool output through normal truncation` exceeded30000ms. Source `test/session/prompt.test.ts:1563` schedules a bash command, waits for a model/tool event, cancels after150ms and awaits the resulting fiber. Need isolate which awaited stage fails to complete; do not increase the timeout or weaken output assertions.
- Mobile: `cd apps/mobile && npm run test:e2e:web` -> 68passed, 3failed, 1skipped. All three failures wait30000ms for the visible `Open workspace` menu item: workspace VCS save, worktrees/MCP creation, and issue1174 adapter/VCS/project metadata. The captured page shows Chats and its active menu button, but no matching menuitem. Failure contexts are in `apps/mobile/test-results/`. Determine whether menu lifecycle/fixture readiness or product rendering is responsible before changing assertions.

## Required follow-up

Reproduce focused cases on the same branch and on its pre-integration baseline using isolated fixtures; inspect cancellation progress and menu events. Repair the lowest failing layer, preserve behavioral assertions, then rerun the failed suites. The signed Electron Desktop UI/native tests are separate evidence and do not substitute for these gates. No unrelated product edit is included in the Desktop/header change.

## Focused engine reproduction

`bun test test/session/prompt.test.ts -t 'cancel finalizes interrupted bash tool output through normal truncation'` also exited1, but completed in3.54s rather than timing out. At `prompt.test.ts:1601`, expected `tool.state.metadata.truncated` true, received false. This points to cancellation/output timing or truncation behavior, rather than only an undersized suite timeout. Log `/tmp/rhythm-hermes-engine-triage.log`. Root cause and baseline attribution remain open; no vendored engine change or assertion weakening was made.

## Incomplete Desktop C5 qualification

The separate in-scope borrowed-backend probe also remains unresolved. `RHYTHM_LIVE_E2E=1 node --test --test-concurrency=1 apps/electron/test/hermes-desktop-ownership-live.test.mjs` initially passed once, then repeatedly hung during renderer loading. The final version uses the production outer BrowserWindow plus child WebContentsView, actual pinned native host/preload, direct Electron executable and isolated HOME/HERMES_HOME. It still failed after 102.5 seconds at `renderer-load`, before connection or disposal assertions. Log `/tmp/rhythm-hermes-ownership-wcv-final.log`.

Host creation completed; the main-process 25-second phase timer produced no receipt. Root cause is unknown. Sample the exact disposable Electron main process while blocked, then inspect the native stack and the lowest failing boundary before modifying tests or product code. Keep the actual preload endpoint and post-disposal authenticated backend assertions. The final probe group was cleaned up; do not use the user's running candidate for this diagnostic. Owned candidate shutdown and separate Rhythm API/engine reuse have passing evidence, but neither proves borrowed Hermes service disposal or full standalone UI coexistence.
