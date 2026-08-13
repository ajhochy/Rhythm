# Rhythm — Project State

## Current focus

The native Cloud Gateway/mobile release is merged and live. Hosted API/relay and desktop `v0.18.58`
are released; iOS `1.0.8 (6)` is built and awaiting App Store submission configuration.

## Active branch / PR

- Product PR #1388 merged to `main` as `ed31ea597878c0636169f49b4cbae9cb378c7d17`.
- Docs-only evidence follow-up: PR #1389 on `codex/cloud-gateway-release-evidence`.
- Preserved unstaged Terminal/PTy, transcript-display, activity-service, proof-image, and unrelated
  postmortem work remains outside both release scopes.

## In progress

- Submit finished EAS build `626de7fe-116f-4fb9-afc1-9a82c97b1632` after configuring the existing
  Rhythm Agents App Store record's numeric `ascAppId`, then run TestFlight device smoke.

## Risks / known issues

- Terminal is intentionally deferred; the discussed Gallery cloud-upload redesign is not implemented.
- iOS automatic submission is blocked before upload because `eas.json` lacks `submit.production.ios.ascAppId`.
  The recovery flow otherwise reaches Apple login and has valid remote store credentials.
- Two Rhythm desktop processes were already active locally, so the published app was not launched to
  avoid colliding with live embedded API/engine ports. Release-workflow bundle smokes and independent
  signature/notarization checks passed.

## Test status

- PR #1388 required checks PASS: desktop, mobile foundation, and server.
- Local candidate PASS: Flutter format/analyze/tests/build; mobile lint/typecheck/unit/static and web
  E2E 71/71; API build and serial 4,423/4,423 tests; focused relay 79/79; live relay GET E2E 1/1.
- Physical iPhone PASS: sessions, chats, Gallery, Models, Profiles, Scheduled Jobs, Settings, Agents,
  cold offline recovery, relay-loss transcript preservation/reconnection, and message persistence.
- Production PASS: API `/health` reports merge SHA `ed31ea59`; relay and public gateway health are
  ready with `macOnline: true`; protected projects/sessions/chat-catalog routes return 401 unauthenticated.
- Desktop `v0.18.58 (142)` PASS: signed/notarized release workflow; DMG SHA-256
  `8aefe86d1546ae48791db9ade33c7e80086dc428d0ffa3d2429bebc775fe362b`; Gatekeeper accepted;
  DMG staple valid.
- iOS `1.0.8 (6)` build PASS: store IPA SHA-256
  `0b60914a133c8c77d173341d74d1973b73276159238551f7b8059c5939511f48`; submission pending.

## Next step

In App Store Connect, obtain the numeric Apple ID for bundle `org.visaliacrc.rhythm.agents`; add it as
`submit.production.ios.ascAppId` in `apps/mobile/eas.json` (or run EAS submit interactively and sign in),
submit build 6, then install that exact TestFlight build and repeat the focused Cloud Gateway smoke.
