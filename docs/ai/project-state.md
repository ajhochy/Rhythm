# Project State

## Current Status
✅ Opencode engine implementation complete. All 10 issues implemented on branch `opencode-engine-issue-564`.

## Issues Completed

| # | Description | Commit |
|---|---|---|
| #564 | Install @opencode-ai/sdk + OpencodeClientService | `f13b033` |
| #565 | Init SDK on startup + /opencode/health endpoint | `baaa245` |
| #566 | Replace which-based capabilities with SDK providers | `de0f00b` |
| #567 | Replace PTY subprocess with SDK sessions | `6b797a4` |
| #568 | Opencode SSE stream bridge | `6b797a4` |
| #569 | Auth endpoints (OAuth + API key) | `aacaba0` |
| #570 | Flutter auth UI (Settings + ManageAgentsView) | `2109324` |
| #571 | Remove old PTY transcript, status service, reaper | `71697c6` |
| #572 | Remove .clideck-workflow directory | `8a95360` |
| #573 | Flutter data sources for Opencode engine | `8a95360` |

## Key Changes
- `apps/api_server/src/services/opencode_client_service.ts` — SDK wrapper with typed methods
- `apps/api_server/src/services/opencode_engine.ts` — Singleton client export
- `apps/api_server/src/services/opencode_stream_bridge.ts` — SSE→WebSocket bridge
- `apps/api_server/src/routes/opencode_auth_routes.ts` — Auth/OAuth endpoints
- `apps/api_server/src/routes/agents_capabilities_routes.ts` — Provider-based capabilities
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — SDK session creation
- `apps/desktop_flutter/lib/features/settings/widgets/ai_account_section.dart` — Auth UI
- `apps/desktop_flutter/lib/features/agent_configs/views/manage_agents_view.dart` — Connect card
- `apps/api_server/src/@types/opencode-ai-sdk.d.ts` — Type declarations for ESM SDK

## Remaining Scope
- pty_runner.ts is still present (dead code, referenced by ws_gateway.ts) — clean up in follow-up
- agent_sessions and agent_session_messages SQLite tables still in migrations — can be removed in follow-up
- Flutter agent session controller tests need updating for new SDK-based flow

## Branch
`opencode-engine-issue-564` — Draft PR #574
