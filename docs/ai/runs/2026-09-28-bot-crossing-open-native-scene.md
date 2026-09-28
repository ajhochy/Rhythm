---
date: 2026-09-28
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [bot-crossing-open]
status: pushed-automated-pass-manual-smoke-pending
tags: [run, Rhythm]
---

# Bot Crossing native-scene Open (Rhythm, Claude Code, Codex)

## Root cause

The earlier fix (97c0f216) covered the list-mode inspector and the preload hop. The native scene never got that far:

1. `registerColonyView` built the scene channel without passing `runAction`, so a scene `action.run` got `result: undefined`. `validateColonyResponse` rejects that as non-JSON, and the channel was disposed.
2. The pinned worker (`server/embedded-scanner.mjs` `observation()` at 4e6ed18) sets `canOpen:false` on every embedded thread, so the HUD disabled `#btn-open`.
3. `colony-actions` refused `claude-code`, and Codex worked only when a `codex://` handler existed (Codex.app is not installed; only the CLI is).

App-wide link routing (`externalHttpUrl`) is not on this path. Scene actions travel over the private MessagePort.

## Files

- `apps/electron/src/colony-actions.mjs`: a side-effect-free `plan()` shared by `open` and a new `sceneThread()` labeller. Claude uses `claude://claude.ai/epitaxy/local_<uuid>` or `claude://resume?session=<uuid>` through `shell.openExternal`, and only when the handler is registered. Codex uses `codex://threads/<uuid>`, or falls back to `codex resume <uuid>` in Terminal via osascript argv, with the cwd single-quoted.
- `apps/electron/src/colony-view.mjs`: forwards `runAction` and `sceneThread` to the scene channel, and relabels `inventory.page` thread records.
- `apps/electron/src/colony-host.mjs`: passes `sceneThread`.
- `apps/electron/src/main.mjs`: logs a warning (scheme only) when a dropped non-http(s) link or the rate limit stops a link.
- Tests: `test/colony-actions-contract.test.mjs` and `test/colony-native-view-contract.test.mjs`.

## Checks

- `npm test` (apps/electron): 448 pass, 3 skipped, 0 fail.
- `npm run typecheck`: only the pre-existing `main.mjs:772` SAVE_FILE_TYPES error from 760f8deb (research exports), not from this change.
- The new native-view test goes red when the `runAction` forwarding is removed.

## Follow-up (companion repo)

Optional: the `observation()` in bot-crossing `server/embedded-scanner.mjs` could stop forcing `canOpen:false`. It is not needed now, because main relabels records.

Manual smoke is pending. In Bot Crossing, click Open on a Rhythm bot, a Claude bot and a Codex bot.
