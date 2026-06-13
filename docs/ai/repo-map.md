# Repo Map

## Key directories

```
apps/
├── api_server/            ← Node.js/Express backend (runs locally, spawned by Flutter on port 4001)
│   ├── src/
│   │   ├── server.ts      ← Entry point; DB init, WS gateway attach, Opencode SDK init (non-blocking)
│   │   ├── app.ts         ← Express app; route registrations incl. /opencode/auth + /opencode/health
│   │   ├── controllers/   ← Request handlers (agent_sessions_controller.ts creates SDK sessions)
│   │   ├── routes/        ← Express routers (opencode_auth_routes.ts for AI provider auth)
│   │   ├── services/
│   │   │   ├── opencode_client_service.ts  ← SDK wrapper (sessions, providers, auth, events)
│   │   │   ├── opencode_engine.ts          ← Singleton client + opencodeSessionMap
│   │   │   ├── opencode_stream_bridge.ts   ← SSE events → WebSocket gateway relay
│   │   │   ├── ws_gateway.ts               ← WebSocket server; routes session.input via SDK prompt()
│   │   │   └── pty_runner.ts               ← DEAD CODE — kept pending removal PR
│   │   ├── repositories/  ← SQLite/Postgres data access
│   │   ├── models/        ← TypeScript interfaces
│   │   └── @types/
│   │       └── opencode-ai-sdk.d.ts        ← Hand-written type declarations (ESM/CJS bridge)
│   └── package.json       ← @opencode-ai/sdk@1.14.49 in dependencies
├── desktop_flutter/       ← macOS desktop app (Flutter) — THE SHIPPING CLIENT
│   └── lib/
│       ├── app/core/agents/       ← AgentServerController (spawns api_server), AgentTriggerWatcher
│       ├── features/agents/       ← Agent session view, data source (localhost:4001)
│       │   ├── views/agents_view.dart          ← Main chat view; _ChatBubble routes parts to widgets
│       │   ├── views/_markdown_message_body.dart ← OPC-M2-1: gpt_markdown wrapper for assistant text
│       │   ├── views/_reasoning_block.dart     ← OPC-M2-2: collapsible ReasoningBlock StatefulWidget
│       │   ├── views/_tool_renderers/          ← OPC-M2-3: UnifiedDiffView, TerminalOutputView, TodoChecklistView, TaskChip
│       │   ├── views/_changes_tab.dart         ← OPC-M3-1: ChangesTab, _FileDiffRow, ChangesTabBadge (not yet wired into agents_view.dart)
│       │   ├── controllers/agents_controller.dart ← _appendChatDelta routes by field; chatPartsFor/chatMessagesFor
│       │   └── models/chat_models.dart         ← ChatMessage + ChatPart (durationMs: int? for reasoning)
│       ├── features/agent_configs/
│       │   └── views/manage_agents_view.dart  ← "Connect an AI Account" card
│       └── features/settings/
│           ├── views/settings_view.dart
│           └── widgets/ai_account_section.dart  ← OAuth + API key auth UI; refreshes from GET /opencode/auth/
├── web/                   ← React/Vite UI (prototype, NOT shipping)
└── electron/              ← Electron wrapper (prototype, NOT shipping)

docs/
├── ai/                    ← Project memory files (update after significant work)
│   ├── project-state.md   ← Current status, completed issues, known gaps
│   ├── architecture.md    ← System architecture overview
│   ├── decisions.md       ← Key architectural decisions + rationale
│   ├── repo-map.md        ← This file
│   └── testing-guide.md   ← How to run tests, mock patterns, smoke checklist
├── superpowers/
│   ├── specs/             ← Design specs (2026-05-13-opencode-engine-design.md)
│   └── plans/             ← Implementation plans
└── testing/
    ├── first-stage-evaluation.md
    └── manual-smoke.md    ← Detailed manual smoke test runbook
```

## Port assignments

| Port | Service |
|---|---|
| 4001 | Local agent server (`apps/api_server`) — always started by Flutter on launch |
| 4000 | Reserved for CLIdeck on dev machines — do NOT use |
| 5173 | React web prototype dev server (reference only) |

## Key constants

- `AppConstants.agentLocalBaseUrl` = `http://localhost:4001` — hard-coded, never follows `serverConfigService.url`
- Production API URL = user-configurable via Settings, stored by `ServerConfigService`
