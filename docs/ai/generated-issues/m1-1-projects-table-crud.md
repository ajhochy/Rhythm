# M1-1 — Backend: `projects` table + CRUD with VCS detection

**Milestone:** M1 — Sessions ↔ Projects
**Branch:** `m1-projects`
**Depends on:** —

## Summary

Add a `projects` table to the embedded API server with full CRUD and inline VCS detection (git working-tree probe) at project create / on-demand refresh. Projects are the parent entity that future agent sessions belong to (M1-2). VCS fields (`vcs_root`, `vcs_branch`, `vcs_dirty`, `vcs_checked_at`) are populated up front per the resolved Q1 decision — non-git folders are still valid projects with NULL VCS fields.

## Motivation

Every later milestone (model picker per project, file tree scoped to project, diff review against a project repo, settings overrides) assumes a session belongs to a project. We need the schema right before any UI work depends on it. VCS detection is baked in now so the sidebar can surface branch/dirty from day one (no later migration).

## Likely files

- `apps/api_server/src/database/migrations.ts` — new `CREATE TABLE IF NOT EXISTS projects`
- `apps/api_server/src/models/project.ts` — TypeScript interface
- `apps/api_server/src/repositories/projects_repository.ts` — SQLite query layer
- `apps/api_server/src/services/vcs_probe.ts` — `probeVcs(cwd): { vcsRoot, vcsBranch, vcsDirty } | null`
- `apps/api_server/src/controllers/projects_controller.ts` — request handlers
- `apps/api_server/src/routes/projects_routes.ts` — Express router
- `apps/api_server/src/app.ts` — register router
- `apps/api_server/src/__tests__/projects_routes.test.ts` — vitest suite
- `apps/api_server/src/__tests__/vcs_probe.test.ts` — vitest for the probe in isolation

## Schema

```sql
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  cwd           TEXT NOT NULL,
  icon          TEXT,           -- emoji or "#hex" color string
  vcs_root      TEXT,           -- NULL for non-git
  vcs_branch    TEXT,           -- NULL for non-git or detached HEAD
  vcs_dirty     INTEGER NOT NULL DEFAULT 0,
  vcs_checked_at TEXT,          -- ISO timestamp
  created_at    TEXT NOT NULL,
  archived_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived_at);
```

Migration is additive and idempotent.

## VCS probe contract

`probeVcs(cwd)` shells out via `/bin/zsh -lc` (same login-shell pattern used by `_findNode` in `ApiServerService`, so GUI-stripped PATH still finds `git`):

1. `git -C <cwd> rev-parse --show-toplevel` → `vcsRoot` (if non-zero exit → return `null`)
2. `git -C <cwd> symbolic-ref --quiet --short HEAD` → `vcsBranch` (empty / non-zero → `null`, e.g. detached HEAD)
3. `git -C <cwd> status --porcelain` → `vcsDirty = output.trim().length > 0`

Probe is best-effort: any exception returns `null`. No git binary on PATH → `null`. Never throws to the caller.

## Endpoints

| Method | Path | Body / Query | Response |
|---|---|---|---|
| `GET` | `/projects` | `?includeArchived=true` (default false) | `Project[]` |
| `GET` | `/projects/:id` | — | `Project` |
| `POST` | `/projects` | `{ name, cwd, icon? }` | `Project` (201, with VCS fields probed at create) |
| `PATCH` | `/projects/:id` | `{ name?, cwd?, icon?, archivedAt? }` | `Project` (re-probes VCS if `cwd` changed) |
| `DELETE` | `/projects/:id` | — | 204 (hard delete; soft archive is via PATCH archivedAt) |
| `POST` | `/projects/:id/refresh-vcs` | — | `Project` (re-runs probe, updates `vcs_*` + `vcs_checked_at`) |

`cwd` is stored as the absolute, expanded path (`expandHome` if it starts with `~`). The controller rejects relative paths with 400.

## Acceptance criteria

1. Migration runs cleanly against a fresh DB and against the existing dev DB (no data loss, idempotent).
2. `POST /projects` with a cwd that is a git repo returns the project with `vcs_root`, `vcs_branch`, `vcs_dirty` populated.
3. `POST /projects` with a cwd that is NOT a git repo returns the project with `vcs_root`, `vcs_branch` NULL and `vcs_dirty` `false`.
4. `POST /projects/:id/refresh-vcs` updates VCS fields and `vcs_checked_at`.
5. `GET /projects` returns the list in `created_at DESC` order, excluding archived rows unless `?includeArchived=true`.
6. Relative-path cwd is rejected with 400.
7. `ai-workflow checks --level pr` exits 0.

## Required tests (vitest)

`projects_routes.test.ts`:
- POST creates a project, returns 201 + VCS fields when cwd is a git repo (use the repo root itself as fixture).
- POST creates a project with NULL VCS fields when cwd is a non-git folder (use `os.tmpdir()` subdir).
- POST rejects relative path with 400.
- GET lists; GET excludes archived; GET `?includeArchived=true` includes archived.
- PATCH archivedAt soft-archives.
- PATCH cwd re-probes VCS.
- DELETE removes the row.
- POST /:id/refresh-vcs updates `vcs_checked_at` even when nothing else changed.

`vcs_probe.test.ts`:
- Returns populated fields for a git repo (probe `process.cwd()` since CI runs inside the repo).
- Returns `null` for a non-git tmp directory.
- `vcs_dirty` flips true when an untracked file is created and false after cleanup.
- Detached HEAD returns `vcs_branch === null` but `vcs_root` set.
- Missing `git` binary on PATH (mock spawn failure) returns `null` without throwing.

## Data safety / out of scope

- This issue does NOT add the `agent_sessions.project_id` FK — that's M1-2.
- No Flutter changes here; all backend.
- No production-API coupling — projects are local-only on `localhost:4001`.
- Do not auto-create projects from existing sessions; backfill is a manual decision deferred to M1-2's NULL-tolerant FK.
- Do not commit DB files, fixtures with absolute home paths, or any tester's local repo state.

## Notes

- `Project` model maps `vcs_dirty INTEGER` to `boolean` in TypeScript via `Boolean(row.vcs_dirty)`.
- Pattern matches existing `tasks_repository.ts` / `tasks_controller.ts` — copy that structure.
- Keep the controller thin; VCS logic stays in `services/vcs_probe.ts` so M1-2 (auto-assign-on-session-create) can reuse it.
