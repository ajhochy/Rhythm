---
date: 2026-09-29
repo: rhythm
branch: fix/electron-native-push-and-error-text
pr: TBD
issues: []
status: pending
tags: [run, rhythm]
---

# Electron: native banner for rhythm_notify pushes + specific load-failure toasts

## Files
- `apps/web/src/store.tsx` — `notification.push` now also emits `{v:1,type:'push',id,title,body}` on the
  `rhythm:agent-notifications` bridge; notifications/pending-approvals toasts append the gateway error
  message; the notifications poll (mount / 60s / focus) toasts a given failure once until a success.
- `apps/web/src/agentNotifications.ts` — `push` variant on `AgentNotificationEvent`.
- `apps/electron/src/preload.cjs` — closed-schema `push` frame admitted (keys `body,id,title,type,v`, positive safe-int id).
- `apps/electron/src/main.mjs` — `agentEvent` parses `push` (title/body clamped to 200); `showPushNotification`
  raises `new Notification(...)` only when the window is not focused/visible, dedupes by id (bounded 200), click focuses the window.
- Tests: `apps/electron/test/e12a-auth-boundary.test.mjs` (real main, fake Notification),
  `apps/electron/test/post-m1-phase-7-native-notifications.test.mjs` (real preload in vm),
  `apps/web/tests/notification-toasts-and-push.test.mjs` (store wiring contract).

## Checks
- Red first: with origin/main sources, the 4 new tests failed (2 electron, 2 web); green after the fix.
- `cd apps/electron && npm test` — 455 tests, 451 pass, 0 fail, 4 skipped (needs `apps/web/dist`; build web first).
- `cd apps/web && npx tsc --noEmit -p .` — exit 0; `npm run build` — exit 0.
- `cd apps/web && node --test tests/notification-toasts-and-push.test.mjs` — 2/2 pass.
- GitNexus `impact` / `detect_changes` unavailable (MCP connection closed); callers checked with grep.

## Notes
- Bug 1 root cause was code, not macOS permission: the renderer stored `notification.push` in the in-app
  popover only; there was no bridge event, preload allowlisted only ready/viewing/arm/completion/ask/resolve,
  and main had no handler, so no `Notification` was ever constructed. Same on `mega/2026-09-18-mobile-electron-hermes`.
  Renderer web Notifications are denied by the host by design, so main must own the banner.
- If banners still do not appear after this fix, check System Settings → Notifications → Rhythm (unsigned
  local builds may be listed under a different bundle id / not prompt).
- Bug 2: `GET /notifications` failure cause could not be determined statically (same token + fetcher as tasks;
  route/repository/Postgres schema look consistent). The toast now shows the gateway reason: `Authentication required`
  (401), `Load notifications failed (N)` (HTTP N), or `Notifications service unavailable` (network/CORS/JSON parse).
