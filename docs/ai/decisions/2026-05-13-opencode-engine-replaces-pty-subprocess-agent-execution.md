---
index: "[[Rhythm]]"
date: 2026-05-13
repo: rhythm
tags: [decision, rhythm]
---

# Opencode engine replaces PTY subprocess agent execution

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
