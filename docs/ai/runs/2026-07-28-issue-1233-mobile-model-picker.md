---
date: 2026-07-28
repo: Rhythm
branch: mega/mobile-modelpicker-1233
pr: null
issues: [1233]
status: partial
tags: [run, Rhythm]
---

# Issue #1233 — mobile model picker

## Files

- Added an executable acceptance contract for disconnected-provider filtering,
  provider/account grouping, recent/recommended ranking, and visible context.
- Added connected/default metadata to capability discovery and provider/model
  types.
- Added a pure grouped model-picker selector and connected-only chat filtering.
- Enhanced the existing native select sheet with optional group headings.
- Added a fake-OpenCode Playwright flow for the grouped picker.

## Checks

- `npm run test:contract:1233` — PASS, 4/4 tests.
- Failing-first `npm run test:contract:1233` — expected assertion failure:
  `selectModelPickerGroups` absent before implementation.
- `npm run typecheck` — BLOCKED, `tsc: command not found`.
- `npm run lint` — BLOCKED, `eslint: command not found`.
- `npm run test:provider-utils` — BLOCKED, mobile `typescript` package absent.
- `git diff --check` — PASS.

## Notes

- `gh issue view 1233 --comments` was blocked by sandbox network policy, so the
  contract uses the acceptance criteria supplied in the implementation mission
  and the local mobile functional spec.
- Root `npm install` failed in the api_server postinstall after an npm CLI
  failure/hang. Mobile `npm install` hung under restricted network; offline
  retry failed with `ENOTCACHED` for `@types/yargs-parser`.
- The orchestrator must reinstall dependencies, run static checks, run the
  Playwright flow using isolated ports, and exercise the picker on iOS.
