---
date: 2026-07-06
repo: Rhythm
branch: issue-batch-july4
pr: null
issues: [904, 911]
status: committed-on-branch
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `apps/api_server/.../controllers/agentSchedulesController.ts` +
  `agent_schedules_trigger_now_contract.test.ts` (new) — `trigger-now`
  now returns the updated task instead of a message-only body.
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — an
  empty `scheduledTaskId` now returns no sessions instead of falling
  through to the unscoped `listAll(100)` branch.
- Flutter `agent_schedules_view.dart` + `activity_log_tap_navigation_test.dart`
  (new) — activity log rows are now tappable (InkWell → existing
  `NotificationsController.navigateTo('agentSession', id)` path).
- `capability_status_checker.ts` + `agent_capability_status_routes.ts` —
  removed the dead `writeCapabilityStatus()` file-write path (nothing
  read `~/.rhythm-agent/capability_status.json`); route points straight
  at `checkCapabilities()`. `CapabilityState` narrowed to `'ok' | 'down'`.
- Flutter Agent Profiles manager sheet — added a refresh IconButton that
  calls the existing `AgentConfigsController.refresh()`, so profiles
  created out-of-band (e.g. by the Rhythm Setup agent) appear without a
  relaunch. Test: `agent_profile_refresh_button_test.dart`.

## Checks

- api_server: 2435/2435 (2 new), `tsc --noEmit` clean.
- flutter: 846/846 (3 new/updated), analyze at 272-info baseline,
  `dart format` clean.

## Notes

Three commits on `issue-batch-july4`, no PR opened yet.

Root cause of the "Daily" phantom row (#904): `trigger-now` returned
`{ message }` only; the Flutter client parsed that as an
`AgentScheduledTask`, and the model's `?? ''` / `?? 'daily'` fallbacks
produced a garbage empty task that overwrote the real triggered task in
local state. Fix (1) is the root cause; the empty-`scheduledTaskId`
guard (2) is defense-in-depth against a future caller leaking unrelated
sessions the same way; the row `onTap` (3) is the missing feature being
live-tested.

Deferred: detecting a per-integration "degraded" (vs. fully down)
capability state is a real follow-up, not implemented — that's why the
`'degraded'` enum value was removed rather than wired up.
