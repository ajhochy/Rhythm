# Opencode Agent Engine Design

**Date:** 2026-05-13  
**Status:** Draft

## Goal

Replace the CLI-subprocess approach to AI agents within `apps/api_server` with Opencode's SDK. The server keeps all existing orchestration features (trigger polling, task↔session linking, notifications, multi-user coordination) while using Opencode's SDK for actual AI interaction.

The old approach spawns `claude-code`, `codex`, or `opencode` as child processes and parses stdout JSON. The new approach uses `@opencode-ai/sdk` to manage sessions programmatically, with support for per-user BYO AI accounts (Claude Pro, ChatGPT Plus, etc.) via OAuth or API key.

### Context — existing architecture

An `apps/api_server` Node.js/Express process runs locally on the user's machine (spawned by the Flutter app on launch). It serves on port 4000 (default) and hosts both general API routes and agent-specific routes (`/agent-sessions`, `/agents/capabilities`, `/ws/agents`, etc.). Agent routes bypass auth when `AGENT_LOCAL=true` is set in the environment.

This document calls the modified version the **Opencode engine** to distinguish it from the production API server on the Synology. The Opencode engine is the local process that embeds the Opencode SDK and handles all AI agent orchestration.

---

## Architecture

### High-level

```
┌──────────────────────────────────────────────────────────┐
│  User's Mac (local)                                       │
│                                                            │
│  ┌──────────────────────────┐                              │
│  │  Rhythm Desktop (Flutter) │                              │
│  │  - Agents view            │  HTTP REST + WebSocket       │
│  │  - Settings (auth)        │                              │
│  └─────────┬────────────────┘                              │
│            │                                                │
│            ▼                                                │
│  ┌────────────────────────────────────────────────┐        │
│  │  apps/api_server                               │        │
│  │  (Express + @opencode-ai/sdk in-process)       │        │
│  │                                                  │        │
│  │  ┌────────────────┐  ┌────────────────────────┐ │        │
│  │  │ Orchestration   │  │ Opencode SDK            │ │        │
│  │  │ Layer           │  │ (createOpencode client) │ │        │
│  │  │                 │  │                         │ │        │
│  │  │ • /agents/*     │  │ • session.prompt()      │ │        │
│  │  │ • /triggers/*   │  │ • auth.set()            │ │        │
│  │  │ • /ws/agents    │  │ • event.subscribe()     │ │        │
│  │  │ • task linking  │  │ • provider list         │ │        │
│  │  │ • notifications │  │                         │ │        │
│  │  └───────┬─────────┘  └──────────┬─────────────┘ │        │
│  │          │                       │                │        │
│  │          └───────┬───────────────┘                │        │
│  │                  │                                │        │
│  │                  ▼                                │        │
│  │  ┌─────────────────────────────────────────┐      │        │
│  │  │ Flutter-facing REST API                 │      │        │
│  │  │ (same endpoints as current agent server)│      │        │
│  │  └─────────────────────────────────────────┘      │        │
│  └────────────────────────────────────────────────┘        │
│                                                            │
│  Remote (over internet):                                   │
│  ┌──────────────────┐   ┌──────────────────────────┐      │
│  │ api.vcrcapps.com │   │ anthropic / openai / etc │      │
│  │ (production)     │   │ (AI providers)           │      │
│  │ - triggers       │   │ - Claude API             │      │
│  │ - tasks          │   │ - OpenAI API             │      │
│  │ - configs        │   │ - etc.                   │      │
│  └──────────────────┘   └──────────────────────────┘      │
└──────────────────────────────────────────────────────────┘
```

### Key design decisions

1. **SDK in-process, not child process** — `@opencode-ai/sdk` is installed as an npm dependency of `apps/api_server`. `await createOpencode()` starts an Opencode server in-memory within the existing Node process. No separate `opencode serve` process to manage.

2. **Local per-user, not shared** — The Opencode engine runs locally on each user's machine (spawned by Flutter on launch). This means per-user AI account auth and localhost-speed SSE streaming.

3. **Same Flutter contract** — The HTTP/WS API exposed to Flutter stays the same. The only Flutter changes are in the data sources (new endpoints if needed) and potentially an auth settings screen.

