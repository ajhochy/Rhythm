# Architecture Decisions

## 2026-06-13 — Instant-create (null/empty agentId) supersedes #653 must-pick-agent requirement (#710)

**Context:** Issue #653 required `agentId` to be non-null and non-empty on session creation ("pick an agent before creating a session"). Issue #710 introduced instant-create: tapping "New session" creates a session immediately with no agentId, opening it as a placeholder the user can configure later.

**Decision:** The server controller now accepts `agentId = null | ''` and creates a session with `agentKind = ''`. The SDK session IS created immediately (so the session is usable as soon as the user sends a message). The `'__pending__'` sentinel (old ORM pattern) is still rejected with 400. `issue_653_contract.test.ts` c1a and c1c were updated from `expect(400)` to `expect(201)` with a comment explaining the supersession.

**Alternatives considered:**
- Keep #653 enforcement, require explicit agentId in the instant-create request: rejected — the instant-create UX requires zero required fields from the user.
- Create a separate "draft session" endpoint that never touches the SDK: rejected — added complexity; one endpoint handles all create paths more simply.

**Consequences:** A session with `agentKind = ''` is valid in the DB. The Flutter client displays it with a "New session" placeholder name and muted text. The session gets a real title via `session.updated` WS broadcast once the user types a first message. Any client code that relied on `agentKind` being non-empty must guard for `''`.

## 2026-06-13 — session.updated bridge handler uses propsInfo?.id as SDK session ID fallback (#710)

**Context:** The `_relayEvent` bridge method extracted the SDK session ID for routing via `props.sessionID ?? propsInfo?.sessionID ?? propsPart?.sessionID`. The `session.updated` event's `properties.info` is a `Session` object whose SDK field is `id` (not `sessionID`). Without the `propsInfo?.id` fallback the bridge could not correlate the event to a local session.

**Decision:** Added `propsInfo?.id` as a fourth fallback: `props.sessionID ?? propsInfo?.sessionID ?? propsInfo?.id ?? propsPart?.sessionID`. This is safe — `id` on a `Session` is always the SDK session UUID.

**Alternatives considered:**
- Rename `id` to `sessionID` in our d.ts: rejected — would diverge from the real SDK shape (breaking the SDK-parity guard).

**Consequences:** The extraction chain is now four levels deep. Future SDK events whose `properties` object uses `id` (not `sessionID`) will automatically route correctly without additional changes.

## 2026-06-13 — McpDataSource uses abstract class + extension for testable baseUrlForTest (#702)

**Context:** Issue #702 test fake uses `class _FakeMcpDataSource implements McpDataSource` but does NOT implement `baseUrlForTest`. Contract test c5 calls `McpDataSource().baseUrlForTest`. These two requirements are contradictory if `baseUrlForTest` is a regular public method on the class.

**Decision:** `McpDataSource` is an abstract class declaring only the 5 async operation methods (no `baseUrlForTest`). `_McpDataSourceImpl` is the private concrete class that holds `_baseUrl`. `baseUrlForTest` is defined as an extension method on `McpDataSource` (via `McpDataSourceTestExtension`) that casts to `_McpDataSourceImpl` and reads `_baseUrl`. Extension methods are NOT part of the Dart interface contract — `implements McpDataSource` does NOT require the fake to implement them. Both test requirements are satisfied.

**Alternatives considered:**
- Make `baseUrlForTest` abstract on `McpDataSource`: fails — fake must implement it but test file can't be modified.
- Make `McpDataSource` a factory with a private concrete: `McpDataSource()` return type is the abstract type; `ds.baseUrlForTest` won't compile unless it's on the abstract type.
- Expose `baseUrl` as a public field on the concrete impl and cast in c5: too fragile — callers could reach it accidentally.

**Consequences:** All extension-based access is in-library only. Production code cannot accidentally call `baseUrlForTest` from another package (analyzer enforces `@visibleForTesting`). The cast in the extension `(this as _McpDataSourceImpl)` will throw at runtime if called on a fake — which is the desired behavior (tests should use the real class for c5).

## 2026-06-13 — removeMcp edits opencode.json directly (no SDK remove method) (#702)

