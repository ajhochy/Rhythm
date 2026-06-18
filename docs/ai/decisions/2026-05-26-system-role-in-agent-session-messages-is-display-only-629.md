---
date: 2026-05-26
repo: rhythm
tags: [decision, rhythm]
---

# system role in agent_session_messages is display-only (#629)

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
