---
date: 2026-08-13
repo: Rhythm
branch: codex/ios-submit-app-id
pr: null
issues: [1175, 1380]
status: verified-config-awaiting-submit
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `apps/mobile/eas.json` — restored `submit.production.ios.ascAppId` to `6796011479`, the existing
  Rhythm Agents App Store Connect record used by the successful build 5 submission.
- `apps/mobile/tests/app-config.test.mjs` — added a regression assertion for that exact submit target.
- `docs/ai/project-state.md` — updated the release snapshot and remaining submission steps.

## Checks run

- `npm run lint` — PASS, zero errors and three pre-existing warnings.
- `npm run typecheck` — PASS.
- `npm run test:app-config` — PASS (`app config tests passed`).
- `ai-workflow checks --level issue` — PASS: Flutter analyze/format; API and MCP typechecks.
- `ai-workflow checks --level pr` — PASS after environment recovery: Flutter tests; API lint, serial
  tests, build; MCP tests/build; opencode fork typecheck/session tests; mobile static/contracts,
  fake-server self-test, and web E2E 71/71.

## Notes

- Source of truth: issue #1175 records successful submission of build 5 after commit `8f815d05`
  pinned `ascAppId: 6796011479`; EAS used hosted ASC API key `9XHDX3ZN44`.
- Xcode contains bundle identifier `org.visaliacrc.rhythm.agents` and team ID `56Q69NYP9H`; neither is
  the numeric App Store Connect Apple ID. The historical successful submission supplied that value.
- First verification attempt failed only because the isolated worktree lacked package-local fork
  dependencies and an eight-hour-old orphan fake server occupied port 44096; Flutter also needed
  shared SDK-cache access outside the workspace sandbox. Linking existing dependencies, stopping only
  the orphan process, and granting documented local cache/port access resolved the environment. No
  product code repair or follow-up issue was required.
- No UI, API, backend behavior, Terminal work, Gallery redesign, production data, or credentials changed.
