# Repo Map

## Key directories

```
apps/
├── api_server/            ← Node.js/Express backend (runs locally, spawned by Flutter on port 4001)
│   ├── src/
│   │   ├── server.ts      ← Entry point; DB init, WS gateway attach, Opencode SDK init (non-blocking)
│   │   ├── app.ts         ← Express app; route registrations incl. /opencode/auth + /opencode/health
│   │   ├── controllers/   ← Request handlers (agent_sessions_controller.ts creates SDK sessions)
│   │   ├── routes/        ← Express routers (opencode_auth_routes.ts for AI provider auth; opencode_mcp_routes.ts OPC-M4-3)
│   │   ├── services/
│   │   │   ├── opencode_client_service.ts  ← SDK wrapper (sessions, providers, auth, events, MCP: listMcp/addMcp/connectMcp/disconnectMcp/removeMcp OPC-M4-3; runShell OPC-M1-6 #709)
│   │   │   ├── opencode_engine.ts          ← Singleton client + opencodeSessionMap
│   │   │   ├── opencode_stream_bridge.ts   ← SSE events → WebSocket gateway relay; relays todo.updated → WS broadcast (OPC-M3-5)
│   │   │   ├── ws_gateway.ts               ← WebSocket server; handleInputFrame (exported, OPC-M4-1) routes session.input with FilePart forwarding + 20MB size guard; handleCommandFrame (OPC-M3-4)
│   │   │   └── pty_runner.ts               ← DEAD CODE — kept pending removal PR
│   │   ├── repositories/  ← SQLite/Postgres data access
│   │   ├── models/        ← TypeScript interfaces
│   │   └── @types/
│   │       └── opencode-ai-sdk.d.ts        ← Hand-written type declarations (ESM/CJS bridge); OPC-M4-1: FilePartInput + PartInput union added; OPC-M4-3: McpStatusEntry, McpLocalConfigInput, McpRemoteConfigInput, mcp.add()
│   └── package.json       ← @opencode-ai/sdk@1.14.49 in dependencies
├── desktop_flutter/       ← macOS desktop app (Flutter) — THE SHIPPING CLIENT
│   └── lib/
│       ├── app/core/agents/       ← AgentServerController (spawns api_server), AgentTriggerWatcher
│       ├── features/agents/       ← Agent session view, data source (localhost:4001)
│       │   ├── views/agents_view.dart          ← Main chat view; _ChatBubble routes parts to widgets; OPC-M3-6: ChildTranscriptView; OPC-M4-1: attachment chips in composer, _buildFilePart (image thumbnail or filename chip), InputAreaTestHarness + UserBubbleTestHarness
│       │   ├── views/_markdown_message_body.dart ← OPC-M2-1: gpt_markdown wrapper for assistant text
│       │   ├── views/_reasoning_block.dart     ← OPC-M2-2: collapsible ReasoningBlock StatefulWidget
│       │   ├── views/_tool_renderers/          ← OPC-M2-3: UnifiedDiffView, TerminalOutputView, TodoChecklistView, TaskChip (OPC-M3-6: navigable — onTap → openChildSession)
│       │   ├── views/_terminal_tab.dart        ← OPC-M1-6 / #709: TerminalTab — command input (Key terminal-command-input) + _CommandBlock log + _ErrorLine (Key terminal-error-line); wired into _session_side_panel.dart Terminal case
│       │   ├── views/_changes_tab.dart         ← OPC-M3-1: ChangesTab, _FileDiffRow, ChangesTabBadge (wired into agents_view.dart session panel)
│       │   ├── views/_revert_restore_banner.dart ← OPC-M3-2: banner at top of transcript when session has active revert; Restore button dispatches unrevertSession
│       │   ├── views/_compaction_divider.dart   ← OPC-M3-3: CompactionDivider — divider row + "Conversation compacted" pill + collapsible summary text
│       │   ├── views/_context_usage_hint.dart   ← OPC-M3-3: ContextUsageHint — warning chip above composer when inputTokens > 0.8×150k
│       │   ├── views/_todo_panel.dart           ← OPC-M3-5: TodoPanel — collapsible todo list panel; _collapseRegistry for per-session persistence; wired into _session_side_panel.dart
│       │   ├── controllers/agents_controller.dart ← _appendChatDelta routes by field; chatPartsFor/chatMessagesFor; sendCommand/slashCommandsFor (OPC-M3-4); sessionTodosFor/fetchSessionTodos (OPC-M3-5); openChildSession/closeChildSession/childMessagesFor/activeChildSessionId (OPC-M3-6); pendingAttachmentsFor/addPendingAttachment/removePendingAttachment (OPC-M4-1); runShellCommand/terminalMessageIdsFor/terminalEntriesFor/terminalErrorFor (OPC-M1-6 #709)
│       │   └── models/chat_models.dart         ← ChatMessage + ChatPart (durationMs for reasoning; fileMime/fileFilename/fileUrl for OPC-M4-1 file parts)
│       ├── features/agent_configs/
│       │   └── views/manage_agents_view.dart  ← "Connect an AI Account" card
│       └── features/settings/
│           ├── views/settings_view.dart         ← OPC-M4-3: mounts McpSection after _ClaudeIntegrationSection
│           ├── controllers/mcp_controller.dart  ← OPC-M4-3: McpController (ChangeNotifier); refresh/add/connect/disconnect/remove; per-server errorFor(name)
│           ├── data/mcp_data_source.dart        ← OPC-M4-3: abstract McpDataSource + _McpDataSourceImpl (targets agentLocalBaseUrl); McpDataSourceTestExtension for baseUrlForTest
│           └── widgets/
│               ├── ai_account_section.dart  ← OAuth + API key auth UI; refreshes from GET /opencode/auth/
│               └── mcp_section.dart         ← OPC-M4-3: McpSection — server list, status badges, add dialog, connect/disconnect/remove actions
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
