---
date: 2026-08-14
repo: Rhythm
branch: issue/approval-card-delivery
pr: https://github.com/ajhochy/Rhythm/pull/1393
issues: [1392]
status: draft-pr-open
tags: [run, Rhythm]
---

# Approval-card delivery bug — root cause + fix

## Files

- `apps/desktop_flutter/lib/app/core/layout/app_shell.dart` — added `notificationBadgeCount()`, wired
  `AgentApprovalsController.pending.length` into the bell badge (`_TopRightAccountClusterState.build`).
- `apps/desktop_flutter/lib/features/notifications/controllers/agent_approvals_controller.dart` —
  `_poll()` now logs failures via `debugPrint` instead of `catch (_) {}`.
- `apps/desktop_flutter/test/app/core/layout/notification_badge_count_test.dart` — new regression test.

## Trace (full path investigated)

1. `POST /agent-approvals` (`agent_approvals_controller.ts`) — correctly creates a pending row with a
   decision nonce. No bug.
2. `GET /agent-approvals?status=pending` (`agent_approvals_repository.ts` `list()`) — no session/profile
   filtering; returns every pending row. No bug.
3. Auth handshake (`requireAuth` + `requireHumanApprovalCapability`) — capability + P-256 public key are
   derived fresh from Keychain each launch and passed as env vars to the spawned local `api_server` child
   (`api_server_service.dart`). Correctly wired, no mismatch in the normal spawned-child flow.
4. Flutter polling (`AgentApprovalsController`, 30s interval) — correctly registered in `main.dart`,
   starts once `AgentServerController.isReady`. `NotificationPanel` renders `_ApprovalCard` per pending
   item — structurally correct.
5. **Root cause**: `app_shell.dart`'s bell badge (`unreadCount`) summed only `NotificationsController`,
   never `AgentApprovalsController.pending.length` — zero passive signal that a security-bound approval
   is blocked. Compounded by `_poll()` silently swallowing every fetch error, which would make any
   transient auth/network failure indistinguishable from "nothing pending."
6. No WS agent-approval broadcast exists anywhere in `apps/api_server/src` — design is polling-only by
   intent, nothing half-wired.
7. No inline session/transcript approval surface exists in the codebase (`apps/desktop_flutter/lib`,
   `apps/mobile/lib`) — out of scope as a new feature, not part of this bugfix.

Related but distinct: `#1382` (five-stream consolidation epic, documents a stale-cloud-token 401 deadlock
on this same `/agent-approvals` stream) and `#1340` (engine `permission.asked` never surfacing — a
different approval stream entirely).

## Checks

- `flutter analyze --no-fatal-infos` — clean.
- `dart format --set-exit-if-changed` — clean (0 changed).
- `flutter test` — 1209/1209 passed, including the 3 pre-existing `AgentApprovalsController` tests and
  the new `notificationBadgeCount` regression test.
- `ai-workflow checks --level issue` — all green (flutter analyze, dart format, api_server tsc, mcp_server tsc).
- `git -C <worktree> remote get-url origin` / `rev-parse --abbrev-ref HEAD` confirmed correct repo/branch
  before push and PR open.
- GitNexus `detect_changes(scope: staged)` — risk `low`, 0 affected processes, 8 changed symbols across
  exactly the 3 files touched.

## Sandbox evidence (live, real API boundary)

```
RHYTHM_SANDBOX_DIR=/tmp/rhythm-sandbox-issue-1392 RHYTHM_SANDBOX_API_PORT=4198 \
RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199 \
RHYTHM_SANDBOX_ENGINE_DIR=<main-checkout>/apps/opencode_fork/packages/opencode \
tools/dev/sandbox.sh up
# → Sandbox ready: http://127.0.0.1:4198 (engine :4197)

curl -s http://127.0.0.1:4198/health
# → {"status":"ok","service":"rhythm-api-server","commit":"dev","features":{"researchProjectsEnabled":false}}

cd apps/api_server && npx vitest run src/__tests__/issue_895_agent_approvals.test.ts
# → Test Files 1 passed (1), Tests 7 passed (7)
#   Real Express server (startTestServer), real SQLite, real auth + human-approval-signature
#   verification: create pending, GET pending/all, approve, reject, no double-decide, both
#   auto-approve-profile code paths.

tools/dev/sandbox.sh down
# → Sandbox removed
```

## Notes / residual risk

- Manual click-through smoke (launch desktop app, trigger `rhythm_request_approval`, watch the bell
  badge light up within 30s) not run in this pass — recommended before merge.
- `#1382`'s stale-cloud-token 401 deadlock on this same endpoint is a separate, already-tracked issue;
  not addressed here.
- An inline session/transcript-embedded approval card (vs. the global bell) is a new-feature ask, not
  implied by this bugfix; flagged as out of scope in the PR body.

## Next step

Manual smoke per above, then human review/merge of PR #1393 (draft, not auto-merged).