**Context:** The opencode SDK v1.14.49 `Mcp` class has `status`, `add`, `connect`, `disconnect` but NO `remove`/`delete` method.

**Decision:** `removeMcp(name)` in `opencode_client_service.ts` implements removal as: (1) disconnect best-effort (swallows errors), (2) reads `~/.config/opencode/opencode.json`, removes the `mcp[name]` key, writes back. Uses Node `fs` (sync reads, atomic write).

**Alternatives considered:**
- Expose a "disable" flag: SDK `McpLocalConfigInput` has `enabled?: boolean`. Setting `enabled:false` via `addMcp` would hide the server but leave it in config. Rejected — users expect "Remove" to actually remove.
- Wait for SDK to add remove: Out of scope for this milestone.

**Consequences:** Fragile if opencode changes its config file location or format. The config path `~/.config/opencode/opencode.json` is a known opencode convention but not a public contract. If opencode v2 changes this, `removeMcp` will silently fail to clean up config (the disconnect still works). Track as a follow-up when SDK adds a native remove API.

## 2026-06-13 — Slash command dispatch uses WS `session.command` frame, not a new REST route (#697)

**Context:** Issue #697 title says "POST /session/{id}/command"; needed to choose between a new REST route and a WebSocket frame for dispatching slash commands from the Flutter client to the server.

**Decision:** WS frame `{v:1, type:'session.command', id: localSessionId, command: string, arguments: string}` via the existing `handleClientMessage` switch in `ws_gateway.ts`. Server handler (`handleCommandFrame`) is exported so it can be tested directly in vitest without a live WS connection.

**Alternatives considered:**
- REST POST `/agent-sessions/:id/command`: Requires a new route + controller method + data-source HTTP call in Flutter. Adds latency (new round-trip vs. reusing open socket). Every other user-initiated session action (`session.input`, `session.resize`, `session.permission.respond`) already uses WS frames — inconsistency would be hard to justify.
- gRPC or SSE: Out of scope and over-engineered for this single addition.

**Consequences:** The frame is fire-and-forget (same as `promptAsync`). The Flutter `AgentsDataSource.dispatchCommand` stub exists for interface completeness but the actual dispatch is via `repository.send(...)`. The `dispatchCommand` repo method is still useful for test doubles that need to intercept the call at a higher level.

## 2026-06-12 — Watchdog uses signal-0 + --parent-pid flag instead of ppid===1 heuristic

**Context:** PR #683 smoke revealed that in `flutter run` (dev mode) the process chain is Flutter→npx→tsx→Node. The api_server's direct parent is tsx runner, so `process.ppid` is never 1 when Flutter exits — the legacy `ppid===1` watchdog fires silently. Production (`flutter build`, direct Flutter→Node spawn) works correctly today, but the flag-based approach is more robust and eliminates the mode-specific gap.

