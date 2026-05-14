# M1-2 — Backend: `agent_sessions.project_id` FK + per-project listing

**Milestone:** M1 — Sessions ↔ Projects
**Branch:** `m1-projects`
**Depends on:** M1-1

## Summary

Add a nullable `project_id` column to `agent_sessions` and extend `GET /agent-sessions` with a `?projectId=X` filter. Existing sessions keep `NULL project_id` and remain visible under an "All sessions" pseudo-project on the client.

## Motivation

M1-1 created the `projects` table. To filter the sidebar session list by project (M1-5), every session needs a project pointer. NULL is intentional and supported — pre-existing sessions can't be retroactively assigned without guessing, so the UI shows them under "All sessions" until the user re-creates them inside a project.

## Likely files

- `apps/api_server/src/database/migrations.ts` — `ALTER TABLE agent_sessions ADD COLUMN project_id TEXT` (idempotent guard)
- `apps/api_server/src/models/agent_session.ts` — add `projectId: string | null`
- `apps/api_server/src/repositories/agent_sessions_repository.ts` — accept `projectId` filter in `listActive` / `list`; persist `project_id` on insert
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — read `req.query.projectId`, pass through
- `apps/api_server/src/__tests__/agent_sessions.test.ts` — extend existing suite

## Schema

```sql
-- Idempotent: skip if column already exists (check via PRAGMA table_info)
ALTER TABLE agent_sessions ADD COLUMN project_id TEXT REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id);
```

`REFERENCES` is informational in SQLite without `PRAGMA foreign_keys=ON` (we currently leave it off). Hard FK enforcement is deferred — the index gives the perf benefit, and ON DELETE cascade is left to a future cleanup pass.

## Endpoints

- `GET /agent-sessions` — accepts optional `?projectId=<id>` query.
  - When present: returns only sessions where `project_id = ?`.
  - When absent: existing behavior unchanged (returns all sessions, including NULL).
  - `?projectId=null` (literal string `null`) returns only sessions with `project_id IS NULL` (i.e. the "All sessions / unassigned" pseudo-project bucket).
- `POST /agent-sessions` — accepts optional `projectId` in body; persists to the new column. M1-3 will add cwd-based auto-assignment when omitted.

## Acceptance criteria

1. Migration runs cleanly on a fresh DB and on an existing dev DB where `agent_sessions` already has rows; pre-existing rows keep `project_id = NULL`.
2. `GET /agent-sessions` without query returns all sessions (unchanged from today).
3. `GET /agent-sessions?projectId=<existing-id>` returns only that project's sessions.
4. `GET /agent-sessions?projectId=null` returns only sessions with `project_id IS NULL`.
5. `POST /agent-sessions` with `projectId` in body persists it; without it, persists NULL (M1-3 will refine this).
6. `ai-workflow checks --level pr` exits 0.

## Required tests (vitest)

Extend `agent_sessions.test.ts`:
- Existing tests continue to pass with `project_id = NULL`.
- New: POST with `projectId` persists and is returned by GET.
- New: GET `?projectId=<id>` filters correctly.
- New: GET `?projectId=null` returns only NULL-project sessions.
- New: POST without `projectId` persists NULL (assertion explicitly checks for `projectId === null` in response).
- New: migration is idempotent — calling it twice on the same DB is a no-op.

## Data safety / out of scope

- Do NOT add auto-assignment-by-cwd in this issue; that's M1-3.
- Do NOT add hard FK enforcement (`PRAGMA foreign_keys=ON`) — risk of breaking existing rows during dev.
- Do NOT cascade-delete sessions on project archive; archive is a UI-only filter for now.
- No Flutter changes here.

## Notes

- `agent_sessions` already has `cwd` stored — M1-3 reads that to pick a project; no schema change needed for that step.
- Repository pattern: add `projectId?: string | null` to the list filter type alongside the existing filters.
