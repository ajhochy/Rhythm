# Rhythm — Project State

## Current focus

The native Cloud Gateway/mobile release is live. Hosted API/relay and desktop `v0.18.58` are
released; iOS `1.0.8 (6)` is built and its previously proven App Store submission target has been
restored on a focused follow-up branch.

## Active branch / PR

- Product PR #1388 merged as `ed31ea597878c0636169f49b4cbae9cb378c7d17`.
- Evidence PR #1389 merged as `cbe10fbc3945909feace401ec05dd890f03b9a15`.
- Active release-config branch: `codex/ios-submit-app-id`; PR pending.
- Original workspace Terminal/PTy, transcript-display, activity-service, proof-image, and unrelated
  postmortem changes remain preserved outside this isolated branch.

## In progress

- Merge the verified `ascAppId: 6796011479` restoration, then submit finished EAS build
  `626de7fe-116f-4fb9-afc1-9a82c97b1632` through the same EAS-hosted ASC API-key path that submitted
  build 5 successfully.

## Risks / known issues

- Terminal remains intentionally deferred; the discussed Gallery cloud-upload redesign is not implemented.
- TestFlight processing and an exact-build physical-device smoke remain after upload.
- Issue #1380 (export-compliance declaration) remains separate; it may require resolving Apple's
  Missing Compliance prompt after processing.

## Test status

- Submit-config regression: `npm run test:app-config` PASS; it asserts App Store record `6796011479`.
- Mobile static: lint PASS with three pre-existing warnings; typecheck PASS.
- Issue gate PASS: Flutter analyze/format plus API and MCP typechecks.
- PR gate PASS: Flutter tests; API lint, serial tests, and build; MCP tests/build; opencode fork
  typecheck and session tests; mobile static/contracts/fake-server; mobile web E2E 71/71.
- Production remains healthy on product merge `ed31ea59`; desktop `v0.18.58 (142)` remains released.
- iOS `1.0.8 (6)` store IPA remains build-complete with SHA-256
  `0b60914a133c8c77d173341d74d1973b73276159238551f7b8059c5939511f48`.

## Next step

Open and merge the focused submit-config PR after green CI, submit EAS build 6 to App Store Connect,
verify its TestFlight processing state and artifact identity, then perform the focused Cloud Gateway
smoke on that exact TestFlight build.
