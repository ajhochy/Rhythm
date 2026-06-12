# OPC-M1-2 — Persist structured messages/parts server-side (single source of truth)

**Milestone:** M1 — Foundation
**Branch:** `opc-m1-2-structured-parts-persistence`
**Depends on:** — (parallel with M1-1)

## Summary

Extend `agent_session_messages` so each row stores the full structured message — SDK message id,
role, and a `parts_json TEXT` column holding the ordered part array (the 12-type union: text,
reasoning, file, tool, step-start, step-finish, snapshot, patch, agent, subtask, retry,
compaction) plus token/cost metadata for assistant messages. The stream bridge upserts rows as
SSE events arrive; `GET /agent-sessions/:id/messages` returns the structured form.

## Motivation

Root cause 1: the prior implementation kept parts in Flutter memory only and persisted lossy
role+text rows. Every reconnect/restart silently downgraded to the legacy plain-text render
path, and every new feature had to be wired twice. This issue makes the server DB the single
durable transcript store; M1-3 makes Flutter rehydrate from it.

## Schema (idempotent migration)

```sql
ALTER TABLE agent_session_messages ADD COLUMN sdk_message_id TEXT;     -- PRAGMA-guarded
ALTER TABLE agent_session_messages ADD COLUMN parts_json TEXT;         -- JSON array of parts
ALTER TABLE agent_session_messages ADD COLUMN tokens_json TEXT;        -- {input,output,reasoning,cache} | NULL
ALTER TABLE agent_session_messages ADD COLUMN cost REAL;               -- USD | NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_asm_sdk_msg ON agent_session_messages(session_id, sdk_message_id);
```

Decision (flagged in plan open question 1): JSON column over a normalized parts table —
clients always consume whole messages; simpler upsert from `message.updated`. Legacy rows keep
`parts_json = NULL` and are served as a single synthetic text part (back-compat read shim).

## Stream bridge persistence

- `message.updated` → upsert full row (role, parts_json, tokens_json, cost) keyed by (session_id, sdk_message_id).
- `message.part.updated` / `message.part.delta` → update the in-flight row's parts_json (write-through on part.updated; deltas may batch — final state must match the SDK's message on `session.idle`).
- `message.removed` / `message.part.removed` → delete/patch accordingly.
- Because the SDK has no SSE replay, the row store is the replay.

## Likely files

- `apps/api_server/src/database/migrations.ts`
- `apps/api_server/src/repositories/agent_session_messages_repository.ts` (or current messages repo)
- `apps/api_server/src/services/opencode_stream_bridge.ts`
- `apps/api_server/src/controllers/agent_sessions_controller.ts` (messages GET)
- `apps/api_server/src/models/agent_session_message.ts`

## Acceptance criteria

1. Migration is idempotent (runs twice cleanly) and preserves existing rows (`parts_json IS NULL`).
2. Feeding the bridge a recorded v1.14.49 `message.updated` event (assistant message with text + tool + reasoning parts, tokens, cost) results in one row whose `parts_json` round-trips the part array and whose `tokens_json`/`cost` match the event.
3. A second `message.updated` for the same sdk_message_id updates the same row (no duplicates; unique index holds).
4. `GET /agent-sessions/:id/messages` returns messages ordered by creation with `parts` as a parsed array, `tokens`, `cost`; legacy NULL-parts rows come back as `[{type:'text', text:<row text>}]`.
5. `message.removed` deletes the row; `message.part.removed` removes only that part.
6. After simulating bridge restart (new bridge instance, same DB), GET still returns the full structured transcript (persistence, not memory).
7. `ai-workflow checks --level pr` exits 0.

## Required tests (vitest)

- New `opencode_parts_persistence.test.ts` over in-memory SQLite + the bridge with **recorded real SDK event fixtures** (check fixtures into `src/__tests__/fixtures/opencode_v1_14_49/`). Cover criteria 1-6.

## Out of scope

- No Flutter changes (M1-3).
- No WS protocol changes — the live WS stream is unchanged; this adds the durable store beside it.
- No backfill of legacy rows into parts (read shim only).
