# Rhythm — Project State

## Current focus

The native Cloud Gateway/mobile release is live. Hosted API/relay and desktop `v0.18.58` are
released; iOS `1.0.8 (6)` has been uploaded successfully to App Store Connect. Issue #1392 now has a
live-smoked inline approval card, bell badge, and native notification route on PR #1393.

## Active branch / PR

- Product PR #1388 merged as `ed31ea597878c0636169f49b4cbae9cb378c7d17`.
- Evidence PR #1389 merged as `cbe10fbc3945909feace401ec05dd890f03b9a15`.
- Release-config PR #1390 merged as `0c4c2461ae394daeec8876eea791684f809ffe49`.
- Active docs-only submission-evidence branch: `codex/ios-build-6-submission-evidence`.
- Original workspace Terminal/PTy, transcript-display, activity-service, proof-image, and unrelated
  postmortem changes remain preserved outside this isolated branch.
- **#1392 approval-card delivery fix**: branch `issue/approval-card-delivery` (isolated worktree),
  PR #1393 open against `main` and ready for review. The desktop now accepts the authenticated Cloud bearer for local
  approval reads/decisions, renders session-scoped inline cards, emits native notifications that route
  to the exact request, and polls within 5 seconds. Manual smoke passed. See
  `docs/ai/runs/2026-08-14-issue-1392-approval-card-delivery.md` for the full trace and evidence.

## In progress

- Wait for Apple to finish processing EAS submission `d52e1e6d-b832-4f21-a897-b513c53ce60a`, then
  install build 6 from TestFlight and run the focused Cloud Gateway device smoke.
- Merge PR #1393 after remote checks, then publish the next desktop patch release.

## Risks / known issues

- Terminal remains intentionally deferred; the discussed Gallery cloud-upload redesign is not implemented.
- TestFlight processing and an exact-build physical-device smoke remain.
- Issue #1380 (export-compliance declaration) remains separate; it may require resolving Apple's
  Missing Compliance prompt after processing.
- Existing issue #1382 remains the broader stale-token track; this PR changes only the approval
  endpoint's already-authenticated local desktop bearer fallback.

## Test status

- Submit-config regression: `npm run test:app-config` PASS; it asserts App Store record `6796011479`.
- Mobile static: lint PASS with three pre-existing warnings; typecheck PASS.
- Issue gate PASS: Flutter analyze/format plus API and MCP typechecks.
- PR gate PASS: Flutter tests; API lint, serial tests, and build; MCP tests/build; opencode fork
  typecheck and session tests; mobile static/contracts/fake-server; mobile web E2E 71/71.
- API CI repair PASS locally: the original `npm test --silent` command completed 542 files and 4,438
  assertions in 51.37s after preventing no-work idle callbacks from reattaching the event stream.
- Hosted-runner triage: Node 24.19 aborts in better-sqlite3 worker cleanup after successful assertions.
  Server CI is pinned to Node 22.19 LTS; desktop release retains its separate bundled Node 24 build,
  ABI query, launch, and API smoke coverage.
- Issue #1392 manual smoke PASS: real approval creation produced a bell badge, session-scoped inline
  card, native notification, and working decision actions; repeat delivery succeeded at 5-second cadence.
- Production remains healthy on product merge `ed31ea59`; desktop `v0.18.58 (142)` remains released.
- iOS `1.0.8 (6)` store IPA remains build-complete with SHA-256
  `0b60914a133c8c77d173341d74d1973b73276159238551f7b8059c5939511f48`.
- EAS submission `d52e1e6d-b832-4f21-a897-b513c53ce60a` PASS: exact build
  `626de7fe-116f-4fb9-afc1-9a82c97b1632` uploaded to App Store record `6796011479` with EAS-hosted
  ASC API key `9XHDX3ZN44`; Apple processing is in progress.

## Next step

Verify Apple finishes processing build 6, resolve the existing export-compliance prompt if Apple
requires it, then install that exact TestFlight artifact and perform the focused Cloud Gateway smoke.

For #1392: merge PR #1393 after remote checks and publish the next desktop patch release.

## Recent coding-agent runs

### 2026-08-14 — approval notification lifetime
- Files modified: `agent_approvals_controller.dart` replaces a directly resolved actionable notification in place; `issue_1392_approval_push_route_contract_test.dart` covers notification lifetime and retained chat routing.
- Checks run: regression test RED on immediate `cancel`; focused controller/route tests PASS (4 tests); complete notification test directory PASS (4 tests); focused format check PASS; `flutter analyze --no-fatal-infos` PASS with 311 pre-existing infos.
- Decisions made: preserve the same notification ID and route payload while changing the title to `Approval approved` or `Approval rejected`; keep poll-time cancellation for approvals resolved outside this app.
- Deviations from spec: none.
- Concerns: native banner visibility still requires a manual macOS smoke after rebuilding; the running app was intentionally not restarted or interrupted.

### 2026-08-15 — unified bell native notifications
- Files modified: `notifications_controller.dart`, `local_notification_service.dart`, `main.dart`, `agents_controller.dart`, and `app_shell.dart` unify native delivery/dedupe/routing for general and immediate agent notifications; two focused notification contract suites and issue #1392 criteria c17-c19 cover the behavior.
- Checks run: acceptance contracts RED on missing general delivery and duplicate agent unread; unified contracts PASS (6 tests); notification/approval/badge slice PASS (21 tests); focused format and diff checks PASS; `flutter analyze --no-fatal-infos` PASS with 311 pre-existing infos.
- Decisions made: baseline the first successful unread poll to prevent launch replay spam; use `notification:<entityType>:<entityId>` payloads and route targetless agent events to the Agents root; keep approval notifications on their specialized lifecycle.
- Deviations from spec: none.
- Concerns: native banner display and tap-through require the parent agent's rebuilt macOS smoke; the running app was intentionally not restarted.
