# Rhythm — Project State

## Current focus

The native Cloud Gateway/mobile release is live. Hosted API/relay and desktop `v0.18.58` are
released; iOS `1.0.8 (6)` has been uploaded successfully to App Store Connect and is processing for
TestFlight.

## Active branch / PR

- Product PR #1388 merged as `ed31ea597878c0636169f49b4cbae9cb378c7d17`.
- Evidence PR #1389 merged as `cbe10fbc3945909feace401ec05dd890f03b9a15`.
- Release-config PR #1390 merged as `0c4c2461ae394daeec8876eea791684f809ffe49`.
- Active docs-only submission-evidence branch: `codex/ios-build-6-submission-evidence`.
- Original workspace Terminal/PTy, transcript-display, activity-service, proof-image, and unrelated
  postmortem changes remain preserved outside this isolated branch.

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

## Recent coding-agent runs

- 2026-08-14 — W1 corrective cycle 2 on `agent-stack/si-scope-safety`: removed the unattended scope
  mutation lane; added recursive ambiguous-scope refusal, projection-result compensation gates,
  non-null local operator attribution with exact atomic change binding, and reserved-identifier
  rejection. Parent Node 22 corrective gate: 213 passed with 1 existing skip, including 19/19 real
  HTTP route tests rerun outside the worker sandbox; API build and static scan passed. This work is
  verification-pending, not finally approved; independent review remains. See
  `docs/ai/runs/2026-08-14-w1-scope-safety.md`.

### 2026-08-14 — W1 corrective cycle 3
- Files modified: scope apply/revert services, proposal controller/apply contract comments, fixed-field
  config CAS, focused API/repository/route/core-permission tests, and the W1 contract/run evidence.
- Checks run: RED proofs recorded in the run note; Node 22 non-socket corrective gate PASS (11 files,
  257 passed, 1 existing skip); parent Node 22 complete gate PASS (12 files, 284 passed, 1 existing
  skip, including 23/23 real HTTP route tests); API build PASS.
- Decisions made: retain `scope-delta-v2` for removal-only rollback and add sibling `scope-state-v2`
  for mixed/add/core exact-state rollback; share deferred CAS/projection/compensation mechanics.
- Deviations from spec: no live server or live DB was started.
- Concerns: independent review of `47bd426e` found seven P1 fail-closed blockers spanning semantic
  snapshot validation, ambiguous payloads, risk gating, exact change binding, and status-failure
  compensation. Status is corrective-in-progress; W1 remains unaccepted and unmerged.

### 2026-08-14 — W1 corrective cycle 4
- Files modified: one strict scope mutation/snapshot contract, human approval wiring, scope revert
  lifecycle/risk classification, focused API tests, and W1 contract/run evidence.
- Checks run under Node 22: parent complete 13-file gate passed 323 tests with 1 existing skip,
  including 23/23 real HTTP route tests and 39/39 corrective-4 regressions; API build passed.
- Decisions made: bind both v2 snapshots to allowed kind and exact `change_json` bytes, independently
  replay prior/change/applied semantics at revert, and compensate failed final status transitions by
  exact CAS plus reprojection without overwriting concurrent target bytes.
- Deviations from spec: all five temporary reviewer probes were replaced by equivalent committed
  in-memory SQLite regressions; no live DB, persistent server, network, W2/W3, or integration work ran.
- Concerns: fresh independent review is still required. Status is verification-pending; W1 remains
  unaccepted and unmerged until that review passes.
