# Rhythm Architecture

## Overview
macOS desktop productivity app for church staff. Flutter desktop client with a local Node.js/Express API server.

## Dual-server model

| Server | Port | Managed by | Data |
|---|---|---|---|
| Production API (`api.vcrcapps.com`) | 443 | Remote (Postgres) | All user-facing app data |
| Local agent server (`apps/api_server`) | 4001 | Flutter (spawned on launch) | Agent sessions, Opencode engine |

Flutter's `serverConfigService.url` controls the production API only. The agent server is always `http://localhost:4001` (`AppConstants.agentLocalBaseUrl`) — never coupled to the user-configurable URL.

## Opencode Engine

The local `apps/api_server` Node.js process embeds `@opencode-ai/sdk` in-process via dynamic `import()`. This replaced the old approach of spawning `claude-code`/`codex` as CLI subprocesses via `node-pty` (PR #574, 2026-05-13).

### Key components

| Component | Path | Purpose |
|---|---|---|
| `OpencodeClientService` | `services/opencode_client_service.ts` | Typed wrapper: sessions, providers, auth, events |
| `opencode_engine.ts` | `services/opencode_engine.ts` | Singleton client + in-memory `opencodeSessionMap` |
| `OpencodeStreamBridge` | `services/opencode_stream_bridge.ts` | SDK SSE events → WS gateway relay (shared stream) |
| Auth routes | `routes/opencode_auth_routes.ts` | `GET /opencode/auth/` (list), `POST /opencode/auth/:id` (API key), OAuth start/callback |
| Capabilities route | `routes/agents_capabilities_routes.ts` | Provider-based `GET /agents/capabilities` |
| Agent sessions controller | `controllers/agent_sessions_controller.ts` | `POST` creates SDK session + maps ID; `DELETE` clears map + marks closed |
| Type declarations | `@types/opencode-ai-sdk.d.ts` | Local types bridging ESM-only SDK into CJS project |
| Auth UI | `lib/features/settings/widgets/ai_account_section.dart` | Settings auth; refreshes connected providers from `GET /opencode/auth/` on mount |

### Session lifecycle
```
POST /agent-sessions
  → repo.insert(dto)                        ← local DB row (agentKind, cwd, name)
  → opencodeClient.createSession(name, cwd) ← SDK session
  → opencodeSessionMap.set(localId, sdkId)  ← in-memory routing
  → streamBridge.streamSession(...)         ← subscribe to SSE (once, shared)
  → opencodeClient.promptAsync(initial)     ← fire-and-forget initial prompt
  → HTTP 201

WS session.input { id: localId, data: text }
  → opencodeSessionMap.get(localId) → sdkId
  → opencodeClient.prompt(sdkId, text)
  → SSE events → streamBridge → WS broadcast → Flutter

DELETE /agent-sessions/:id
  → streamBridge.stopStream(id)    ← no-op (shared stream stays alive)
  → opencodeSessionMap.delete(id)  ← clean up map entry
  → repo.markClosed(id)
  → HTTP 204
```

### Auth model
Per-user AI accounts. Each user signs into their own provider on their machine. No shared credentials. Credentials stored by Opencode SDK in `~/.local/share/opencode/auth.json`.

### Provider tiers (Settings UI)
1. **Subscriptions:** Claude OAuth, ChatGPT OAuth (opens system browser)
2. **Free API:** Google Gemini (API key), GitHub Copilot (OAuth)
3. **Custom:** OpenRouter or any provider API key

### Known dead code
- `services/pty_runner.ts` — no longer imported by any production code; pending removal PR

### Known gaps
- `resume()` in `AgentSessionsController` sets status to `starting` but does not create an SDK session or start streaming. Treated as a stub pending a follow-up implementation.
