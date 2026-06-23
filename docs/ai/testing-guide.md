# Testing Guide

## Canonical workflow commands

```bash
ai-workflow status                  # context-file health
ai-workflow checks --level issue    # flutter analyze + dart format + tsc --noEmit
ai-workflow checks --level pr       # adds vitest (npm test in apps/api_server)
ai-workflow checks --level smoke    # prints pointer to docs/testing/manual-smoke.md
ai-workflow run --issue N[,M,...]   # packed handoff (issue bodies inlined, no extra gh calls)
```

All commands delegate to `scripts/run_ai_workflow.py` in this repo.

## Running tests

### api_server (Node.js/TypeScript)
```bash
cd apps/api_server
npm test                  # vitest run — 951 tests (as of #738/#739/#740, 2026-06-23)
node_modules/.bin/tsc --noEmit   # TypeScript type check (no tsc in global PATH)
```

Note: `better-sqlite3` has ABI compatibility issues on some development machines. If tests fail with `NODE_MODULE_VERSION` errors, run `npm rebuild better-sqlite3`.

### Real-server test harness — avoiding undici socket flakes

Many `src/__tests__/*.ts` files spin up a real server with `createApp().listen(0)` and hit it with the global `fetch` (undici). If teardown only calls `server.close()`, undici's pooled keep-alive socket survives; when a later `listen(0)` recycles that ephemeral port, the dead socket is reused → intermittent `UND_ERR_SOCKET` "other side closed" (load-dependent, passes on isolated re-run). Prevent it in the harness:

```ts
const server = createApp().listen(0);
server.maxRequestsPerSocket = 1;          // server sends `Connection: close`; undici never pools
// ...
const closeServer = () => new Promise<void>((res, rej) => {
  server.closeAllConnections();           // destroy any in-flight sockets
  server.close((e) => (e ? rej(e) : res()));
});
```

