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
npm test                  # vitest run — 965 tests (as of #738-fix, 2026-06-23)
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
| `src/__tests__/issue_738_fix_model_and_session.test.ts` | #738-fix: resolveRunModel 3-step cascade (config/MRU/default), promptAsync gets model arg, session recorded, schema columns present (10 tests) |
| `src/__tests__/issue_738_fix_stale_run_recovery.test.ts` | #738-fix: scheduler boot calls resetStaleRunning on SQLite, skips on Postgres (2 tests) |
| `src/__tests__/issue_743_child_session_persistence.test.ts` | #743: upsertChildSession creates/is-idempotent/null-on-missing-parent; getDiff returns 200 [] for unknown session (5 tests) |
| `test/features/agents/issue_743_parent_id_test.dart` | #743: AgentSession.parentId fromJson (parentSessionId + parentId fallback), toJson omit-when-null, copyWith sentinel, isChildSession; _buildSessionTree root/child/orphan/multi grouping (11 tests) |

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

### opencode fork (Bun/TypeScript)
```bash
cd apps/opencode_fork/packages/opencode
bun run typecheck                                          # must exit 0
bun test src/session/mcp_allowlist.test.ts                 # 5 pass — unit: filterMcpToolsByAllowlist
bun test test/session/mcp_allowlist_e2e.test.ts            # 4 pass — e2e: A=5,B=3,C=1,D=0 tools
bun test test/session/ src/session/                        # full session suite (325+ pass, 0 fail)
```

| File | What it covers |
|---|---|
| `apps/opencode_fork/packages/opencode/src/session/mcp_allowlist.test.ts` | Unit: `filterMcpToolsByAllowlist` — server-level pass-through, tool-level filter, empty allowlist→0, undefined→all |
| `apps/opencode_fork/packages/opencode/test/session/mcp_allowlist_e2e.test.ts` | E2E integration: full `sessions.create → DB persist → runLoop sessions.get → resolveTools → LLM request body`; 4 cases prove the gate fires end-to-end |

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

## Running the fork engine in dev (issue #855)

**Finding:** in ordinary `npm run dev` / `flutter run` development, the api_server
spawns whatever `opencode` binary is first on `PATH` — via `@opencode-ai/sdk`'s
`createOpencode()`, which shells out to the literal command name `opencode`
(`cross-spawn("opencode", ...)`, no absolute-path option). `augmentPathForOpencode()`
(in `apps/api_server/src/services/opencode_client_service.ts`) only prepends the
**bundled** Rhythm fork binary's directory when it can find one at
`<Resources>/opencode_bin/opencode` — a path that only exists inside a signed
release `.app` bundle. In dev, that candidate never exists, so it logs a WARN and
falls through to the ambient PATH — almost always a **stock** upstream opencode
install (e.g. the official installer's `~/.opencode/bin/opencode`, symlinked from
`~/.local/bin/opencode`). Stock opencode carries NONE of the Rhythm-carried
patches (`filterMcpToolsByAllowlist`, per-session `mcpAllowlist`/`skillAllowlist`
on `Session.Info`, etc.) — every MCP tool schema is injected unconditionally,
which is why per-session scoping can appear completely inactive in dev even when
every api_server-side push (`ws_gateway` → `updateSessionAllowlist`) is correct.

### Build the fork binary

```bash
cd apps/opencode_fork/packages/opencode
bun run build --single
# → dist/opencode-<platform>-<arch>/bin/opencode  (e.g. dist/opencode-darwin-arm64/bin/opencode)
```

`--single` (defined in `script/build.ts`) builds only the binary matching the
current host platform/arch — much faster than the full multi-target build used
by CI (`--macos`, which the release workflow uses for the universal arm64+x64
DMG bundle). See `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md` for the
subtree/build background.

### Point dev at the fork build

Two env vars, read by `augmentPathForOpencode()` at api_server startup, checked
**before** the bundled-release path so an explicit dev override always wins:

- `RHYTHM_OPENCODE_BIN_DIR=/abs/path/to/dist/opencode-darwin-arm64/bin` — a
  directory containing an `opencode` executable.
