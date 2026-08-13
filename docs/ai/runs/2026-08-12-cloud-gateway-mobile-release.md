---
date: 2026-08-12
repo: Rhythm
branch: codex/cloud-gateway-mobile-release
pr: none
issues: [1387]
status: ready-for-pr
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
- GitHub CLI authentication is invalid. No commit, push, PR, merge, deployment, desktop release, or iOS
  submission was performed in this checkpoint.
- No follow-up issue was filed. Terminal and the Gallery cloud-upload redesign remain intentionally
  deferred from this release.