**Decision:** `ApiServerService.start()` now appends `--parent-pid=${pid}` (dart:io `pid` = Flutter's PID) to every spawn. `server.ts` reads the flag into `trackedRootPid` and uses `process.kill(trackedRootPid, 0)` — the POSIX liveness probe — rather than polling `process.ppid`. `ESRCH` (no such process) triggers `shutdown('PARENT_GONE')`. Legacy `ppid===1` branch retained for launchers that predate the flag.

**Alternatives considered:**
- PID file: Flutter writes its PID to a known path; server reads it. Rejected — filesystem dependency, needs cleanup, race on write. Signal-0 is synchronous and kernel-level.
- Process group kill from Flutter on exit: would need entitlement changes and is macOS/NSApp hook-specific. Signal-0 probe is platform-agnostic.
- Check liveness of every ancestor PID iteratively: over-engineered; tracking the single root (Flutter) is sufficient.

**Consequences:** Any launcher that does not pass `--parent-pid` falls back to the legacy path transparently. Signal-0 on a same-UID ancestor never returns EPERM on macOS (EPERM only if the probed process is owned by a different user), so EPERM is safely treated as "alive" without risk of false-positive shutdown.

## 2026-06-11 — Reclaim a stale opencode orphan on :4096 before spawn (kill-stale, not dynamic port) — #655

**Context:** The opencode engine binds a fixed port (`OPENCODE_ENGINE_PORT = 4096`) via the SDK's `createOpencode()`. When the api_server is SIGKILLed / Force-Quit, the existing parent-PID watchdog (`server.ts:106-125`) cannot run, so the opencode grandchild reparents to launchd and squats on :4096 indefinitely. The next launch fails to bind and surfaces the opaque "Server exited with code 1 / engine not ready".

**Decision:** Before `createOpencode()`, `reclaimStalePortForOpencode()` probes :4096. If the holder is unmistakably a stale `opencode serve` (command contains both `opencode` AND `serve`; if a `--port`/`--port=` token is present it must equal 4096), SIGTERM → grace-poll → SIGKILL → poll free, then spawn. If the holder is a NON-opencode process, throw a clear error naming the PID + command (flows through the existing `_initializeImpl` try/catch → `status=error` with that message). The OS boundary (`lsof`/`ps`/`kill`/port-free) is a `StalePortDeps` interface injected for unit tests.

**Alternatives considered:**
- Dynamic alternate-port retry (4097, 4098…) — rejected: the Flutter client + ws_gateway assume a fixed engine port; making it dynamic ripples through more surfaces than kill-stale (the issue's own rationale).
- Rely on the parent-PID watchdog only — rejected: it cannot cover untrappable SIGKILL / Force-Quit / OOM, which is exactly the orphan path.
- Blindly kill whatever holds :4096 — rejected: would kill a foreign process (e.g. another dev server); c2 requires naming-and-refusing instead.

**Consequences:**
- + A single Force-Quit no longer bricks the agent feature; self-heals on relaunch with a diagnosable log line.
- + Foreign-process case fails loudly with the occupying PID/command instead of the opaque exit-code-1.
- − `defaultStalePortDeps` shells to `lsof`/`ps` (macOS-present, the sole shipping target). On a host without them, `lookupPidOnPort` swallows the error and treats the port as free — safe degradation (same as "no orphan"), but means the reclaim is a no-op there.
- − The `serve`+`opencode` heuristic is deliberately conservative; an opencode invoked without `serve` in its argv would not be reclaimed (acceptable — the SDK always spawns `opencode serve`).

**Implementation note (lazy require):** `execFile` is resolved via `require('child_process')` *inside* `runCommand()` at call time, not bound at module load. A top-level `promisify(execFile)` broke `credentials_bridge_service.test.ts`, which partial-mocks `child_process` with only `execSync`; deferring the reference keeps module import inert for partial-mock importers.

## 2026-06-01 — Google token refresh mirrors the desktop mint client (not a per-account issuing-client column)

**Context:** Google integration accounts were minted by the desktop PKCE client (`exchangeDesktopCode` → `googleAuthClientId/Secret`) but `refreshTokens` refreshed with the web client (`googleClientId/Secret`). Google rejects a refresh token presented under a different client than issued it → recurring `unauthorized_client` on the Integrations page.

**Decision:** Make `refreshTokens` present the same credentials `exchangeDesktopCode` uses (`googleAuthClientId/Secret`), with a not-configured guard. No schema/migration.

**Alternatives considered:**
- Add an `issuing_client_id` column to `integration_accounts`, populate on upsert, and refresh with the matching client — rejected: requires SQLite+Postgres migration and a backfill, for zero practical benefit since the Flutter desktop app is the only live mint path and every shipping account is desktop-minted.
- Consolidate to a single Google OAuth client — rejected: larger change, out of scope, and the desktop (PKCE/loopback) and web (redirect) flows have legitimately different client types.

**Consequences:**
- + Symmetric with issuance: any environment where Google sign-in works will refresh successfully (same credentials), so the fix "lands first try" with no new secret or Google Cloud change.
- + Tiny, low-risk surface (one private method) covered by a contract test.
- − Any legacy account minted via the now-unused web `/auth/google/callback` flow would need one reconnect to switch to a desktop-minted token.
- − Depends on the serving API having `GOOGLE_AUTH_CLIENT_SECRET` set; bundled build provides it (`desktop_release.yml`), hosted deploy must too (already required since desktop-exchange works there).

## 2026-05-13 — Opencode engine replaces PTY subprocess agent execution

**Context:** The existing agent server spawned `claude-code`/`codex`/`opencode` as CLI subprocesses via `node-pty` and parsed stdout JSON. This was fragile, tied to specific CLI installations, and had no structured API for session management.

**Decision:** Embed `@opencode-ai/sdk` in-process in the existing `apps/api_server` and use its programmatic API for all AI agent interactions.

**Alternatives considered:**
- Spawn `opencode serve` as a child process — rejected (more processes, port management, restart complexity)
- Replace the api_server entirely with Opencode's server — rejected (would lose existing orchestration features like trigger polling, task linking, notifications)
- Use the @opencode-ai/sdk via static import — rejected (SDK is ESM-only, api_server uses CommonJS)

**Consequences:**
- + Per-user AI auth (no shared credentials)
- + Localhost-speed SSE streaming
- + Structured messages instead of raw terminal output
- + 75+ AI providers via Opencode's provider ecosystem
- + MCP integration for Rhythm tools
- - `node-pty` and `pty_runner.ts` are now dead code (removal deferred to follow-up)
- - ESM/CJS bridge requires dynamic `import()` at runtime

## 2026-05-13 — Per-user AI authentication vs shared pool

**Context:** If Opencode ran on a shared server (Synology), all users would share one set of AI credentials.

**Decision:** Run the Opencode engine locally on each user's machine. Each user authenticates their own AI accounts.

**Consequences:**
- + No shared token pool to drain
- + Each user's credentials stay on their machine
- - Each user must set up their own AI account

## 2026-05-13 — Middle model as default

**Context:** When a user first connects an AI account, a default model must be selected.

**Decision:** Use the "middle" model for each provider — Claude Sonnet, GPT-4o, Gemini 2.5 Pro.

## 2026-05-13 — Fresh sessions, no migration

**Context:** Existing agent sessions were stored in local SQLite with PTY output.

**Decision:** Start fresh. Old sessions are orphaned but not migrated. Opencode SDK handles session persistence going forward.

## 2026-05-13 — In-memory session ID mapping instead of DB column

**Context:** The WS gateway needs to route user input from a local session ID to the correct Opencode SDK session.

**Decision:** Use an in-memory `Map<string, string>` (`opencodeSessionMap`) rather than adding a migration to store SDK session IDs in SQLite.

**Consequences:**
- + No database migration needed
- + Ephemeral (matches session lifecycle — sessions don't persist across server restarts)
- - Mapping is lost on server restart (acceptable — SDK sessions wouldn't survive a restart either)
- - Map entries must be explicitly deleted on session close to avoid unbounded growth (fixed in code review: `opencodeSessionMap.delete` now called in `remove()`)

## 2026-05-13 — All WS input goes through the prompt method

**Context:** The old PTY approach sent raw terminal input via `ptyRunner.sendInput()`. The SDK doesn't have a terminal input channel.

**Decision:** Forward WS `session.input` messages to `opencodeClient.prompt()`. Terminal resize messages are no-ops.

**Consequences:**
- + Clean structured communication instead of raw terminal bytes
- - Real-time streaming depends on SSE events, not synchronous return values

## 2026-05-13 — Single shared SSE event stream, not per-session subscriptions

**Context:** Opencode SDK provides one event stream for the entire client, not per-session streams.

**Decision:** `OpencodeStreamBridge` subscribes once on first session creation and keeps the stream alive for all sessions. Session routing uses `opencodeSessionMap` reverse-lookup (O(n) scan per event).

**Consequences:**
- + One connection instead of N connections for N sessions
- - If the stream dies and re-subscribes, a short window exists where two `streamSession` callers could both attempt subscription. Guarded by the `subscribed` flag (set before the await), but not tested.
- - If `subscribeToEvents()` returns null (SDK not ready), `subscribed` must be reset to `false` to allow retry (fixed in code review).

## 2026-05-13 — `resume()` deferred as a stub

**Context:** The old PTY path had `ptyRunner.resume()` that reconnected a subprocess to an existing session token. The Opencode SDK has no "resume" concept — sessions are stateless from the SDK's perspective.

**Decision:** `resume()` currently validates the session and sets status to `starting`, but does not create an SDK session or start the stream bridge. This is a known gap.

**Next step:** Implement resume as "create a new SDK session with the same cwd/name and start streaming." Filed as a follow-up task.

## 2026-05-13 — `resume()` creates a fresh SDK session (issue #580)

**Context:** Follow-up to the stub above. Users need a working "resume" action even though the SDK is stateless.

**Decision:** `AgentSessionsController.resume()` now mirrors `create()` — it calls `opencodeClient.createSession(name, cwd)`, registers the local→SDK mapping in `opencodeSessionMap`, starts the SSE stream bridge, and transitions status to `starting`. Prior SDK conversation history is NOT reattached; resumed sessions begin clean.

**Consequences:**
- + Resume now produces a working agent session instead of a hanging "starting" status.
- - Conversation history from the previous SDK session is lost (acceptable per #580 scope; revisit if users need cross-session continuity).
- Landed on branch `opencode-engine-issue-564`, pending merge.

## 2026-05-13 — Stop persisting legacy CLI fields but keep DB columns (issue #581)

**Context:** Issue #575 removed CLI-era fields from the Flutter `AgentConfig` model. The api_server repository was still reading/writing `command`, `canResume`, `resumeCommand`, `sessionIdPattern`, `outputMarker` on every insert and select.

**Decision:** `agent_configs_repository` no longer persists or returns these five fields. The SQLite columns are retained (no DROP) so a rollback to the prior client build can still read its own data.

**Consequences:**
- + API responses are clean; no legacy fields echoed back to the client.
- + Rollback to a prior client build remains possible without a schema migration.
- - Controller-side input validation still requires `command` and validates `resumeCommand`/`canResume` — tracked as a Known Gap; follow-up needed if the client ever POSTs without them.

## 2026-05-26 — system role in agent_session_messages is display-only (#629)

**Context:** Issue #629 requires seeding task context into the chat transcript at session creation. The `agent_session_messages` table already has a `role` column that accepts `'output' | 'input' | 'system'`. The concern was whether inserting a `'system'` message could accidentally trigger an extra LLM turn (bug #624 risk).

**Decision:** Append a `role='system'` message directly via `messagesRepo.append()` after `repo.insert()`. This is safe because the WS gateway's LLM trigger path is `session.input` over the WebSocket only — `messagesRepo.append()` writes to SQLite but never touches the OpenCode SDK. The SDK is only invoked via `opencodeClient.promptAsync()` in `create()` (for agent-assigned sessions) or via the first `session.input` WS frame (for agent-less sessions). Neither path is triggered by `messagesRepo.append()`.

**Alternatives considered:**
- Seed as part of the initial `promptAsync` content — rejected because this would send the task context as an AI prompt, wasting tokens and potentially confusing the agent.
- Seed via a synthetic WS broadcast — rejected because it would touch the WS gateway code path and could introduce ordering races.
- Store task context only in the session row's `task_title` field — rejected because this requires Flutter to reconstruct the display from structured fields; the message approach reuses the existing transcript render path.

**Consequences:**
- + No risk of triggering extra LLM turns (proven by c4 contract test).
- + Reuses existing `_MessageBlock` (full view) and `_MiniMessageBlock` (bubble) render paths.
- + Graceful fallback: if taskId is not in local DB, uses provided `taskTitle` from request body.
- - If the transcript for an old session is re-fetched via `GET /agent-sessions/:id/messages`, the system message will always appear first (correct behavior — it was appended at creation time).
- Landed on branch `opencode-engine-issue-564`, pending merge.

## 2026-05-26 — agent pill resolves provider→agent-kind, not raw providerId (#645)

**Context:** The Agents agent pill (`_AgentKindBadge`) showed a stale icon/label after the user switched the session's model. Root cause: `setSessionModel` updates the session's `providerId`/`modelId` but never `agentId`, and the badge looked up `byId(session.agentId)`. A first fix tried `byId(session.providerId)` — but `CatalogModelEntry` has TWO distinct fields, `agent` (claude-code/codex/gemini-cli) and `provider` (anthropic/openai/google), and `_applyPick` stores `providerId: entry.provider`. So a codex model stores `providerId='openai'`, and `byId('openai')` returns null (config ids are agent-kinds) → it fell back to the stale agentId. The contract test passed only because it injected `providerId='codex'`, a value the app never stores — a **false green**.

**Decision:** Resolve the displayed agent through a provider→agent-kind map (`_kProviderToAgentKind`: anthropic/github-copilot→claude-code, openai→codex, google→gemini-cli) that mirrors the server's `ws_gateway.ts` `PROVIDER_TO_AGENT`, then `byId(mappedKind)`; prefer the mapped config only when it differs from `agentId`. Also switched `context.read` → `context.watch` so the badge rebuilds on controller changes. Contract test rewritten to use real provider values (`openai`→Codex, `google`→Gemini CLI), proven red-then-green.

**Process note:** The false green was caught by orchestrator trust-but-verify (comparing the test's injected value against the real value flowing from `_applyPick`), NOT by the green test run. Lesson for behavioral contracts: assert with the value the production code path actually produces, not a convenient stand-in. When a UI value is derived through a mapping, the test must feed the upstream (pre-mapping) value.

**Consequences:**
- + Pill reflects the resolved agent for all real provider values; mapping is centralized and matches the server.
- + `context.watch` keeps the pill live on config refreshes.
- - The Flutter map duplicates the server `PROVIDER_TO_AGENT`; if the server adds a provider, both must change. Acceptable for now (two small maps); a shared source could be considered later.
- Landed on branch `fix/issue-643-645-agents-ui`, PR pending.

## 2026-06-12 — OpenCode parity: keep the embedded-SDK architecture (plan #685–#703)

**Context:** Request to port OpenCode's full feature set/UI into the Agents tab, after a prior partial attempt. Options weighed: (a) PTY-wrap the opencode TUI, (b) consume opencode's server API, (c) reimplement client logic natively, (d) hybrid. Audits showed the current code is already (b)+(c): `@opencode-ai/sdk` v1.14.49 in-process (server on :4096), SSE→WS bridge, native Flutter UI — and that the SDK already exposes every endpoint the missing features need (`diff`, `revert`, `unrevert`, `summarize`, `todo`, `fork`, `command`, `message` list, `children`, `mcp`).

**Decision:** Keep (b)+(c). The parity gap is wiring + UI, not architecture. PTY-wrapping the TUI was rejected (regression to the pre-#574 world: ANSI scraping, no structured parts, no permission cards); a webview of opencode's web/desktop client was rejected (foreign design system, Electron/Solid stack inside Flutter). The plan's M1 fixes the structural defects that made the prior attempt rot — dual transcript stores, duck-typed SDK access, in-memory sentinels — before any new features land.

**Consequences:**
- + Each parity feature maps to a typed SDK call + a Flutter widget; per-issue contracts can use recorded v1.14.49 fixtures.
- + Out-of-scope list is explicit (share/themes/keybinds/LSP/TUI-remote/worktrees) with church-context justifications.
- - SDK version pinning matters: parity claims are against v1.14.49; SDK upgrades need a re-audit of the event/part union.
- Landed: plan + issue specs on `workflow/run-2026-06-12-opencode-parity-plan` (PR #704); issues #685–#703.

## 2026-06-12 — AgentFlow CLI resume requires AGENTFLOW_WORKFLOWS_DIR (process note)

**Context:** A `plan_and_issues` run died mid-flight when the agentflow MCP server restarted (its in-memory registry is lost on restart; phase outputs/state survive on disk). The documented recovery is CLI `agentflow resume <aflow> --instance <uuid>` — but the first attempt silently resolved model tiers from the built-in fallback (ollama `qwen2.5:14b`) and failed with `fetch failed`, because the model-resolver only reads `agentflow.config.json` from CWD or `$AGENTFLOW_WORKFLOWS_DIR`, and neither was set.

**Decision:** Always run CLI resumes as `AGENTFLOW_WORKFLOWS_DIR="$HOME/.config/agentflow/workflows" agentflow resume …` (that dir holds the canonical tier→model config: tier1=claude-fable-5, tier2=sonnet, tier3=haiku). With it set, the resume completed plan+write_issues correctly on tier1.

**Consequences:**
- + Stalled AgentFlow runs are recoverable without re-running completed phases.
- - The fallback-to-ollama behavior is silent until an agent executes; check the `📦 [agent] model:` line in resume output before trusting a resumed run.

## 2026-06-13 — OPC-M4-1: attachment state in controller, not view (handleInputFrame extraction)

**Context:** Issue #700 required real FilePart forwarding to the SDK. Two key non-obvious choices:

1. **Attachment pending-state in `AgentsController`, not `_InputAreaState`** — Prior approach stored attachment chips in local `StatefulWidget` state. Moving to controller means widget tests can `setPendingAttachmentsForTest()` without simulating file-picker UI events. It also means `sendInput()` can merge them internally, keeping the repository interface unchanged (no new `AgentsRepository` method, avoiding the 23+ stub-file update tax).

2. **`handleInputFrame` extracted as exported `async function`** — The `session.input` async IIFE in `handleClientMessage` was extracted to a named exported function (matching the `handleCommandFrame` pattern). The vitest test imports it directly. Alternatives rejected: (a) testing via a full WS server — too heavyweight; (b) keeping the IIFE and wrapping it — requires an internal mock mechanism. Named export is the minimal correct change and satisfies the REAL-surface requirement by testing the exact code path the WS switch uses.

3. **`as unknown as` cast removed from `opencode_client_service.ts` by updating `.d.ts`** — Issue #685 had a constraint test checking zero `as unknown as` in that file. The previous session's implementation introduced one. Fix: add `FilePartInput` + `PartInput` union to the hand-typed `.d.ts` so the SDK call is fully typed. The `as unknown as` cast in `ws_gateway.ts` (for `.bind()` return type preservation) is in a different file not checked by the constraint test and is kept intentionally per the #604 regression note.

**Consequences:**
- + Controller-held attachment state is trivially testable and survives widget rebuilds.
- + `AgentsRepository` interface unchanged — no stub tax.
- + Issue #685 constraint continues to hold (zero `as unknown as` in `opencode_client_service.ts`).
- - `_pickFiles()` still needs real file access at runtime; test coverage uses injected data URIs (not live file picker).

## 2026-06-13 — OPC-M1-6 / #709: Terminal message tracking in controller state (not message model)

**Context:** Issue #709 required terminal-originated messages to be excluded from the main chat transcript (c4) while still being surfaceable in the Terminal tab.

1. **`Set<String> _terminalMessageIds` per session in `AgentsController`, not in `AgentSessionMessage`** — Adding a `isTerminal: bool` field to `AgentSessionMessage` would require schema changes, migration logic in `_appendChatDelta`, and updated JSON parsing. Tracking IDs in controller state avoids all of that. The filter in `agents_view.dart` `_buildTranscriptBody` is a single `.where()` — O(n) over the terminal set which is small (one entry per shell command run).

2. **`_terminalCommandByMessage` records command text alongside the ID** — `terminalEntriesFor()` returns `({String command, String messageId})` records so `_CommandBlock` can render the `$ $command` echo header without a secondary lookup. Alternatives: store only IDs and look up command text from session input history — rejected (too much indirection; terminal commands are not in the regular chat input flow).

3. **Default SDK agent is `'build'`** — opencode's built-in bash-running agent. This is an internal opencode name; if opencode renames it the shell runner will silently misdispatch. A future issue should surface agent names via `GET /agent-sessions/agents` and let the user choose (or at least pick the first bash-capable agent dynamically).

4. **`List<ChatPart>` (not `List<dynamic>`) in `_CommandBlock.toolParts`** — Initial implementation used `List<dynamic>` to avoid importing `chat_models.dart`. Changed to typed `List<ChatPart>` for type safety; `import '../models/chat_models.dart'` added to `_terminal_tab.dart`.

**Consequences:**
- + No model schema changes; backward-compatible with existing message data.
- + `terminalMessageIdsFor()` is `O(1)` per lookup (Set); filter in transcript is `O(m)` where m = terminal command count (always small).
- - Terminal message exclusion is in-memory only — if the app restarts with a resumed session, the terminal IDs are not persisted. Resumed sessions will briefly show terminal messages in the transcript until the user re-runs a command. Deferred (no persistence requirement in #709).
- - `'build'` agent name is a hardcoded opencode internal; see note above.


## 2026-06-16 — MCP-7: curated MCP server registry completed to 7 + credential approaches

**Context:** `CURATED_MCP_SERVERS` (apps/api_server/src/config/curated_mcp_servers.ts) is the source-of-truth list Rhythm auto-installs into the user's opencode.json via `ensureCuratedMcps()`. MCP-2 shipped pdf-tools; MCP-6 added the two token-bridged servers. MCP-7 completes the set to 7. Exact package names / remote URLs are a supply-chain pin risk; every uncertain pin carries a `// TODO(verify-pin)` comment to confirm at PR. No service changes were needed — `toEntry()` already persists `{type:'remote',url}` for remote servers and `{type:'local',command}` for local ones.

**Per-server record (id — pin — rationale — credential approach — fallback):**

1. **pdf-tools** — `npx -y @modelcontextprotocol/server-pdf` (local) — zero-auth PDF tooling, first end-to-end proof (MCP-2). Credential: none (`requiredEnv: []`). Pin UNCONFIRMED (TODO-verify): published package name + version. Fallback: n/a.
2. **google-workspace** — `npx -y @modelcontextprotocol/server-google-workspace` (local) — Google Workspace tools. Credential: **token bridge** — fresh OAuth access token injected into `GOOGLE_OAUTH_ACCESS_TOKEN` from Rhythm's stored Google tokens at ensure time (MCP-6); skipped entirely when no account connected. Pin UNCONFIRMED (TODO-verify): package name + version + that the server reads that env key. Fallback: none today (server is skipped if no connected Google account).
3. **planning-center** — `npx -y @ajhochy/pco-mcp-server` (local) — in-house Planning Center MCP. Credential: **token bridge** into `PCO_ACCESS_TOKEN` (MCP-6); skipped when no PCO account connected. Pin: in-house package, version UNCONFIRMED (TODO-verify). Fallback: a PCO Personal Access Token supplied via the secrets UI if the OAuth token bridge is unavailable.
4. **canva** — remote `https://mcp.canva.com/mcp` — **official** Canva hosted MCP. Credential: **remote OAuth on first use** by opencode, no API key (`requiredEnv: []`). URL confirmed via Canva docs/PulseMCP (June 2026) but marked TODO-verify against drift. Fallback: n/a.
5. **notion** — remote `https://mcp.notion.com/mcp` — **official** makenotion hosted MCP. Credential: remote OAuth on first use (`requiredEnv: []`). URL per issue; TODO-verify. Fallback: n/a.
6. **stripe** — `npx -y @stripe/mcp --tools=all` (local) — **official** Stripe MCP. Credential: **API key via secrets UI** — server reads `STRIPE_SECRET_KEY` from env (a restricted API key is recommended; `--api-key=` flag is an alternative). Package confirmed; version pin UNCONFIRMED (TODO-verify). Fallback: Stripe also hosts a remote MCP at `https://mcp.stripe.com` if the local stdio server is undesirable.
7. **mailchimp** — `npx -y @agentx-ai/mailchimp-mcp-server` (local) — **maintained community** (not official) Mailchimp Marketing MCP. Credential: **API key via secrets UI** — reads `MAILCHIMP_API_KEY`; the key embeds the data-center suffix (e.g. `...-us21`) so no separate server-prefix env var is needed. Package + env key UNCONFIRMED (TODO-verify): community package, pin a version. Fallback: alternative community Mailchimp MCP servers exist (e.g. damientilman/mailchimp-mcp-server) if this one is unmaintained.

**Alternatives considered:** running Stripe/Notion as remote-only vs local stdio — chose local stdio for Stripe (explicit key control via secrets UI) and remote for Notion/Canva (their official OAuth-on-connect path avoids storing long-lived keys).

**Consequences:**
- + Registry is feature-complete at 7; remote + local + token-bridge + API-key credential shapes are all represented and tested.
- + No `ensureCuratedMcps()` changes required — remote persistence path already existed.
- - Several pins are unconfirmed (TODO-verify) and must be validated + version-pinned before release to mitigate supply-chain risk, especially the community Mailchimp package.
