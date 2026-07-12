---
date: 2026-07-11
repo: Rhythm
branch: ocu-01-permission-reply-migration
status: ready-for-coding
issues: [1042]
order: 01
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m1-interaction-polish]
---

# OCU-01 — Migrate permission replies to modern POST /permission/:requestID/reply (once/always/reject + message)

## Summary

The api_server currently answers agent permission requests via a deprecated engine endpoint (POST /session/:id/permissions/:permissionID). The engine's modern endpoint POST /permission/:requestID/reply accepts reply=once|always|reject plus an optional feedback message. The "always" decision persists project-level approvals engine-side and auto-releases matching pending requests later; rejection messages are fed back to the agent. This issue migrates the entire permission-reply path to the new endpoint.

## Scope (in)

- Add a typed wrapper `replyToPermission(requestID, reply, message?)` hitting POST /permission/{requestID}/reply (direct fetch acceptable until OCU-27 lands typed SDK)
- Switch `agent_sessions_controller.respondPermission` and the stream-bridge auto-deny paths to the new wrapper
- Auto-deny paths in opencode_stream_bridge.ts (permission handling around line 1259: #736 allowlist auto-deny, #878 bash classification, plan-mode auto-deny) use reply=reject with a classification message
- Extend the local REST contract POST /agent-sessions/:id/permission/:permissionId/:decision to carry decision=allow|always|deny plus optional body {message}
- Keep the deprecated wrapper as fallback only if the new endpoint 404s (older engine), with a log line

## Non-goals (out)

- No Flutter UI changes (OCU-02 handles that)
- No permission-mode changes
- No fork changes (endpoint already exists)
- No changes to production user data; local agent-server (port 4001) surface only unless the spec says otherwise

## Likely files

- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/services/opencode_stream_bridge.ts
- apps/api_server/src/controllers/agent_sessions_controller.ts
- apps/api_server/src/routes/agent_sessions_routes.ts
- apps/api_server/src/@types/opencode-ai-sdk.d.ts

## Acceptance criteria

- allow/deny round-trips through the new endpoint against the running engine
- "always" decision persists (same permission is NOT re-asked in the same project on a subsequent identical tool call — live-verify against built fork binary)
- deny message reaches the agent (visible in next assistant turn)
- auto-deny paths in the bridge use reply=reject with a classification message
- deprecated endpoint no longer called in the default path

## Required tests

- Contract test in src/__tests__ mocking engine for once/always/reject + message passthrough
- Live e2e check documented in the issue's verification notes (unit-green is not sufficient for fork-facing behavior)

## Dependencies

None
