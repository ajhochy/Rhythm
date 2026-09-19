---
date: 2026-09-18
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1174]
status: partial
tags: [run, Rhythm]
---

# #1174 isolated mobile parity rerun

## Files

- No source files changed. `apps/mobile/playwright.config.mjs` starts a fake OpenCode fixture on port 44096 and local Expo web on port 19006; both ports were free before this run. No API server or installed app service was started.

## Checks

- `cd apps/mobile && env -u RHYTHM_LIVE_TOKEN -u CI npx playwright test tests/e2e/issue-1174-parity.spec.mjs --config playwright.config.mjs --workers=1` → exit 1; 3 passed, 1 failed in 1.6 minutes. The terminal detail and resize case timed out at `tests/e2e/issue-1174-parity.spec.mjs:23` waiting for the **Open terminal** menu item after clicking **Chats menu**. Its failure snapshot showed the Chats screen without menu items.
- `cd apps/mobile && env -u RHYTHM_LIVE_TOKEN -u CI npx playwright test tests/e2e/issue-1174-parity.spec.mjs --config playwright.config.mjs --workers=1 --grep 'terminal detail and resize'` → exit 0; the same terminal case passed 1/1 in 43.7 seconds (test duration 2.6 seconds).

## Decisions

- The earlier mega gate was 70 passed, 1 skipped, 1 failed on #1174, followed by standalone 4/4 passes on both baseline and branch as recorded in `docs/ai/runs/mega-2026-09-18/gates.md`. This run reproduced an intermittent menu-opening timeout once, then the exact case passed without a source change. Classify the earlier failure as a test flake rather than a deterministic branch regression. The cause of the intermittent timeout was not established; the full standalone spec did not pass on this rerun.
