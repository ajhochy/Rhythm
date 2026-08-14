# Rhythm — Project State

## Current focus

The native Cloud Gateway/mobile release is live. Hosted API/relay and desktop `v0.18.58` are
released; iOS `1.0.8 (6)` has been uploaded successfully to App Store Connect and is processing for
TestFlight. Separate track: issue #1392 (pending `rhythm_request_approval` cards invisible in the
desktop UI) has a draft fix awaiting manual smoke + merge — see PR #1393 below.

## Active branch / PR

- Product PR #1388 merged as `ed31ea597878c0636169f49b4cbae9cb378c7d17`.
- Evidence PR #1389 merged as `cbe10fbc3945909feace401ec05dd890f03b9a15`.
- Release-config PR #1390 merged as `0c4c2461ae394daeec8876eea791684f809ffe49`.
- Active docs-only submission-evidence branch: `codex/ios-build-6-submission-evidence`.
- Original workspace Terminal/PTy, transcript-display, activity-service, proof-image, and unrelated
  postmortem changes remain preserved outside this isolated branch.
- **#1392 approval-card delivery fix**: branch `issue/approval-card-delivery` (isolated worktree),
  draft PR #1393 open against `main`. Root cause: the desktop notification-bell badge never counted
  `AgentApprovalsController.pending`, so a pending security-bound approval had zero passive UI signal.
  See `docs/ai/runs/2026-08-14-issue-1392-approval-card-delivery.md` for the full trace and evidence.

## In progress

- Wait for Apple to finish processing EAS submission `d52e1e6d-b832-4f21-a897-b513c53ce60a`, then
  install build 6 from TestFlight and run the focused Cloud Gateway device smoke.

## Risks / known issues

- Terminal remains intentionally deferred; the discussed Gallery cloud-upload redesign is not implemented.
- TestFlight processing and an exact-build physical-device smoke remain.
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
- EAS submission `d52e1e6d-b832-4f21-a897-b513c53ce60a` PASS: exact build
  `626de7fe-116f-4fb9-afc1-9a82c97b1632` uploaded to App Store record `6796011479` with EAS-hosted
  ASC API key `9XHDX3ZN44`; Apple processing is in progress.

## Next step

Verify Apple finishes processing build 6, resolve the existing export-compliance prompt if Apple
requires it, then install that exact TestFlight artifact and perform the focused Cloud Gateway smoke.

For #1392: manual smoke of PR #1393 (launch desktop app, trigger `rhythm_request_approval` with a
`security_action`, confirm the bell badge lights up within 30s and the card is approvable), then
human review/merge.
