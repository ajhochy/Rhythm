# Project State

## Current Status
✅ Opencode engine implementation complete. All 10 issues implemented + end-to-end integration fixes on branch `opencode-engine-issue-564`.

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

## End-to-End Fixes (post-issues)

| Fix | Description | Commit |
|---|---|---|
| WS gateway | Replaced `ptyRunner.sendInput()` with `opencodeClient.prompt()`. Removed all ptyRunner refs | `f152e69` |
| Stream bridge | Rewrote to properly subscribe to Opencode SSE events and map to WS format | `f152e69` |
| Session ID mapping | `opencodeSessionMap` routes local session IDs → SDK session IDs for prompt routing | `f152e69` |
| Auth flow | OAuth opens system browser via `url_launcher`. `GET /opencode/auth/` lists connected providers | `f152e69` |
| Tests | Updated agent_sessions.test.ts to mock opencode_engine instead of pty_runner. Removed stale test files | `e2a35c7` |

## Key Changes
- `apps/api_server/src/services/opencode_client_service.ts` — SDK wrapper with typed methods
- `apps/api_server/src/services/opencode_engine.ts` — Singleton client + session ID mapping
- `apps/api_server/src/services/opencode_stream_bridge.ts` — SSE→WebSocket event relay
- `apps/api_server/src/routes/opencode_auth_routes.ts` — Auth endpoints + provider listing
- `apps/api_server/src/routes/agents_capabilities_routes.ts` — Provider-based capabilities
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — SDK session creation + mapping
- `apps/api_server/src/services/ws_gateway.ts` — Rewritten: SDK prompt() input, no PTY refs
- `apps/desktop_flutter/lib/features/settings/widgets/ai_account_section.dart` — Auth UI with browser OAuth
- `apps/desktop_flutter/lib/features/agent_configs/views/manage_agents_view.dart` — Connect card
- `apps/api_server/src/@types/opencode-ai-sdk.d.ts` — Type declarations for ESM SDK

## End-to-End Flow
```
Flutter → POST /agent-sessions → controller creates SDK session + stores mapping + starts bridge
Flutter → WS session.input → ws_gateway → opencodeClient.prompt(sdkId, text)
Opencode → SSE events → stream bridge → WS broadcast → Flutter output
Flutter → DELETE /agent-sessions/:id → controller stops bridge + marks closed
```

## Branch
`opencode-engine-issue-564` — Draft PR #574
