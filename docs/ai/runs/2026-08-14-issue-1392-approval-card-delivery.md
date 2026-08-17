---
date: 2026-08-14
repo: Rhythm
branch: issue/approval-card-delivery
pr: https://github.com/ajhochy/Rhythm/pull/1393
issues: [1392]
status: smoke-pass
tags: [run, Rhythm]
---

# Approval-card delivery

## Files

- `apps/api_server/src/middleware/auth_middleware.ts` and
  `apps/api_server/src/routes/agent_approvals_routes.ts` — accept the signed-in desktop's Cloud bearer
  on the loopback approval GET/PATCH routes while preserving human-decision capability checks.
- `apps/desktop_flutter/lib/features/notifications/models/agent_approval.dart` — retain the trusted
  originating `sessionId` returned by the API.
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` and
  `_inline_agent_approval_card.dart` — render pending approvals only in their originating transcript,
  including empty transcripts, with the existing signed Approve/Reject path.
- `agent_approvals_controller.dart`, `local_notification_service.dart`, `notifications_controller.dart`,
  `app_shell.dart`, and `main.dart` — emit one native notification per new approval, dedupe and cancel
  it, preserve session/request coordinates through activation and cold launch, focus the exact inline
  card, and include pending approvals in the bell badge. Poll cadence is 5 seconds.
- Contract tests cover the real approval HTTP boundary, inline session isolation, native notification
  routing, badge count, and signed decisions.

## Checks

- `dart format . --set-exit-if-changed` — 505 files, 0 changed.
- `flutter analyze --no-fatal-infos` — exit 0; 311 pre-existing infos.
- Focused approval/notification/legacy/badge suite — 16/16 passed.
- Final approval delivery suite after the 5-second cadence change — 5/5 passed.
- `ai-workflow checks --level issue` — Flutter analyze/format plus API and MCP typechecks passed.
- Live API contract in the isolated sandbox — 7/7 passed against the real Express/SQLite/auth/signature
  boundary.
- GitNexus `detect-changes --scope compare --base-ref main` — medium aggregate risk, 33 symbols and one
  affected flow (`Build → PendingNavigation`); no unexpected high/critical impact.

## Manual smoke

- PASS in the rebuilt signed-in debug app using a real `rhythm_get_live_artifact` taint followed by
  `rhythm_request_approval` for `notification.send`.
- The bell badge incremented, the request appeared inline only in the originating session, native
  notification delivery succeeded, and the card exposed working Reject/Approve actions.
- The first run exposed the prior 30-second polling latency. Polling was reduced to 5 seconds, the app
  was restarted, and the user confirmed the repeat smoke succeeded.
- The earlier stale-token 401 condition remains tracked separately in #1382; no #1382 behavior was
  broadened beyond accepting the already-authenticated Cloud bearer on the local approval endpoints.

## Release

- User explicitly authorized merging PR #1393 and publishing the next desktop release after the live
  smoke passed.