`undici` is not a direct dependency (it backs Node's built-in `fetch`), so `setGlobalDispatcher`/`Agent` are unavailable — this server-side approach is the dependency-free fix. Applied in `agent_configs_routes.test.ts`; other harness files share the same pattern and risk.

### desktop_flutter (Flutter/Dart)
```bash
cd apps/desktop_flutter
flutter analyze --no-fatal-infos   # must exit 0 (infos are pre-existing, not new)
flutter test                        # unit tests
dart format . --set-exit-if-changed # CI fails on format violations
```

## Key test files

| File | What it covers |
|---|---|
| `src/__tests__/agent_sessions.test.ts` | Session CRUD, agentId validation, Opencode engine readiness gate, SDK mock |
| `src/__tests__/agents_capabilities_routes.test.ts` | Provider-based capability detection, auth bypass |
| `src/services/opencode_client_service.test.ts` | SDK wrapper lifecycle, graceful degradation when uninitialized |
| `src/services/recurrence_service.test.ts` | Rhythm/recurrence generation logic |
| `src/__tests__/weekly_planning_service.test.ts` | Weekly planner assembly |
| `src/__tests__/workspace.test.ts` | Workspace join/share/message flows |
| `src/__tests__/opc_m3_1_changes_tab_diff.test.ts` | OPC-M3-1: GET /session/{id}/diff via typed SDK wrapper (c1a–c1c) |
| `src/__tests__/opc_m3_2_revert_unrevert.test.ts` | OPC-M3-2: POST /session/{id}/revert + unrevert route contracts (c1a–c1f) |
| `src/__tests__/opc_m3_3_compaction.test.ts` | OPC-M3-3: POST /session/{id}/summarize route contract + SDK error→AppError (c1a–c1c) |
| `src/__tests__/opc_m3_4_command_dispatch.test.ts` | OPC-M3-4: session.command WS frame → handleCommandFrame → dispatchCommand (c1a–c1c) |
| `test/features/agents/opc_m3_1_changes_tab_test.dart` | OPC-M3-1: ChangesTab widget (c2–c5), WS event → fetchSessionDiff |
| `test/features/agents/opc_m3_2_revert_test.dart` | OPC-M3-2: MessageActionsRow revert button, RevertRestoreBanner, controller revert state (c2–c5); includes REAL-SURFACE test (c2a) |
| `test/features/agents/opc_m3_3_compaction_test.dart` | OPC-M3-3: TranscriptHeader overflow menu "Compact session" + spinner, CompactionDivider, ContextUsageHint (c2–c5); includes REAL-SURFACE test (c2a/b) |
| `test/features/agents/opc_m3_4_command_dispatch_test.dart` | OPC-M3-4: sendCommand WS frame dispatch, _sendInput routing (known vs unknown command), role='command' optimistic message (c2a/b REAL-SURFACE, c3–c5) |
| `src/__tests__/opc_m3_5_todo_panel.test.ts` | OPC-M3-5: GET /:id/todo route (no mapping → [], real shape, SDK error → 502); bridge relay todo.updated → WS broadcast (c1–c2) |
| `test/features/agents/opc_m3_5_todo_panel_test.dart` | OPC-M3-5: TodoPanel in SessionSidePanel (c3a REAL-SURFACE, c3b empty→hidden, c4a/b WS session-keyed isolation, c5a header count, c5b checkbox states, c6a/b collapse persistence) |
| `src/__tests__/opc_m3_6_child_sessions.test.ts` | OPC-M3-6: GET /:id/children (no mapping → [], SDK listChildren); GET /:id/children/:childSdkId/messages (role mapping user→input/assistant→output, 404 on missing parent) (c1a–c1b, 7 tests) |
| `test/features/agents/opc_m3_6_child_sessions_test.dart` | OPC-M3-6: TaskChip tap → ChildTranscriptView (c2a REAL-SURFACE), openChildSession fetches messages (c2b), closeChildSession no-refetch (c3), ChildTranscriptView read-only (c4), children not in sidebar lists (c5), ToolState regression (c6) |
| `src/__tests__/opc_instant_new_session.test.ts` | #710: bridge session.updated → updateFields + broadcastSessionUpdated (c2a), empty title skipped (c2b), server accepts null/empty agentId (c4) |
| `test/features/agents/opc_instant_new_session_test.dart` | #710: c1 REAL-SURFACE header tap → onNewSession no dialog; c1-controller empty name default; c3 handleWsMessageForTest → session name updated; c4 empty name → "New session" placeholder; c5 ⋯ button → onOptionsPressed |
| `src/__tests__/issue_738_agent_runner.test.ts` | #738: AgentRunner.run() success, timeout+abort, slot released, createSession fail, promptAsync fail, concurrency cap (7 tests) |
| `src/__tests__/issue_739_scheduler_agent_runner.test.ts` | #739: AGENT_LOCAL=true → AgentRunner called, no trigger insert; AGENT_LOCAL=false → trigger inserted, no AgentRunner; loop isolation (4 tests) |
| `src/__tests__/issue_740_cookbook_run.test.ts` | #740: POST /agent-cookbook/:id/run returns 202+sessionId, 404 unknown, prompt compiled from steps, 401 unauth (4 tests) |

## Mocking the Opencode engine in tests

The Opencode engine is mocked at the module level in all agent session tests:

```typescript
vi.mock('../services/opencode_engine', () => {
  let _ready = true;
  const mockClient = {
    get isReady() { return _ready; },
    set isReady(v: boolean) { _ready = v; },
    listProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),   // ← required: called inside try block
    setAuth: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    statusMessage: 'Opencode SDK ready',
  };
  return { opencodeClient: mockClient, opencodeSessionMap: new Map() };
});
```

**Important:** `vi.clearAllMocks()` resets call counts but NOT the `_ready` closure. Always reset `isReady` in `afterEach` when a test mutates it:

```typescript
afterEach(async () => {
  await closeServer();
  vi.clearAllMocks();
  const { opencodeClient } = await import('../services/opencode_engine');
  (opencodeClient as { isReady: boolean }).isReady = true;
});
```

Failing to do this poisons subsequent tests (they'll hit the 400 "engine not ready" guard).

## Smoke test checklist (manual, pre-merge)

After deploying the Opencode engine:

- [ ] Start the app — verify the api_server starts on port 4001
- [ ] `curl http://localhost:4001/opencode/health` — returns `{"status":"ready",...}`
- [ ] `curl http://localhost:4001/agents/capabilities` — returns provider-based availability map
- [ ] Settings → AI Account → connect a provider (OAuth or API key)
- [ ] `curl -X GET http://localhost:4001/opencode/auth/` — returns connected providers
- [ ] `POST http://localhost:4001/agent-sessions {"agentId":"claude-code","cwd":"~","name":"Test"}` — returns 201
- [ ] WS connect to `ws://localhost:4001/ws/agents`, send `session.input` — SDK prompt is called
- [ ] `DELETE /agent-sessions/:id` — returns 204, session map entry is cleared
- [ ] `flutter run -d macos` — app launches without errors, AI Account section shows connected providers on open
