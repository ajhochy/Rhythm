---
date: 2026-08-20
repo: Rhythm
branch: codex/mega-smoke-suite
pr: null
issues: [mega-smoke-suite]
status: local-build-pass
tags: [run, Rhythm, smoke]
---

# Combined Electron + Flutter local smoke branch

## Composition

- Merged all nine verified PR branches from `origin/main` in dependency order.
- One conflict in `apps/api_server/src/server.ts` was resolved by preserving both independently verified startup blocks: live-artifact missing-content diagnostics and opt-in transcript-share purge startup.
- Every source PR head is an ancestor of the smoke branch. GitNexus compare reported LOW risk and zero affected indexed processes.

## Local debug/dev gate

- 530 tests passed: API 240, web 169, Electron non-packaging 28, Flutter focused 93.
- API typecheck/build passed.
- OpenCode typecheck/local binary build passed.
- Web typecheck/local build passed.
- Electron scoped typecheck and non-packaging tests passed. Full typecheck retains the known 12 unchanged `artifact-policy.mjs` errors.
- Flutter format/analyze/focused tests and `flutter build macos --debug` passed.
- Overlap regressions passed for relay uplink, worktree cleanup, Postgres bootstrap, artifact storage/diagnostics, transcript purge, task sharing, transcript header, and tool permissions.
- Sandbox health: API `ok`, engine `ready`. Protected live PIDs on `4001` and `4096` remained unchanged.

## Local artifacts

- API: `apps/api_server/dist` — 13 MB.
- Web/Electron renderer: `apps/web/dist` — 1.5 MB.
- OpenCode: `apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode` — 103 MB.
- Flutter debug app: `apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app` — 144 MB.

## Gate disposition

- Requested local debug/dev build objective: **PASS**.
- Canonical packaged-runtime gate: intentionally **not run** because AJ explicitly prohibited package/release testing. `npm test` includes tests that invoke `package:mac`, so the generic verification profile returned `BLOCKED` rather than violating that instruction.
- No release workflow, package build, Developer ID signing, notarization, upload, publish, tag, or deploy occurred.

## Manual live smoke

- Electron: launch the dev client only while `4097`/`4098` are free; use production API configuration intentionally and a temporary HOME/userData.
- Flutter: stop the currently running live client first, then open the debug `.app`; it owns/reuses `4001`/`4096` and must not be launched as a competing second instance by automation.
