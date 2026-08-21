---
date: 2026-08-20
repo: Rhythm
branch: codex/mega-smoke-suite
pr: null
issues: [mega-smoke-suite]
status: manual-smoke-partial
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

## Manual live smoke execution — 2026-08-21

### Electron dev client

- Launched sequentially after the Flutter client was stopped, with disposable `HOME` and `RHYTHM_SHELL_USER_DATA`, local API/engine ports `4098`/`4097`, and CDP `9227`.
- Local `/health`, `/opencode/health`, and CDP readiness all passed. The frozen preload bridge reported version `5`, local API/engine bases, the configured production API base, and a ready agent server.
- Production Server URL persistence passed: the isolated `server-config.json` retained `https://api.vcrcapps.com` with mode `0600`, while local agent endpoints remained unchanged.
- The actual Electron shell smoke reached `rhythm://app/index.html#/agents` with no renderer console errors. Evidence: `docs/ai/runs/evidence/mega-smoke-2026-08-20/electron-0-startup.png`.
- Google OAuth completed interactively and the signed-in Electron workspace rendered. The first callback attempts hung after local success because the main process used Chromium `net.fetch` for the production token exchange; switching only that exchange to Node `fetch` completed the same real flow.
- Post-login read-only navigation reached Dashboard, Planner, Tasks, Rhythms, Projects, and Messages. Direct renderer reads were blocked because production does not return CORS headers for `rhythm://app`. A Playwright-only GET proxy forwarded the existing authenticated requests without logging tokens or bodies and proved every tested production endpoint returned `500` with structured `INTERNAL_ERROR`; no production-data view passed.
- The Electron-spawned local API and Opencode engine initially had the same renderer-origin omission. Their exact allowlists were repaired, and a fresh launch proved renderer-origin API `200` and engine `200`, both with CORS response type and no wildcard.

### Flutter macOS debug client

- Quit the installed/client process first, verified `4001`/`4002`/`4096` were free, then launched only `build/macos/Build/Products/Debug/Rhythm.app`.
- Local API and OpenCode health passed. Native CUA navigation exercised Dashboard, Tasks, Rhythms, Projects, Messages, Facilities, and Agents against the live signed-in workspace. Observed live receipts included `351` tasks, `33` rhythms, `2` facilities, an honest empty active-project state, and the existing Messages empty/selection state.
- Created one clearly disposable agent session, sent a no-tool prompt, and received the exact response marker `RHYTHM_MEGA_SMOKE_OK`. Both disposable smoke sessions were hard-deleted by exact ID and verified absent.
- Quit the debug client cleanly; `4001`, `4002`, `4096`, `4097`, `4098`, `9227`, and `9229` were all free afterward.
- macOS Screen Recording permission was unavailable, so Flutter screenshot files could not be produced. AX/SOM captures and logs were collected instead; this is an evidence limitation, not a claimed visual pass.

### Smoke-discovered repairs

- Electron isolated-home Keychain access now scopes the real-home override to the `security` subprocess only and has a side-effect-free environment regression test. Real login-Keychain signer contracts require the explicit `RHYTHM_KEYCHAIN_INTEGRATION_TEST=1` opt-in and are skipped by the canonical unit suite.
- Electron preload reads the validated persisted production API base from main over sender-checked IPC; local dev can supply the public Google desktop client ID at runtime.
- Electron Google token exchange now uses Node `fetch` rather than Chromium `net.fetch`, avoiding the observed macOS trust-store hang after a successful callback.
- Electron owns `RHYTHM_LOCAL_RENDERER_ORIGINS=rhythm://app` for the API subprocess, and the vendored Opencode SDK forwards that exact allowlist through supported repeated `--cors` arguments to the engine.
- The Electron package script copies the newly imported runtime-config module; the source contract was proven by a RED→GREEN static regression. The later unintended aggregate package-contract invocation is recorded in Final local gates.
- Flutter development launch executes the resolved `npx` script through the ABI-selected Node executable, avoiding native-module ABI drift.
- API startup launches the disposable memory-index rebuild best-effort instead of awaiting it before HTTP readiness, serializes mirror sync behind that owner, and bounds the read-only scan at 30 seconds so a stalled TCC/iCloud read cannot disable sync for the process lifetime.
- `RHYTHM_LOCAL_SMOKE=1` now disables both scheduled-agent execution and the relay uplink. A verification launch exposed one unintended morning-briefing catch-up before this gate existed; its exact session/run rows were removed and the task's pre-smoke scheduling fields were restored.
- Web verification now runs the five live-rendered Bucket A tests under their dedicated fixture/live servers, while fixture skill receipts remain explicitly `fixture://`. Canonical screenshots use Playwright's transient output path; tracked evidence capture is opt-in.

### Final local gates

- API: TypeScript build passed; final targeted set `122/122`, including startup-memory, local-smoke scheduler safety, relay, worktree, artifact, transcript-purge, task-sharing, and permission contracts.
- OpenCode: arm64 binary remains `0.0.0-codex/mega-smoke-suite-202608210514` (`103 MB`).
- Web: main Playwright suite `260` passed / `4` skipped, then dedicated Bucket A rendered suite `5/5` passed.
- Electron: repaired default non-packaging `npm test` passed `31` / `3` explicit Keychain-integration skips; focused OAuth/API-origin gate `23/23` passed. Package-shaped contracts now require explicit `npm run test:package`.
- API/engine CORS repair: TypeScript build passed; focused Opencode service suite `59/59`; disposable SDK launch returned engine health `200` with exact `Access-Control-Allow-Origin: rhythm://app`.
- The aggregate Electron `npm test` was stopped after it unexpectedly entered the unsigned-package contract. The local ignored bundle was already absent after cleanup and tracked smoke images were restored. No Developer ID signing, notarization, upload, or release action ran.
- Flutter: format `0` changes; focused environment suite `16/16`; analyze exited `0` with the existing non-fatal info baseline; debug app rebuilt successfully (`144 MB`).
- Final Flutter live launch: API `status=ok`; OpenCode `status=ready`, `bridgeLive=true`; logs confirmed the scheduler and relay uplink were both disabled for local smoke before clean shutdown.
- Added-line secret/injection scan and `git diff --check` passed.

### Disposition

- Combined local debug smoke: **PARTIAL PASS**.
- Merge readiness: **NOT YET READY**. Electron OAuth and both local renderer gateways now pass, but the production desktop origin lacks CORS and every authenticated read tested across the six post-login views returns `500 INTERNAL_ERROR`. Flutter functionality passed, but native screenshot evidence remains unavailable until Screen Recording permission is granted.
- Production was used only for deliberate reads and one no-tool disposable agent turn. One unintended unsigned local package-contract invocation occurred and was stopped/cleaned; no signing, notarization, upload, release, deploy, merge, tag, purge-enable, Synology recovery, or destructive production action occurred.
- PR `#1425` remains intentionally deferred and is not represented as shipped.
