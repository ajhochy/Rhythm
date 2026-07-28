---
date: 2026-07-27
repo: rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1175, 1197, 1198, 1199, 1200]
status: local_verified
tags: [run, rhythm, mobile, smoke]
index: "[[Rhythm]]"
---

# Live desktop and mobile smoke handoff

## Files

- `apps/api_server/src/services/mobile_pairing_service.ts` now advertises the
  generated shipping contract fingerprint; its focused unit test was updated.
- `apps/mobile/contracts/rhythm-opencode-classifications.json` now records the
  same generated source fingerprint.
- Cross-package static and live gateway regressions were added under
  `apps/mobile/tests/` and `apps/api_server/src/__tests__/`.
- `apps/mobile/package.json` runs the static drift guard in the mobile CI suite;
  `docs/ai/contracts/issue-1175.json` records criterion `issue-1175-c32`.
- Local signing credentials, device identifiers, private tailnet hostnames,
  pairing codes, and build artifacts remain outside the repository.

## Checks

- Built and launched the PR macOS desktop app from the mobile worktree.
- Verified the PR desktop app started the live local API on `127.0.0.1:4001`,
  the patched local engine on `127.0.0.1:4096`, and the restricted mobile
  gateway on `127.0.0.1:4002`.
- Pointed the existing private Tailscale Serve route only at the restricted
  `:4002` listener. The broad local API and engine were not exposed, Funnel
  remained disabled, and the hosted production API was not changed.
- Confirmed the installed desktop release predates the mobile-gateway UI and
  cannot present the PR pairing control.
- Confirmed the iPhone app accepts direct `rhythmagents:///pair` links, so a
  one-time pairing payload can be delivered without a QR scan.
- Confirmed cold-launch delivery can race account restoration: the pairing
  screen initially reported that sign-in was required even though the restored
  account appeared signed in after launch.
- Retried the direct link with the authenticated app running. The request
  reached compatibility preflight and failed before issuing a device token.
- Desktop Computer Control smoke passed Dashboard, Tasks, Projects, Agents,
  a selected transcript, Settings, the ready Agent Server card, and the
  pre-code Mobile Access dialog. No agent prompt or pairing code was created.
- The iOS simulator development scheme built and launched after passing
  `NODE_ENV=development` and `EXPO_APP_VARIANT=development` as Xcode build
  settings. Agents, Tools, Settings, signed-out pairing guidance, light mode,
  dark mode, and accessibility-large text were visually inspected.
- The pairing compatibility contract was run red before implementation and
  green afterward:
  `cd apps/mobile && npm run test:pairing-compatibility` (1/1).
- Focused checks passed:
  `npm run contract:check && npm run test:contract &&
  npm run test:pairing-compatibility`, and
  `npx vitest run src/services/__tests__/mobile_pairing_service.test.ts`
  (10/10).
- Repository checks passed:
  `ai-workflow checks --level issue` and
  `ai-workflow checks --level pr`, including Flutter tests, API/MCP tests and
  builds, vendored-engine type/session tests, mobile static/contract/fake
  server checks, and mobile web E2E.
- A freshly built isolated sandbox ran on API `4598`, engine `4597`, and
  restricted gateway `4599`. The exact live command
  `RHYTHM_LIVE_E2E=1
  RHYTHM_LIVE_MOBILE_GATEWAY_URL=http://127.0.0.1:4599 npx vitest run
  src/__tests__/issue_1175_pairing_compatibility_live.test.ts` passed 1/1.
  API, engine, capabilities, and gateway health probes all returned HTTP 200;
  the sandbox was then removed and installed ports were untouched.

## Notes

- The compatibility failure is deterministic. The mobile client pins contract
  fingerprint
  `b14b624fc7a4221e27907ecfa7682837bbf7f6286d697e61a7239b244f464af1`,
  matching `apps/mobile/contracts/rhythm-opencode-contract.json`. The local
  gateway advertises
  `4d4e279ce858a0bdb33399b004ef1268e415b7fcbe5029eee93bee94e5759636`.
- Commit `f10315fd6` updated the mobile pin and added a mobile-only sync test,
  but did not update the gateway compatibility constant or add a cross-package
  assertion. This run repaired that drift and added both static and live
  regression coverage.
- No pairing exchange completed, so no new active mobile-device credential was
  created. Unconsumed one-time codes expire automatically.
- GitNexus classified the two compatibility symbols LOW risk with no indexed
  callers or affected process. The cumulative compare-to-main branch remains
  CRITICAL by design (677 files, 3,540 symbols, 21 flows); the working
  unstaged scope was LOW (8 indexed files, 5 symbols, 0 flows).
- Do not mark #1198 or #1200 complete from this run. A local Xcode-signed build
  is not the required EAS provenance or TestFlight artifact.
