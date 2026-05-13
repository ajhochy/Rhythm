# API Notification Bug — Workflow Summary

## Description

Fixed a route registration order bug in `apps/api_server/src/app.ts` that caused all `rhythm_notify` MCP calls to fail with 401. Express prefix-matches in registration order: `notificationsRouter` (mounted at `/notifications`) was intercepting requests to `/notifications/agent` before `notificationsAgentRouter` could handle them. Because `notificationsRouter` applies `requireAuth` to all routes, the MCP tool's unauthenticated requests were rejected. The fix moves the `/notifications/agent` mount above the `/notifications` mount so the more-specific path is matched first.

## Issues

| # | Title | Commits |
|---|-------|---------|
| [#553](https://github.com/ajhochy/Rhythm/issues/553) | Reorder route mounts so /notifications/agent is matched before /notifications | `dd9d2f3` |
| [#554](https://github.com/ajhochy/Rhythm/issues/554) | Add a vitest case asserting AGENT_LOCAL=true allows unauthenticated POST /notifications/agent to return 201 | `8007891` |

## Manual Setup Needed

### Set AGENT_LOCAL=true in the API server environment

- [ ] Open `apps/api_server/.env` (or your production environment config / systemd service file).
  - Add or confirm the line: `AGENT_LOCAL=true`
- [ ] Restart the API server so the new env var takes effect.
- [ ] Verify: `POST http://localhost:4001/notifications/agent` with `Content-Type: application/json` and body `{"title":"Test","body":"Test"}` (no Authorization header) should return HTTP 201.
