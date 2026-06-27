# P1-1: agent_skills table (both DBs) + repository

## Goal

Create the `agent_skills` table in BOTH SQLite and Postgres with identical schemas. Implement `AgentSkillsRepository` with type-safe CRUD operations and a helper to increment usage counts. This is the foundational store for all downstream phases (P0-2 seed, P2-1 extractor, P3-1 retrieval, P4-1 teacher-escalation).

## Context

The skill library must live on the local agent DB (SQLite for dev/test, Postgres for prod). Per repo memory "Postgres/SQLite schema drift," both migrations MUST be identical—missing columns on one DB will cause 500 errors and regression test failures.

The table is similar to `agent_memory` (FTS5-style pattern) but simpler: no owner scoping (shared instance-wide), and the retrieval scoring is deferred to the service layer (P3-1) rather than embedded in the table.

## Likely files

- `apps/api_server/src/database/migrations.ts` (SQLite)
- `apps/api_server/src/database/postgres_bootstrap.ts` (Postgres)
- NEW `apps/api_server/src/repositories/agent_skills_repository.ts`
- NEW `apps/api_server/src/models/agent_skill.ts`

## Acceptance Criteria

- [ ] **Schema parity:** `agent_skills` table created in BOTH `migrations.ts` (SQLite block) and `postgres_bootstrap.ts` (Postgres block) with identical columns:
  - `id` (PRIMARY KEY, auto-increment/uuid)
  - `title` (TEXT NOT NULL, unique constraint or dedup enforcement)
  - `when_to_use` (TEXT, nullable)
  - `description` (TEXT, nullable)
  - `steps_json` (TEXT, nullable, JSON array)
  - `tags_json` (TEXT, nullable, JSON array)
  - `confidence` (REAL, default 0.0)
  - `status` (TEXT, CHECK in ['draft', 'published'], default 'draft')
  - `source` (TEXT, e.g., 'agent-stack-seed', 'teacher-escalation', 'auto-extract')
  - `uses` (INTEGER, DEFAULT 0)
  - `created_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
  - `updated_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
  - **NO `owner_user_id`** (shared instance-wide)
- [ ] **TypeScript model:** `AgentSkill` interface in `models/agent_skill.ts` matches all columns; includes `fromJson` / `toJson` helpers.
- [ ] **Repository CRUD:** `AgentSkillsRepository` provides:
  - `create(skill: Partial<AgentSkill>): Promise<AgentSkill>`
  - `get(id: string): Promise<AgentSkill | null>`
  - `list(): Promise<AgentSkill[]>` (filters can be added in phases 3-4)
  - `update(id: string, skill: Partial<AgentSkill>): Promise<AgentSkill>`
  - `delete(id: string): Promise<boolean>`
  - `incrementUses(id: string): Promise<void>`
  - Helper `findByTitle(title: string): Promise<AgentSkill | null>` for P0-2 dedup
- [ ] **No regression:** `tsc --noEmit && npx vitest run` passes with baseline 966+ tests still passing.
- [ ] **Empty DB gate:** vitest includes a test that `GET /agent-skills` (added in P1-2) returns `[]` on an empty SQLite DB (not a 500 error).

## Dependencies

None. This is the foundational phase 1 task.

## Out of Scope

- FTS5 indexing (skills retrieval scoring is deferred to service layer in P3-1).
- Owner/user scoping (all skills are shared instance-wide).
- Retrieval/filtering logic (belongs in P3-1).