- `RHYTHM_OPENCODE_BIN=/abs/path/to/dist/opencode-darwin-arm64/bin/opencode` — the
  full path to the executable itself (its parent dir is prepended).

```bash
cd apps/api_server
export RHYTHM_OPENCODE_BIN_DIR="$(cd ../opencode_fork/packages/opencode && pwd)/dist/opencode-darwin-arm64/bin"
npm run dev
```

Unset (the default), behavior is byte-for-byte unchanged from before #855 — no
regression risk for anyone not opting in. An invalid/missing path is logged as a
WARN and the override is ignored (falls through to the pre-#855 candidates), it
never silently no-ops without a trace.

### Confirm which engine is actually running

Every api_server startup now logs exactly one of:

```
[OpencodeClientService] engine: /path/to/fork/dist/.../opencode (dev override — fork patches expected active)
[OpencodeClientService] engine: /path/to/opencode_bin/opencode (bundled fork build — fork patches expected active)
[OpencodeClientService] engine: opencode resolved from PATH (stock PATH — scoping inactive unless RHYTHM_OPENCODE_BIN[_DIR] is set)
```

Read this line first any time MCP/skill allowlist scoping seems inactive. Only
the first two lines mean the fork's `resolveTools` gate can possibly be active;
the third line means every MCP tool schema will be injected regardless of what
the api_server pushes — the bug is "wrong binary," not "wrong allowlist logic."

**Still requires a human to verify live:** this env override was validated at
the PATH-resolution unit level (`augmentPathForOpencode` tests in
`opencode_client_service.test.ts`) in this environment. Actually building the
fork binary (`bun run build --single`) and confirming a real profiled session's
`resolveTools complete { resolveToolsCount, allowlistActive }` debug log shows
`allowlistActive: true` with a trimmed `resolveToolsCount` — end to end, against
the real spawned fork process — was **not** performed in this pass and still
needs a human (or a follow-up agent with a build-capable sandbox) to run.

## MCP allowlist smoke (per-session tool-schema scoping — mcp-scope)

Verifies a profile-scoped session injects only its allowlisted MCP tool schemas.
**Requires the patched fork engine** — either `RHYTHM_OPENCODE_BIN_DIR` pointed at
a locally-built fork binary (see "Running the fork engine in dev" above) or the
bundled fork from a release build (`Contents/Resources/opencode_bin/opencode`).
Confirm the fork is in use via the api_server startup log line described above,
or by checking the engine's `--version` directly: it is NOT a stock `1.x.y` (it
embeds the branch, e.g. `0.0.0-feature/...`).

**Measurement instrument:** the fork's `resolveTools` emits a DEBUG log on every
prompt: `resolveTools complete { resolveToolsCount, allowlistActive }`. Read it from
the engine process logs (propagated through the api_server). `resolveToolsCount` is
the number of tool schemas injected; `allowlistActive` is whether the session was
profile-scoped.

**Expected count helper (dynamic — never hardcode):** the api_server expander gives
the expected Secretary count:
```
cd apps/api_server && npx vitest run src/services/__tests__/mcp_allowlist_expander.test.ts
# C2 asserts secretary.mcp.json → tools.length (36 as of 2026-06-25: rhythm 14,
# gmail-work 2, gmail-personal 2, calendar 3, obsidian 9, pdf-tools 6)
```

Checklist:
- [ ] Open a **Secretary** session → engine log `allowlistActive: true`,
  `resolveToolsCount` equals `expandMcpAllowlist(secretaryConfig).tools.length` (36).
- [ ] Open a **profile-less** session (no role) → `allowlistActive: false`,
  `resolveToolsCount` is GREATER (all connected MCP tools — back-compat).
- [ ] Both sessions function normally (tools present and callable).

Automated coverage already proves this by composition: api_server `opencode_client_service.test.ts`
(Secretary session → createSession body carries `expandMcpAllowlist(config)`),
fork `mcp_allowlist_e2e.test.ts` (gate filters offered tools to exactly the allowlist:
5→3→1→0), and `mcp_allowlist_expander.test.ts` (Secretary → 36). The manual smoke is
the live full-stack visual confirmation with the bundled binary.
