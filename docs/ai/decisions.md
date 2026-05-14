# Architecture Decisions

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