4. **Graceful degradation** — If the Opencode SDK is unavailable (not installed, first launch, hasn't authed yet), the Opencode engine returns a 503 with a clear message. Flutter shows the same "AI agent unavailable" card it shows today.

---

## Auth — Per-user AI accounts

### Auth model

Each user signs into their own AI provider account on their local machine. No shared credentials, no token draining.

### Auth methods

| Provider | OAuth (browser) | API key | Notes |
|---|---|---|---|
| **Anthropic (Claude Pro/Max)** | ✅ | ✅ | OAuth opens browser to authenticate with Claude account |
| **OpenAI (ChatGPT Plus/Pro/Team)** | ✅ | ✅ | OAuth opens browser for ChatGPT |
| **Google Gemini** | ✅ (gcloud) | ✅ (API key) | Via Vertex AI or direct API |
| **GitHub Copilot** | ✅ (device flow) | ❌ | Built-in GitHub auth |
| **DeepSeek / Groq / Ollama / others** | ❌ | ✅ | Standard API key entry |
| **Opencode Zen (recommended)** | ✅ | ✅ | Managed model service |

### Auth flow in Product

Two paths in the desktop app settings:

**Path A — OAuth (recommended for most users):**
```
Settings → "Connect AI Account" button
  → Opencode engine opens /connect flow via Opencode SDK
    → Browser opens for OAuth
    → User signs into their Claude / ChatGPT
    → Token stored in ~/.local/share/opencode/auth.json
    → Done
```

The Opencode engine exposes `GET /auth/:provider/authorize` and `GET /auth/:provider/callback` endpoints that wrap Opencode's SDK OAuth methods. Flutter can open the system browser for the OAuth URL and handle the callback via a localhost redirect.

**Path B — API Key (simpler, for power users):**
```
Settings → "Enter API Key"
  → User types API key for Anthropic / OpenAI / etc.
  → Opencode engine stores it via Opencode SDK auth.set()
  → Done
```

### Credential storage

Opencode SDK stores credentials in `~/.local/share/opencode/auth.json` by default. This is per-machine and per-user (since each user has their own macOS account). No credentials touch the production API or the Synology.

---

## Opencode Engine Components

### 1. Opencode SDK integration

```
npm install @opencode-ai/sdk
```

```typescript
import { createOpencode } from '@opencode-ai/sdk';

// Start Opencode server in-process
const { client } = await createOpencode({
  config: { model: 'anthropic/claude-sonnet-4-20250514' },
});

// Use the client for all AI operations
const session = await client.session.create({ body: { title: 'Fix auth bug' } });
const result = await client.session.prompt({
  path: { id: session.id },
  body: {
    parts: [{ type: 'text', text: 'Analyze this issue...' }],
  },
});
```

### 2. Orchestration Layer — Endpoint map

| Endpoint | Current behavior | New behavior | Flutter change? |
|---|---|---|---|
| `GET /agents/capabilities` | `which claude` / `which codex` | Lists connected providers from SDK: `client.config.providers()` | None |
| `GET/POST /agent-sessions` | Custom SQLite sessions | Wraps SDK `client.session.list()` / `client.session.create()` | None |
| `GET /agent-sessions/:id/messages` | From custom messages table | Wraps SDK `client.session.messages()` | None |
| `WS /ws/agents` | Custom WebSocket protocol | Relays Opencode SSE events through same WS | None |
| `POST /auth/:provider` | (doesn't exist) | New — OAuth start for AI provider | New Flutter auth UX |
| `GET/POST /notifications/agent` | Existing notification endpoint | Unchanged | None |

### 3. Trigger Polling (unchanged)

`AgentTriggerWatcher` continues to poll `GET /claude-triggers` on the production API every 10 seconds. When a trigger arrives:

1. Opencode engine receives the trigger (via existing polling loop in the orchestration layer)
2. Creates an Opencode SDK session with the trigger's task context
3. Sends the task description as an initial prompt
4. Relays real-time output back through the WebSocket
5. On completion, acknowledges the trigger on production

### 4. MCP Integration

The Opencode engine can also manage MCP servers for the agent to use. Opencode already has built-in MCP support. The engine would configure Opencode's MCP servers to include Rhythm's production API (via the MCP tools already built in `apps/mcp_server`).

---

## Migration Plan

### Phase 1 — SDK integration in the Opencode engine

- Add `@opencode-ai/sdk` to `apps/api_server/package.json`
- Create an OpencodeClientService class that wraps the SDK client
- Add health check: `GET /opencode/health` returning SDK connection status
- The old CLI-subprocess code (AgentSessionService using Process.start) stays as a fallback

### Phase 2 — Session management via SDK

- Replace the CLI subprocess spawning with SDK calls for new sessions
- Map Flutter's existing agent session model to Opencode's session API
- Wire SSE events from Opencode through the existing WebSocket gateway

### Phase 3 — Auth UI

- Add "Connect AI Account" button to Rhythm's Settings
- Build the OAuth browser flow (open system browser, handle redirect)
- Or build the simpler API key input form
- Store credentials via SDK `client.auth.set()`

### Phase 4 — Remove old subprocess code

- Once the SDK path is stable for all agent types
- Remove `Process.start`-based agent execution
- Remove CliDeck workflow directory
- Clean up unused capabilities detection (`which claude`, etc.)

### Phase 5 — CliDeck cleanup

- Remove `.clideck-workflow/` directory
- Remove any CliDeck-related dependencies or config
- Move any remaining CliDeck summaries into docs/archive if needed

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Opencode SDK not initialized (first launch) | Engine returns 503. Flutter shows "AI agent unavailable — set up your AI account in Settings" |
| AI provider API key invalid | SDK returns auth error. Engine returns 401. Flutter shows "AI account not authorized — check Settings" |
| AI provider rate-limited | SDK returns rate-limit error. Engine returns 429 with retry-after. Flutter shows "AI is busy — try again in a moment" |
| Network timeout to AI provider | SDK throws after timeout. Engine returns 504. Flutter shows "AI provider unreachable — check your internet" |
| Engine crash | Flutter's HealthPoller detects failure (same mechanism as today). Shows "Agent server unavailable" card with Retry button |

All Opencode SDK calls are wrapped in try/catch with structured error responses. No unhandled exceptions escape to crash the server.

---

## Testing Strategy

1. **Unit tests** — OpencodeClientService in isolation (mock the SDK client)
2. **Integration tests** — Opencode engine endpoints with a real SDK client against a local Opencode server
3. **Auth flow tests** — OAuth callback handling, API key storage/retrieval
4. **Trigger flow tests** — Incoming trigger → SDK session creation → output relay → acknowledge
5. **Graceful degradation tests** — SDK unavailable, invalid API key, rate limit, timeout

---

## Resolved Questions

1. **MCP server integration** — ✅ Yes, integrate Rhythm's MCP tools (`@ajhochy/rhythm-mcp-server`) directly into the Opencode engine so agents can interact with Rhythm tasks, rhythms, etc.
2. **Default model selection** — ✅ Use the "middle" model for each provider: Claude Sonnet (not Haiku or Opus), OpenAI GPT-4o, Gemini 2.5 Pro, etc.
3. **Session persistence** — ✅ Start fresh. Don't migrate old CLI-subprocess sessions. Opencode SDK handles new session persistence.
