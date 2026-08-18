---
date: 2026-08-12
repo: Rhythm
branch: codex/cloud-gateway-mobile-release
pr: 1388
issues: [1387]
status: released-with-ios-submission-gate
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Cloud Gateway/mobile release preparation

## Files changed

- Isolated the intended API/relay, desktop Cloud Gateway wording, mobile catalog/chat/Gallery/offline
  recovery, iOS configuration, and regression-test changes in the Git index.
- Preserved but excluded unfinished Terminal/PTy work and unrelated or ambiguous activity-service,
  transcript-display, proof-image, smoke-note, contract-history, and postmortem changes.
- Updated `docs/testing/manual-smoke.md` for the native Cloud Gateway and explicit Terminal deferral.
- Added one mobile recovery repair: concurrent recovery paths share a single in-flight relay-presence
  request. Updated a web E2E selector to target visible Settings content.

## Checks run

- `node .gitnexus/run.cjs detect-changes --repo Rhythm --scope staged`: HIGH, 64 files, 121 symbols,
  seven flows. Focused `OpencodeProvider` upstream impact: LOW, one direct caller, no flows.
- `ai-workflow checks --level issue`: PASS (Flutter analyze and format; API and MCP typecheck).
- Flutter: full test suite PASS; release macOS build PASS, producing a 70 MB universal `Rhythm.app`.
- Mobile: lint PASS with zero errors/three warnings; typecheck PASS; Jest 25 suites/85 tests PASS;
  `test:ci:static` PASS; Expo config prebuild/introspection PASS; Playwright 71/71 PASS on isolated ports.
- API: build PASS; serial full suite 539 files/4,423 tests PASS (104 files/162 tests skipped); focused
  gateway/relay 14 files/79 tests PASS; real-uplink restart diagnostic 1/1 PASS.
- Live behavior: documented sandbox only (`tools/dev/sandbox.sh`) reported API `ok`, engine `ready`
  with `bridgeLive: true`, and gateway `ready`. The authenticated relay GET E2E passed 1/1 through the
  real uplink and candidate HTTP; teardown freed ports 4588 and 4597-4599.
- Existing physical evidence remains in `docs/ai/runs/2026-08-12-issue-1387-device-smoke.md`: sessions,
  chats, Gallery, Models, Profiles, Scheduled Jobs, Settings, Agents, offline cold recovery, relay-loss
  transcript preservation/reconnection, and prompt/response persistence all passed on device.

## Notes

- Failure triage: the first candidate macOS command returned while Xcode continued in the background;
  the build ultimately completed. Local signature verification reports an untrusted certificate chain,
  so release-workflow signing/notarization remains authoritative.
- Failure triage: mobile web E2E initially passed 69/71. One failure was a hidden, still-mounted copy
  shadowing visible Settings text; the test now selects visible content. The other exposed four recovery
  health probes from overlapping owners; one in-flight request is now shared, and focused plus full E2E
  passed without weakening the bounded-probe assertion.
- Failure triage: parallel full API runs produced different isolated loopback test collisions; each
  failing file passed alone and the complete serial suite passed 4,423/4,423.
- Expo's nine package recommendations reproduce from `main` and are not referenced by CI or release
  preflight. Production bundle verification was not run because the required production Expo variables
  are absent locally.
- Commit `b2496905` was pushed and draft PR #1388 was opened with the full test and release matrix.
  No merge, deployment, desktop release, or iOS submission was performed in this checkpoint.
- No follow-up issue was filed. Terminal and the Gallery cloud-upload redesign remain intentionally
  deferred from this release.

## Merge and release — 2026-08-13

- PR #1388 required checks passed and the PR was squash-merged as
  `ed31ea597878c0636169f49b4cbae9cb378c7d17`.
- Desktop CI initially exposed nine golden groups already failing on parent SHA `36c27ef5` after the
  floating stable channel advanced from Flutter 3.44.9 to 3.47.0. CI and release were pinned to the
  last-green 3.44.9 toolchain; the rerun passed all 1,208 tests and the macOS build.
- One server rerun hit the timing-sensitive scheduler double-dispatch assertion; the prior candidate
  run, targeted rerun, and full serial 4,423-test suite passed. The failed job rerun passed completely.
- Hosted image publish run `31675836351` passed. Watchtower deployed the image; production API health
  reports merge SHA `ed31ea59`, relay health is `ok`, public gateway health is `ready` with the Mac
  online, and protected projects/sessions/chat-catalog routes reject unauthenticated access with 401.
- Desktop release `v0.18.58` run `31675857386` passed every bundle smoke, signing, notarization, and
  publish step. Published DMG SHA-256:
  `8aefe86d1546ae48791db9ade33c7e80086dc428d0ffa3d2429bebc775fe362b`; embedded build `0.18.58 (142)`.
  Independent checks found a valid signature, Gatekeeper `Notarized Developer ID`, and a valid DMG
  staple. The app itself has no separate staple, but Gatekeeper accepts it from the stapled DMG.
- EAS production preflight passed, remote build number incremented 5 → 6, and store build
  `626de7fe-116f-4fb9-afc1-9a82c97b1632` finished for `1.0.8 (6)`. Its recorded feature SHA and merged
  SHA have identical Git tree `a9573fe84aca5c75b6a243d1aeaf30e4557b796a`. IPA SHA-256:
  `0b60914a133c8c77d173341d74d1973b73276159238551f7b8059c5939511f48`.
- Automatic App Store submission stopped before upload because `submit.production.ios.ascAppId` is
  absent. Interactive recovery reached the Apple ID login prompt. Exact remaining human action: get the
  numeric Apple ID for `org.visaliacrc.rhythm.agents`, add it to the EAS submit profile (or sign in
  interactively), submit build 6, and smoke that exact TestFlight build.
