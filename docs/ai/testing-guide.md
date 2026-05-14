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
npm test                  # vitest run — 362 tests across 34 files
node_modules/.bin/tsc --noEmit   # TypeScript type check (no tsc in global PATH)
```

Note: `better-sqlite3` has ABI compatibility issues on some development machines. If tests fail with `NODE_MODULE_VERSION` errors, run `npm rebuild better-sqlite3`.

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
