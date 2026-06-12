# Architecture Decisions

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
