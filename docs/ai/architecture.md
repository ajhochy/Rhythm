# Rhythm Architecture

## Overview
macOS desktop productivity app for church staff. Flutter desktop client with a local Node.js/Express API server.

## Opencode Engine (new)

The local `apps/api_server` Node.js process (spawned by Flutter on each user's machine) now embeds `@opencode-ai/sdk` in-process via dynamic `import()`. This replaces the old approach of spawning `claude-code`/`codex` as CLI subprocesses via `node-pty`.

### Key components

| Component | Path | Purpose |
|---|---|---|
| OpencodeClientService | `apps/api_server/src/services/opencode_client_service.ts` | Typed wrapper around the SDK |
| OpencodeEngine singleton | `apps/api_server/src/services/opencode_engine.ts` | Global shared instance |
| OpencodeStreamBridge | `apps/api_server/src/services/opencode_stream_bridge.ts` | Relays SDK SSE events → WS gateway |
| Auth routes | `apps/api_server/src/routes/opencode_auth_routes.ts` | OAuth + API key auth endpoints |
| Capabilities route | `apps/api_server/src/routes/agents_capabilities_routes.ts` | Provider-based capability detection |
| Agent sessions controller | `apps/api_server/src/controllers/agent_sessions_controller.ts` | SDK-based session mgmt |
| Type declarations | `apps/api_server/src/@types/opencode-ai-sdk.d.ts` | Local types for ESM-only SDK |
| Auth UI | `apps/desktop_flutter/lib/features/settings/widgets/ai_account_section.dart` | Settings account connection |

### Data flow
```
Flutter → REST/WS → api_server (:4001) → OpencodeClientService → @opencode-ai/sdk → AI providers
                                           ↓
                                     OpencodeStreamBridge
                                           ↓
                                     WebSocket gateway → Flutter UI
```

### Auth model
Per-user AI accounts. Each user signs into their own provider on their local machine. No shared credentials. Storage in `~/.local/share/opencode/auth.json`.

### Provider tiers (Settings UI)
1. Subscriptions: Claude OAuth, ChatGPT OAuth
2. Free API: Google Gemini (API key), GitHub Copilot (OAuth)
3. Custom: OpenRouter or any API key
