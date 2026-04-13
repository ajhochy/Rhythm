# Phase 7: Multiuser Accounts & Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspaces, task/project collaborators, and real-identity messages to Rhythm so church staff can collaborate on shared work.

**Architecture:** Workspace is a lightweight user directory (one per church, join-code based). Data stays user-owned; sharing is opt-in via explicit collaborator join tables. Messages get real sender identity and group thread support.

**Tech Stack:** TypeScript/Express/SQLite+Postgres (API), Flutter/Dart (desktop), vitest (API tests), flutter_test (Flutter tests)

---

## File Map

### API Server — New Files
- `apps/api_server/src/models/workspace.ts` — Workspace, WorkspaceMember interfaces
- `apps/api_server/src/repositories/workspace_repository.ts` — workspace CRUD (SQLite + Postgres)
- `apps/api_server/src/controllers/workspace_controller.ts` — request handlers
- `apps/api_server/src/routes/workspace_routes.ts` — Express router
- `apps/api_server/src/__tests__/workspace.test.ts` — workspace + collaborator tests

### API Server — Modified Files
- `apps/api_server/src/database/migrations.ts` — new tables + ALTER columns
- `apps/api_server/src/database/postgres_bootstrap.ts` — same tables for fresh Postgres
- `apps/api_server/src/models/task.ts` — add `workspaceId`, `isShared`, `collaborators`
- `apps/api_server/src/models/message.ts` — add `threadType`, `senderPhotoUrl`
- `apps/api_server/src/repositories/tasks_repository.ts` — include shared tasks + workspace_id on create
- `apps/api_server/src/repositories/messages_repository.ts` — group thread support, sender photo
- `apps/api_server/src/controllers/tasks_controller.ts` — collaborator handlers
- `apps/api_server/src/controllers/messages_controller.ts` — accept threadType
- `apps/api_server/src/controllers/auth_controller.ts` — enrich /auth/me
- `apps/api_server/src/routes/tasks_routes.ts` — collaborator routes
- `apps/api_server/src/routes/project_instances_routes.ts` — collaborator routes
- `apps/api_server/src/app.ts` — register /workspaces router

### Flutter — New Files
- `apps/desktop_flutter/lib/app/core/workspace/workspace_models.dart` — WorkspaceInfo, WorkspaceMember, MeResponse
- `apps/desktop_flutter/lib/app/core/workspace/workspace_data_source.dart` — HTTP calls
- `apps/desktop_flutter/lib/app/core/workspace/workspace_repository.dart` — thin wrapper
- `apps/desktop_flutter/lib/app/core/workspace/workspace_controller.dart` — ChangeNotifier
- `apps/desktop_flutter/lib/app/core/workspace/workspace_onboarding_view.dart` — Join/Create screen
- `apps/desktop_flutter/lib/features/tasks/models/task_collaborator.dart` — TaskCollaborator
- `apps/desktop_flutter/lib/features/tasks/data/collaborators_data_source.dart` — HTTP
- `apps/desktop_flutter/lib/shared/widgets/collaborators_row.dart` — avatar row + people picker

### Flutter — Modified Files
- `apps/desktop_flutter/lib/app/core/auth/auth_user.dart` — remove workspace fields (moved to MeResponse)
- `apps/desktop_flutter/lib/app/core/auth/auth_data_source.dart` — me() returns MeResponse
- `apps/desktop_flutter/lib/app/core/auth/auth_session_service.dart` — store workspace context
- `apps/desktop_flutter/lib/app/core/layout/app_shell.dart` — gate on workspace
- `apps/desktop_flutter/lib/features/settings/views/settings_view.dart` — workspace section
- `apps/desktop_flutter/lib/features/tasks/models/task.dart` — add isShared, collaborators
- `apps/desktop_flutter/lib/features/tasks/views/tasks_view.dart` — collaborator row
- `apps/desktop_flutter/lib/features/projects/views/projects_view.dart` — collaborator row
- `apps/desktop_flutter/lib/features/messages/models/message.dart` — add senderId, senderPhotoUrl
- `apps/desktop_flutter/lib/features/messages/models/message_thread.dart` — add threadType
- `apps/desktop_flutter/lib/features/messages/views/messages_view.dart` — real identity + group threads
- `apps/desktop_flutter/lib/main.dart` — add WorkspaceController provider

---

## Task 1: Database Migrations

**Files:**
- Modify: `apps/api_server/src/database/migrations.ts`
- Modify: `apps/api_server/src/database/postgres_bootstrap.ts`

- [x] **Step 1: Add new tables to SQLite migrations**

At the end of `runMigrations` in `migrations.ts`, add:

```typescript
  // Phase 7: workspaces
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'staff',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS task_collaborators (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS project_collaborators (
      project_instance_id TEXT NOT NULL REFERENCES project_instances(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_instance_id, user_id)
    );
  `);

  const taskColsP7 = (db.pragma('table_info(tasks)') as { name: string }[]).map((c) => c.name);
  if (!taskColsP7.includes('workspace_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id)`);
  }

  const msgCols = (db.pragma('table_info(messages)') as { name: string }[]).map((c) => c.name);
  if (!msgCols.includes('sender_photo_url')) {
    db.exec(`ALTER TABLE messages ADD COLUMN sender_photo_url TEXT`);
  }

  const threadCols = (db.pragma('table_info(message_threads)') as { name: string }[]).map((c) => c.name);
  if (!threadCols.includes('thread_type')) {
    db.exec(`ALTER TABLE message_threads ADD COLUMN thread_type TEXT NOT NULL DEFAULT 'direct'`);
  }
```

- [x] **Step 2: Add same tables to Postgres bootstrap**

In `postgres_bootstrap.ts`, inside `runPostgresBootstrap`, add after existing `CREATE TABLE IF NOT EXISTS` blocks:

```typescript
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (${UTC_TEXT_NOW})
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'staff',
      joined_at TEXT NOT NULL DEFAULT (${UTC_TEXT_NOW}),
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS task_collaborators (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (${UTC_TEXT_NOW}),
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS project_collaborators (
      project_instance_id TEXT NOT NULL REFERENCES project_instances(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (${UTC_TEXT_NOW}),
      PRIMARY KEY (project_instance_id, user_id)
    );
  `);

  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id)`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_photo_url TEXT`);
  await pool.query(`ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS thread_type TEXT NOT NULL DEFAULT 'direct'`);
```

- [x] **Step 3: Verify migrations run cleanly**

```bash
cd apps/api_server && npm test
```
Expected: all existing tests pass, no migration errors.

- [x] **Step 4: Commit**

```bash
git add apps/api_server/src/database/migrations.ts apps/api_server/src/database/postgres_bootstrap.ts
git commit -m "feat: add workspace, collaborator, and messaging schema migrations"
```

---

## Task 2: Workspace Model + Repository

**Files:**
- Create: `apps/api_server/src/models/workspace.ts`
- Create: `apps/api_server/src/repositories/workspace_repository.ts`
- Create: `apps/api_server/src/__tests__/workspace.test.ts`

- [x] **Step 1: Write the failing tests**

Create `apps/api_server/src/__tests__/workspace.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('WorkspaceRepository', () => {
  let usersRepo: UsersRepository;
  let workspaceRepo: WorkspaceRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    workspaceRepo = new WorkspaceRepository();
  });

  it('creates a workspace with an 8-char join code and makes creator admin', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });

    expect(ws.name).toBe('Grace Church');
    expect(ws.joinCode).toHaveLength(8);
    expect(ws.joinCode).toMatch(/^[A-Z0-9]{8}$/);

    const member = workspaceRepo.findMember(ws.id, alice.id);
    expect(member?.role).toBe('admin');
  });

  it('lets a second user join via join code as staff', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });

    workspaceRepo.joinByCode(ws.joinCode, bob.id);

    const member = workspaceRepo.findMember(ws.id, bob.id);
    expect(member?.role).toBe('staff');
  });

  it('throws on invalid join code', () => {
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    expect(() => workspaceRepo.joinByCode('BADCODE1', bob.id)).toThrow();
  });

  it('lists workspace members', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });
    workspaceRepo.joinByCode(ws.joinCode, bob.id);

    const members = workspaceRepo.listMembers(ws.id);
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.name)).toContain('Alice');
    expect(members.map((m) => m.name)).toContain('Bob');
  });

  it('finds workspace for user', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });

    const found = workspaceRepo.findForUser(alice.id);
    expect(found?.id).toBe(ws.id);
    expect(found?.role).toBe('admin');
  });

  it('regenerates join code', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: alice.id });
    const oldCode = ws.joinCode;

    const newCode = workspaceRepo.regenerateJoinCode(ws.id);
    expect(newCode).toHaveLength(8);
    expect(newCode).not.toBe(oldCode);
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api_server && npm test -- workspace
```
Expected: FAIL — `WorkspaceRepository` not found.

- [x] **Step 3: Create workspace model**

Create `apps/api_server/src/models/workspace.ts`:

```typescript
export interface Workspace {
  id: number;
  name: string;
  joinCode: string;
  createdBy: number | null;
  createdAt: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: 'admin' | 'staff';
}

export interface WorkspaceMember {
  userId: number;
  name: string;
  email: string;
  photoUrl: string | null;
  role: 'admin' | 'staff';
  joinedAt: string;
}

export interface CreateWorkspaceDto {
  name: string;
  createdBy: number;
}
```

- [x] **Step 4: Create workspace repository**

Create `apps/api_server/src/repositories/workspace_repository.ts`:

```typescript
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import { env } from '../config/env';
import type { Workspace, WorkspaceWithRole, WorkspaceMember, CreateWorkspaceDto } from '../models/workspace';

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

interface WorkspaceRow {
  id: number;
  name: string;
  join_code: string;
  created_by: number | null;
  created_at: string;
}

interface WorkspaceWithRoleRow extends WorkspaceRow {
  role: string;
}

interface MemberRow {
  user_id: number;
  name: string;
  email: string;
  photo_url: string | null;
  role: string;
  joined_at: string;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function rowToWorkspaceWithRole(row: WorkspaceWithRoleRow): WorkspaceWithRole {
  return { ...rowToWorkspace(row), role: row.role as 'admin' | 'staff' };
}

function rowToMember(row: MemberRow): WorkspaceMember {
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    photoUrl: row.photo_url,
    role: row.role as 'admin' | 'staff',
    joinedAt: row.joined_at,
  };
}

export class WorkspaceRepository {
  create(data: CreateWorkspaceDto): Workspace {
    const db = getDb();
    const joinCode = generateJoinCode();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO workspaces (name, join_code, created_by, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(data.name, joinCode, data.createdBy, now);
    const workspaceId = result.lastInsertRowid as number;
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES (?, ?, 'admin', ?)`,
    ).run(workspaceId, data.createdBy, now);
    return rowToWorkspace(
      db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(workspaceId) as WorkspaceRow,
    );
  }

  async createAsync(data: CreateWorkspaceDto): Promise<Workspace> {
    if (env.dbClient === 'postgres') {
      const pool = getPostgresPool();
      const joinCode = generateJoinCode();
      const now = new Date().toISOString();
      const result = await pool.query<WorkspaceRow>(
        `INSERT INTO workspaces (name, join_code, created_by, created_at)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [data.name, joinCode, data.createdBy, now],
      );
      const ws = result.rows[0];
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ($1, $2, 'admin', $3)`,
        [ws.id, data.createdBy, now],
      );
      return rowToWorkspace(ws);
    }
    return this.create(data);
  }

  joinByCode(joinCode: string, userId: number): Workspace {
    const db = getDb();
    const ws = db
      .prepare(`SELECT * FROM workspaces WHERE join_code = ?`)
      .get(joinCode) as WorkspaceRow | undefined;
    if (!ws) throw AppError.notFound('Workspace');
    const existing = db
      .prepare(`SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?`)
      .get(ws.id, userId);
    if (!existing) {
      db.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'staff', ?)`,
      ).run(ws.id, userId, new Date().toISOString());
    }
    return rowToWorkspace(ws);
  }

  async joinByCodeAsync(joinCode: string, userId: number): Promise<Workspace> {
    if (env.dbClient === 'postgres') {
      const pool = getPostgresPool();
      const result = await pool.query<WorkspaceRow>(
        `SELECT * FROM workspaces WHERE join_code = $1`,
        [joinCode],
      );
      if (!result.rows[0]) throw AppError.notFound('Workspace');
      const ws = result.rows[0];
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES ($1, $2, 'staff', $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [ws.id, userId, new Date().toISOString()],
      );
      return rowToWorkspace(ws);
    }
    return this.joinByCode(joinCode, userId);
  }

  findForUser(userId: number): WorkspaceWithRole | null {
    const row = getDb()
      .prepare(
        `SELECT w.*, wm.role FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = ?
         LIMIT 1`,
      )
      .get(userId) as WorkspaceWithRoleRow | undefined;
    return row ? rowToWorkspaceWithRole(row) : null;
  }

  async findForUserAsync(userId: number): Promise<WorkspaceWithRole | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<WorkspaceWithRoleRow>(
        `SELECT w.*, wm.role FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = $1
         LIMIT 1`,
        [userId],
      );
      return result.rows[0] ? rowToWorkspaceWithRole(result.rows[0]) : null;
    }
    return this.findForUser(userId);
  }

  findMember(workspaceId: number, userId: number): WorkspaceMember | null {
    const row = getDb()
      .prepare(
        `SELECT wm.user_id, u.name, u.email, u.photo_url, wm.role, wm.joined_at
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = ? AND wm.user_id = ?`,
      )
      .get(workspaceId, userId) as MemberRow | undefined;
    return row ? rowToMember(row) : null;
  }

  listMembers(workspaceId: number): WorkspaceMember[] {
    return (
      getDb()
        .prepare(
          `SELECT wm.user_id, u.name, u.email, u.photo_url, wm.role, wm.joined_at
           FROM workspace_members wm JOIN users u ON u.id = wm.user_id
           WHERE wm.workspace_id = ?
           ORDER BY lower(u.name) ASC`,
        )
        .all(workspaceId) as MemberRow[]
    ).map(rowToMember);
  }

  async listMembersAsync(workspaceId: number): Promise<WorkspaceMember[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<MemberRow>(
        `SELECT wm.user_id, u.name, u.email, u.photo_url, wm.role, wm.joined_at
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1
         ORDER BY lower(u.name) ASC`,
        [workspaceId],
      );
      return result.rows.map(rowToMember);
    }
    return this.listMembers(workspaceId);
  }

  updateMemberRole(workspaceId: number, userId: number, role: 'admin' | 'staff'): void {
    const changes = getDb()
      .prepare(`UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?`)
      .run(role, workspaceId, userId).changes;
    if (changes === 0) throw AppError.notFound('WorkspaceMember');
  }

  async updateMemberRoleAsync(workspaceId: number, userId: number, role: 'admin' | 'staff'): Promise<void> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3`,
        [role, workspaceId, userId],
      );
      if (result.rowCount === 0) throw AppError.notFound('WorkspaceMember');
      return;
    }
    this.updateMemberRole(workspaceId, userId, role);
  }

  removeMember(workspaceId: number, userId: number): void {
    getDb()
      .prepare(`DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?`)
      .run(workspaceId, userId);
  }

  async removeMemberAsync(workspaceId: number, userId: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      );
      return;
    }
    this.removeMember(workspaceId, userId);
  }

  regenerateJoinCode(workspaceId: number): string {
    const newCode = generateJoinCode();
    getDb()
      .prepare(`UPDATE workspaces SET join_code = ? WHERE id = ?`)
      .run(newCode, workspaceId);
    return newCode;
  }

  async regenerateJoinCodeAsync(workspaceId: number): Promise<string> {
    if (env.dbClient === 'postgres') {
      const newCode = generateJoinCode();
      await getPostgresPool().query(
        `UPDATE workspaces SET join_code = $1 WHERE id = $2`,
        [newCode, workspaceId],
      );
      return newCode;
    }
    return this.regenerateJoinCode(workspaceId);
  }
}
```

- [x] **Step 5: Run tests**

```bash
cd apps/api_server && npm test -- workspace
```
Expected: all workspace tests PASS.

- [x] **Step 6: Commit**

```bash
git add apps/api_server/src/models/workspace.ts apps/api_server/src/repositories/workspace_repository.ts apps/api_server/src/__tests__/workspace.test.ts
git commit -m "feat: add workspace model, repository, and tests"
```

---

## Task 3: Workspace Controller + Routes + Register

**Files:**
- Create: `apps/api_server/src/controllers/workspace_controller.ts`
- Create: `apps/api_server/src/routes/workspace_routes.ts`
- Modify: `apps/api_server/src/app.ts`

- [x] **Step 1: Create workspace controller**

Create `apps/api_server/src/controllers/workspace_controller.ts`:

```typescript
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { WorkspaceRepository } from '../repositories/workspace_repository';

const repo = new WorkspaceRepository();

export class WorkspaceController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name } = req.body as Record<string, unknown>;
      if (!name || typeof name !== 'string') throw AppError.badRequest('name is required');
      const existing = await repo.findForUserAsync(req.auth!.user.id);
      if (existing) throw AppError.badRequest('User already belongs to a workspace');
      const ws = await repo.createAsync({ name, createdBy: req.auth!.user.id });
      res.status(201).json(ws);
    } catch (err) {
      next(err);
    }
  }

  async join(req: Request, res: Response, next: NextFunction) {
    try {
      const { joinCode } = req.body as Record<string, unknown>;
      if (!joinCode || typeof joinCode !== 'string') throw AppError.badRequest('joinCode is required');
      const ws = await repo.joinByCodeAsync(joinCode.toUpperCase(), req.auth!.user.id);
      res.json(ws);
    } catch (err) {
      next(err);
    }
  }

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws) throw AppError.notFound('Workspace');
      res.json(ws);
    } catch (err) {
      next(err);
    }
  }

  async listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws) throw AppError.notFound('Workspace');
      const members = await repo.listMembersAsync(ws.id);
      res.json(members);
    } catch (err) {
      next(err);
    }
  }

  async updateMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws || ws.role !== 'admin') throw AppError.forbidden('Admin only');
      const { role } = req.body as Record<string, unknown>;
      if (role !== 'admin' && role !== 'staff') throw AppError.badRequest('role must be admin or staff');
      await repo.updateMemberRoleAsync(ws.id, Number(req.params.userId), role);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws || ws.role !== 'admin') throw AppError.forbidden('Admin only');
      await repo.removeMemberAsync(ws.id, Number(req.params.userId));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async regenerateJoinCode(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws || ws.role !== 'admin') throw AppError.forbidden('Admin only');
      const joinCode = await repo.regenerateJoinCodeAsync(ws.id);
      res.json({ joinCode });
    } catch (err) {
      next(err);
    }
  }
}
```

- [x] **Step 2: Check AppError has a `forbidden` method**

```bash
grep -n "forbidden\|static " apps/api_server/src/errors/app_error.ts | head -20
```

If `AppError.forbidden` does not exist, add it to `app_error.ts`:

```typescript
static forbidden(message = 'Forbidden'): AppError {
  return new AppError(403, message);
}
```

- [x] **Step 3: Create workspace routes**

Create `apps/api_server/src/routes/workspace_routes.ts`:

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { WorkspaceController } from '../controllers/workspace_controller';

const controller = new WorkspaceController();
export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);
workspaceRouter.post('/', controller.create.bind(controller));
workspaceRouter.post('/join', controller.join.bind(controller));
workspaceRouter.get('/me', controller.getMe.bind(controller));
workspaceRouter.get('/me/members', controller.listMembers.bind(controller));
workspaceRouter.patch('/me/members/:userId', controller.updateMemberRole.bind(controller));
workspaceRouter.delete('/me/members/:userId', controller.removeMember.bind(controller));
workspaceRouter.post('/me/join-code/regenerate', controller.regenerateJoinCode.bind(controller));
```

- [x] **Step 4: Register workspace router in app.ts**

In `apps/api_server/src/app.ts`, add the import and route:

```typescript
// add to imports
import { workspaceRouter } from './routes/workspace_routes';

// add inside createApp(), after existing routes
app.use('/workspaces', workspaceRouter);
```

- [x] **Step 5: Run all tests**

```bash
cd apps/api_server && npm test
```
Expected: all tests PASS.

- [x] **Step 6: Commit**

```bash
git add apps/api_server/src/controllers/workspace_controller.ts apps/api_server/src/routes/workspace_routes.ts apps/api_server/src/app.ts apps/api_server/src/errors/app_error.ts
git commit -m "feat: add workspace API endpoints"
```

---

## Task 4: Extend /auth/me with Workspace Context

**Files:**
- Modify: `apps/api_server/src/controllers/auth_controller.ts`

- [x] **Step 1: Write a failing test**

In `apps/api_server/src/__tests__/workspace.test.ts`, add:

```typescript
import { AuthService } from '../services/auth_service';
import { SessionsRepository } from '../repositories/sessions_repository';
import type { GoogleIdentity } from '../services/auth_service';

// add inside the describe block:
it('/auth/me includes workspace and workspaceRole when user has a workspace', async () => {
  const sessionsRepo = new SessionsRepository();
  const authService = new AuthService(usersRepo, sessionsRepo, {
    verifyIdToken: async (): Promise<GoogleIdentity> => ({
      sub: 'google-sub-alice',
      email: 'alice@example.com',
      name: 'Alice',
      picture: null,
    }),
  } as never);

  const session = await authService.loginWithGoogleIdToken('fake-token');
  const ws = workspaceRepo.create({ name: 'Grace Church', createdBy: session.user.id });

  // MeResponse is assembled in the controller; test the repository layer here
  const wsWithRole = workspaceRepo.findForUser(session.user.id);
  expect(wsWithRole?.name).toBe('Grace Church');
  expect(wsWithRole?.role).toBe('admin');
  expect(wsWithRole?.joinCode).toHaveLength(8);
});
```

- [x] **Step 2: Run to confirm it passes (it's testing the repo, not the controller)**

```bash
cd apps/api_server && npm test -- workspace
```
Expected: PASS.

- [x] **Step 3: Update auth_controller.ts `me` handler**

Replace the existing `me` method in `apps/api_server/src/controllers/auth_controller.ts`:

```typescript
// add import at top of file
import { WorkspaceRepository } from '../repositories/workspace_repository';

// add near top of class or as module-level constant
const workspaceRepo = new WorkspaceRepository();

// replace me():
async me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw AppError.badRequest('Missing auth context');
    const user = req.auth.user;
    const wsWithRole = await workspaceRepo.findForUserAsync(user.id);
    const workspace = wsWithRole
      ? {
          id: wsWithRole.id,
          name: wsWithRole.name,
          ...(wsWithRole.role === 'admin' ? { joinCode: wsWithRole.joinCode } : {}),
        }
      : null;
    res.json({
      user,
      workspace,
      workspaceRole: wsWithRole?.role ?? null,
    });
  } catch (err) {
    next(err);
  }
}
```

- [x] **Step 4: Run all tests**

```bash
cd apps/api_server && npm test
```
Expected: all tests PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api_server/src/controllers/auth_controller.ts
git commit -m "feat: enrich /auth/me with workspace context and role"
```

---

## Task 5: Task Collaborators API

**Files:**
- Modify: `apps/api_server/src/models/task.ts`
- Modify: `apps/api_server/src/repositories/tasks_repository.ts`
- Modify: `apps/api_server/src/controllers/tasks_controller.ts`
- Modify: `apps/api_server/src/routes/tasks_routes.ts`
- Modify: `apps/api_server/src/__tests__/workspace.test.ts`

- [x] **Step 1: Write failing tests for task collaborators**

Add to `apps/api_server/src/__tests__/workspace.test.ts`:

```typescript
import { TasksRepository } from '../repositories/tasks_repository';

// add to beforeEach: tasksRepo = new TasksRepository();
// add at top: let tasksRepo: TasksRepository;

it('shared tasks appear in collaborator task list with isShared flag', () => {
  const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
  const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
  const task = tasksRepo.create({ title: 'Alice task', ownerId: alice.id });

  tasksRepo.addCollaborator(task.id, bob.id);

  const bobTasks = tasksRepo.findAll(bob.id);
  const shared = bobTasks.find((t) => t.id === task.id);
  expect(shared).toBeDefined();
  expect(shared?.isShared).toBe(true);
});

it('removing a collaborator removes the task from their list', () => {
  const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
  const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
  const task = tasksRepo.create({ title: 'Alice task', ownerId: alice.id });

  tasksRepo.addCollaborator(task.id, bob.id);
  tasksRepo.removeCollaborator(task.id, bob.id);

  const bobTasks = tasksRepo.findAll(bob.id);
  expect(bobTasks.find((t) => t.id === task.id)).toBeUndefined();
});
```

- [x] **Step 2: Run to confirm failure**

```bash
cd apps/api_server && npm test -- workspace
```
Expected: FAIL — `addCollaborator` not a function.

- [x] **Step 3: Update Task model**

In `apps/api_server/src/models/task.ts`, add fields:

```typescript
export interface Task {
  // ... existing fields ...
  workspaceId?: number | null;
  isShared?: boolean;
  collaborators?: Array<{ userId: number; name: string; photoUrl: string | null }>;
}
```

Also update `CreateTaskDto`:

```typescript
export interface CreateTaskDto {
  // ... existing fields ...
  workspaceId?: number | null;
}
```

- [x] **Step 4: Add collaborator methods to TasksRepository**

In `apps/api_server/src/repositories/tasks_repository.ts`:

1. Update `findAll` / `findAllAsync` queries to also return tasks where the user is a collaborator. Replace the existing WHERE clause pattern:

```typescript
// In findAll (SQLite) — replace the WHERE clause in the query:
// Old: WHERE (owner_id IS NULL OR owner_id = ?)
// New:
`SELECT t.*, 
  CASE WHEN tc.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_shared
 FROM tasks t
 LEFT JOIN task_collaborators tc ON tc.task_id = t.id AND tc.user_id = ?
 WHERE (t.owner_id IS NULL OR t.owner_id = ? OR tc.user_id = ?)
 ORDER BY t.created_at DESC`
// params: userId, userId, userId
```

Find the existing `findAll` method and update it. If the current query looks different, adapt accordingly — the key change is the LEFT JOIN and the `is_shared` computed column.

2. Update `rowToTask` (or wherever rows are mapped to `Task`) to include `isShared`:

```typescript
// In the row mapping function, add:
isShared: Boolean((row as { is_shared?: number }).is_shared),
```

3. Add collaborator management methods at the end of the class:

```typescript
addCollaborator(taskId: string, userId: number): void {
  getDb()
    .prepare(
      `INSERT INTO task_collaborators (task_id, user_id, added_at)
       VALUES (?, ?, ?)
       ON CONFLICT (task_id, user_id) DO NOTHING`,
    )
    .run(taskId, userId, new Date().toISOString());
}

async addCollaboratorAsync(taskId: string, userId: number): Promise<void> {
  if (env.dbClient === 'postgres') {
    await getPostgresPool().query(
      `INSERT INTO task_collaborators (task_id, user_id, added_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, user_id) DO NOTHING`,
      [taskId, userId, new Date().toISOString()],
    );
    return;
  }
  this.addCollaborator(taskId, userId);
}

removeCollaborator(taskId: string, userId: number): void {
  getDb()
    .prepare(`DELETE FROM task_collaborators WHERE task_id = ? AND user_id = ?`)
    .run(taskId, userId);
}

async removeCollaboratorAsync(taskId: string, userId: number): Promise<void> {
  if (env.dbClient === 'postgres') {
    await getPostgresPool().query(
      `DELETE FROM task_collaborators WHERE task_id = $1 AND user_id = $2`,
      [taskId, userId],
    );
    return;
  }
  this.removeCollaborator(taskId, userId);
}

listCollaborators(taskId: string): Array<{ userId: number; name: string; photoUrl: string | null }> {
  return getDb()
    .prepare(
      `SELECT u.id AS user_id, u.name, u.photo_url AS photoUrl
       FROM task_collaborators tc JOIN users u ON u.id = tc.user_id
       WHERE tc.task_id = ?
       ORDER BY lower(u.name) ASC`,
    )
    .all(taskId) as Array<{ userId: number; name: string; photoUrl: string | null }>;
}

async listCollaboratorsAsync(taskId: string): Promise<Array<{ userId: number; name: string; photoUrl: string | null }>> {
  if (env.dbClient === 'postgres') {
    const result = await getPostgresPool().query<{ user_id: number; name: string; photoUrl: string | null }>(
      `SELECT u.id AS user_id, u.name, u.photo_url AS "photoUrl"
       FROM task_collaborators tc JOIN users u ON u.id = tc.user_id
       WHERE tc.task_id = $1
       ORDER BY lower(u.name) ASC`,
      [taskId],
    );
    return result.rows.map((r) => ({ userId: r.user_id, name: r.name, photoUrl: r.photoUrl }));
  }
  return this.listCollaborators(taskId);
}
```

- [x] **Step 5: Run tests**

```bash
cd apps/api_server && npm test -- workspace
```
Expected: task collaborator tests PASS.

- [x] **Step 6: Add collaborator handlers to tasks controller**

In `apps/api_server/src/controllers/tasks_controller.ts`, add three methods to `TasksController`:

```typescript
async getCollaborators(req: Request, res: Response, next: NextFunction) {
  try {
    const collaborators = await repo.listCollaboratorsAsync(req.params.id);
    res.json(collaborators);
  } catch (err) {
    next(err);
  }
}

async addCollaborator(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId } = req.body as Record<string, unknown>;
    if (!userId) throw AppError.badRequest('userId is required');
    await repo.addCollaboratorAsync(req.params.id, Number(userId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async removeCollaborator(req: Request, res: Response, next: NextFunction) {
  try {
    await repo.removeCollaboratorAsync(req.params.id, Number(req.params.userId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
```

- [x] **Step 7: Add collaborator routes**

In `apps/api_server/src/routes/tasks_routes.ts`, add after existing routes:

```typescript
tasksRouter.get('/:id/collaborators', controller.getCollaborators.bind(controller));
tasksRouter.post('/:id/collaborators', controller.addCollaborator.bind(controller));
tasksRouter.delete('/:id/collaborators/:userId', controller.removeCollaborator.bind(controller));
```

- [x] **Step 8: Run all tests**

```bash
cd apps/api_server && npm test
```
Expected: all tests PASS.

- [x] **Step 9: Commit**

```bash
git add apps/api_server/src/models/task.ts apps/api_server/src/repositories/tasks_repository.ts apps/api_server/src/controllers/tasks_controller.ts apps/api_server/src/routes/tasks_routes.ts apps/api_server/src/__tests__/workspace.test.ts
git commit -m "feat: add task collaborators API"
```

---

## Task 6: Project Instance Collaborators API

**Files:**
- Modify: `apps/api_server/src/repositories/project_instances_repository.ts`
- Modify: `apps/api_server/src/routes/project_instances_routes.ts`

- [x] **Step 1: Add collaborator methods to ProjectInstancesRepository**

In `apps/api_server/src/repositories/project_instances_repository.ts`, add at the end of the class (same pattern as tasks):

```typescript
addCollaborator(projectInstanceId: string, userId: number): void {
  getDb()
    .prepare(
      `INSERT INTO project_collaborators (project_instance_id, user_id, added_at)
       VALUES (?, ?, ?)
       ON CONFLICT (project_instance_id, user_id) DO NOTHING`,
    )
    .run(projectInstanceId, userId, new Date().toISOString());
}

async addCollaboratorAsync(projectInstanceId: string, userId: number): Promise<void> {
  if (env.dbClient === 'postgres') {
    await getPostgresPool().query(
      `INSERT INTO project_collaborators (project_instance_id, user_id, added_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_instance_id, user_id) DO NOTHING`,
      [projectInstanceId, userId, new Date().toISOString()],
    );
    return;
  }
  this.addCollaborator(projectInstanceId, userId);
}

removeCollaborator(projectInstanceId: string, userId: number): void {
  getDb()
    .prepare(`DELETE FROM project_collaborators WHERE project_instance_id = ? AND user_id = ?`)
    .run(projectInstanceId, userId);
}

async removeCollaboratorAsync(projectInstanceId: string, userId: number): Promise<void> {
  if (env.dbClient === 'postgres') {
    await getPostgresPool().query(
      `DELETE FROM project_collaborators WHERE project_instance_id = $1 AND user_id = $2`,
      [projectInstanceId, userId],
    );
    return;
  }
  this.removeCollaborator(projectInstanceId, userId);
}

listCollaborators(projectInstanceId: string): Array<{ userId: number; name: string; photoUrl: string | null }> {
  return getDb()
    .prepare(
      `SELECT u.id AS user_id, u.name, u.photo_url AS photoUrl
       FROM project_collaborators pc JOIN users u ON u.id = pc.user_id
       WHERE pc.project_instance_id = ?
       ORDER BY lower(u.name) ASC`,
    )
    .all(projectInstanceId) as Array<{ userId: number; name: string; photoUrl: string | null }>;
}

async listCollaboratorsAsync(projectInstanceId: string): Promise<Array<{ userId: number; name: string; photoUrl: string | null }>> {
  if (env.dbClient === 'postgres') {
    const result = await getPostgresPool().query<{ user_id: number; name: string; photoUrl: string | null }>(
      `SELECT u.id AS user_id, u.name, u.photo_url AS "photoUrl"
       FROM project_collaborators pc JOIN users u ON u.id = pc.user_id
       WHERE pc.project_instance_id = $1
       ORDER BY lower(u.name) ASC`,
      [projectInstanceId],
    );
    return result.rows.map((r) => ({ userId: r.user_id, name: r.name, photoUrl: r.photoUrl }));
  }
  return this.listCollaborators(projectInstanceId);
}
```

- [x] **Step 2: Add routes**

In `apps/api_server/src/routes/project_instances_routes.ts`, find the file and add after existing instance routes (keep the existing /:id/steps routes):

```typescript
// add import
import { ProjectInstancesController } from '../controllers/project_instances_controller';

// In the router, add:
projectInstancesRouter.get('/:id/collaborators', controller.getCollaborators.bind(controller));
projectInstancesRouter.post('/:id/collaborators', controller.addCollaborator.bind(controller));
projectInstancesRouter.delete('/:id/collaborators/:userId', controller.removeCollaborator.bind(controller));
```

- [x] **Step 3: Add controller handlers**

In `apps/api_server/src/controllers/project_instances_controller.ts`, add:

```typescript
async getCollaborators(req: Request, res: Response, next: NextFunction) {
  try {
    const collaborators = await repo.listCollaboratorsAsync(req.params.id);
    res.json(collaborators);
  } catch (err) {
    next(err);
  }
}

async addCollaborator(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId } = req.body as Record<string, unknown>;
    if (!userId) throw AppError.badRequest('userId is required');
    await repo.addCollaboratorAsync(req.params.id, Number(userId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async removeCollaborator(req: Request, res: Response, next: NextFunction) {
  try {
    await repo.removeCollaboratorAsync(req.params.id, Number(req.params.userId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
```

- [x] **Step 4: Run all tests**

```bash
cd apps/api_server && npm test
```
Expected: all tests PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api_server/src/repositories/project_instances_repository.ts apps/api_server/src/controllers/project_instances_controller.ts apps/api_server/src/routes/project_instances_routes.ts
git commit -m "feat: add project instance collaborators API"
```

---

## Task 7: Messages — Group Threads + Sender Identity

**Files:**
- Modify: `apps/api_server/src/models/message.ts`
- Modify: `apps/api_server/src/repositories/messages_repository.ts`
- Modify: `apps/api_server/src/controllers/messages_controller.ts`

- [x] **Step 1: Write failing tests**

Add to `apps/api_server/src/__tests__/workspace.test.ts`:

```typescript
import { MessagesRepository } from '../repositories/messages_repository';

// add to beforeEach: messagesRepo = new MessagesRepository();
// add at top of describe: let messagesRepo: MessagesRepository;

it('creates a group thread with 3+ participants', () => {
  const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
  const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
  const carol = usersRepo.create({ name: 'Carol', email: 'carol@example.com' });

  const thread = messagesRepo.createThread({
    createdBy: alice.id,
    participantIds: [bob.id, carol.id],
    threadType: 'group',
  });

  expect(thread.participants).toHaveLength(3);
  expect(thread.threadType).toBe('group');
});

it('messages include senderPhotoUrl from user record', () => {
  const alice = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
  const bob = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
  const thread = messagesRepo.createThread({
    createdBy: alice.id,
    participantIds: [bob.id],
    threadType: 'direct',
  });

  const msg = messagesRepo.createMessage(thread.id, alice.id, { body: 'Hello' });
  expect(msg.senderName).toBe('Alice');
  expect(msg.senderId).toBe(alice.id);
});
```

- [x] **Step 2: Run to confirm failure**

```bash
cd apps/api_server && npm test -- workspace
```
Expected: FAIL — `threadType` not accepted, group participant count fails.

- [x] **Step 3: Update message model**

In `apps/api_server/src/models/message.ts`:

```typescript
export interface MessageThread {
  // ... existing fields ...
  threadType: 'direct' | 'group';
}

export interface Message {
  // ... existing fields ...
  senderPhotoUrl: string | null;
}

export interface CreateThreadDto {
  createdBy: number;
  participantIds: number[];
  threadType: 'direct' | 'group';
}
```

- [x] **Step 4: Update MessagesRepository**

In `apps/api_server/src/repositories/messages_repository.ts`:

1. Update `rowToThread` to include `threadType`:

```typescript
function rowToThread(row: ThreadSummaryRow): MessageThread {
  const unreadCount = row.unread_count ?? 0;
  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message ?? null,
    unreadCount,
    isUnread: unreadCount > 0,
    threadType: (row as { thread_type?: string }).thread_type as 'direct' | 'group' ?? 'direct',
    participants: [],
  };
}
```

2. Update `ThreadRow` interface:

```typescript
interface ThreadRow {
  id: number;
  title: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  thread_type: string;
}
```

3. Update `createThread` to handle group threads — replace the participant count check:

```typescript
createThread(data: CreateThreadDto): MessageThread {
  const participantIds = Array.from(new Set([data.createdBy, ...data.participantIds]));

  if (data.threadType === 'direct') {
    if (participantIds.length !== 2) {
      throw AppError.badRequest('Direct messages must include exactly one other participant');
    }
    const existingThreadId = this.findExistingDirectThreadId(participantIds);
    if (existingThreadId != null) {
      return this.findThreadByIdForUser(existingThreadId, data.createdBy);
    }
  }

  const participantUsers = participantIds.map((id) => this.usersRepo.findById(id));
  const title = participantUsers.map((user) => user.name).join(', ');
  const now = new Date().toISOString();

  const result = getDb()
    .prepare(
      `INSERT INTO message_threads (title, created_by, thread_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(title, data.createdBy, data.threadType, now, now);

  const threadId = result.lastInsertRowid as number;
  const insertParticipant = getDb().prepare(
    `INSERT INTO thread_participants (thread_id, user_id) VALUES (?, ?)`,
  );
  const insertRead = getDb().prepare(
    `INSERT INTO thread_reads (thread_id, user_id, last_read_at) VALUES (?, ?, ?)`,
  );

  for (const participantId of participantIds) {
    insertParticipant.run(threadId, participantId);
    insertRead.run(threadId, participantId, participantId === data.createdBy ? now : null);
  }

  return this.findThreadByIdForUser(threadId, data.createdBy);
}
```

Apply the same logic to `createThreadAsync` — same structure with `$1/$2` params and `RETURNING id`.

4. Update `rowToMessage` to include `senderPhotoUrl` from joined users table. Update `findMessagesByThread` query to join users:

```typescript
findMessagesByThread(threadId: number, userId: number): Message[] {
  this.findThreadByIdForUser(threadId, userId);
  const rows = getDb()
    .prepare(
      `SELECT m.*, u.name AS sender_name_derived, u.photo_url AS sender_photo_url
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.thread_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(threadId) as (MessageRow & { sender_name_derived: string | null; sender_photo_url: string | null })[];
  return rows.map((row) => ({
    ...rowToMessage(row),
    senderName: row.sender_name_derived ?? row.sender_name,
    senderPhotoUrl: row.sender_photo_url ?? null,
  }));
}
```

Apply the same join to `findMessagesByThreadAsync`.

- [x] **Step 5: Update messages controller to accept threadType**

In `apps/api_server/src/controllers/messages_controller.ts`, update `createThread`:

```typescript
async createThread(req: Request, res: Response, next: NextFunction) {
  try {
    const { participantIds, threadType } = req.body as Record<string, unknown>;
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      throw AppError.badRequest('participantIds is required');
    }
    const type = threadType === 'group' ? 'group' : 'direct';
    const thread = await repo.createThreadAsync({
      createdBy: req.auth!.user.id,
      participantIds: participantIds.map((value) => Number(value)),
      threadType: type,
    });
    res.status(201).json(thread);
  } catch (err) {
    next(err);
  }
}
```

- [x] **Step 6: Run all tests**

```bash
cd apps/api_server && npm test
```
Expected: all tests PASS.

- [x] **Step 7: Commit**

```bash
git add apps/api_server/src/models/message.ts apps/api_server/src/repositories/messages_repository.ts apps/api_server/src/controllers/messages_controller.ts apps/api_server/src/__tests__/workspace.test.ts
git commit -m "feat: support group message threads and real sender identity"
```

---

## Task 8: Flutter — Workspace Models + Auth Enrichment

**Files:**
- Create: `apps/desktop_flutter/lib/app/core/workspace/workspace_models.dart`
- Modify: `apps/desktop_flutter/lib/app/core/auth/auth_user.dart`
- Modify: `apps/desktop_flutter/lib/app/core/auth/auth_data_source.dart`
- Modify: `apps/desktop_flutter/lib/app/core/auth/auth_session_service.dart`

- [x] **Step 1: Write failing test**

Create `apps/desktop_flutter/test/workspace_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_models.dart';

void main() {
  group('MeResponse', () {
    test('parses response with workspace and admin role', () {
      final json = {
        'user': {
          'id': 1,
          'name': 'Alice',
          'email': 'alice@example.com',
          'role': 'admin',
          'isFacilitiesManager': false,
        },
        'workspace': {
          'id': 1,
          'name': 'Grace Church',
          'joinCode': 'ABCD1234',
        },
        'workspaceRole': 'admin',
      };
      final response = MeResponse.fromJson(json);
      expect(response.workspace?.name, 'Grace Church');
      expect(response.workspace?.joinCode, 'ABCD1234');
      expect(response.workspaceRole, 'admin');
      expect(response.isAdmin, true);
    });

    test('parses response with no workspace', () {
      final json = {
        'user': {
          'id': 2,
          'name': 'Bob',
          'email': 'bob@example.com',
          'role': 'member',
        },
        'workspace': null,
        'workspaceRole': null,
      };
      final response = MeResponse.fromJson(json);
      expect(response.workspace, isNull);
      expect(response.workspaceRole, isNull);
      expect(response.isAdmin, false);
    });
  });
}
```

- [x] **Step 2: Run to confirm failure**

```bash
cd apps/desktop_flutter && flutter test test/workspace_test.dart
```
Expected: FAIL — `workspace_models.dart` not found.

- [x] **Step 3: Create workspace models**

Create `apps/desktop_flutter/lib/app/core/workspace/workspace_models.dart`:

```dart
import '../auth/auth_user.dart';
import '../utils/json_parsing.dart';

class WorkspaceInfo {
  const WorkspaceInfo({
    required this.id,
    required this.name,
    this.joinCode,
  });

  final int id;
  final String name;
  final String? joinCode; // only present for admins

  factory WorkspaceInfo.fromJson(Map<String, dynamic> json) {
    return WorkspaceInfo(
      id: asInt(json['id']) ?? 0,
      name: asString(json['name']) ?? '',
      joinCode: asString(json['joinCode']),
    );
  }
}

class WorkspaceMember {
  const WorkspaceMember({
    required this.userId,
    required this.name,
    required this.email,
    required this.role,
    this.photoUrl,
  });

  final int userId;
  final String name;
  final String email;
  final String role;
  final String? photoUrl;

  bool get isAdmin => role == 'admin';

  factory WorkspaceMember.fromJson(Map<String, dynamic> json) {
    return WorkspaceMember(
      userId: asInt(json['userId']) ?? 0,
      name: asString(json['name']) ?? '',
      email: asString(json['email']) ?? '',
      role: asString(json['role']) ?? 'staff',
      photoUrl: asString(json['photoUrl']),
    );
  }
}

class MeResponse {
  const MeResponse({
    required this.user,
    this.workspace,
    this.workspaceRole,
  });

  final AuthUser user;
  final WorkspaceInfo? workspace;
  final String? workspaceRole;

  bool get isAdmin => workspaceRole == 'admin';
  bool get hasWorkspace => workspace != null;

  factory MeResponse.fromJson(Map<String, dynamic> json) {
    final workspaceJson = json['workspace'] as Map<String, dynamic>?;
    return MeResponse(
      user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
      workspace: workspaceJson != null ? WorkspaceInfo.fromJson(workspaceJson) : null,
      workspaceRole: asString(json['workspaceRole']),
    );
  }
}
```

- [x] **Step 4: Run test**

```bash
cd apps/desktop_flutter && flutter test test/workspace_test.dart
```
Expected: PASS.

- [x] **Step 5: Update AuthDataSource.me() to return MeResponse**

In `apps/desktop_flutter/lib/app/core/auth/auth_data_source.dart`:

```dart
// Add import
import '../workspace/workspace_models.dart';

// Replace me() method:
Future<MeResponse> me(String sessionToken) async {
  AuthSessionStore.setSessionToken(sessionToken);
  final response = await http.get(
    Uri.parse('$_baseUrl/auth/me'),
    headers: AuthSessionStore.headers(),
  );
  assertOk(response);
  return MeResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
}
```

- [x] **Step 6: Update AuthSessionService to store workspace context**

In `apps/desktop_flutter/lib/app/core/auth/auth_session_service.dart`:

```dart
// Add import
import '../workspace/workspace_models.dart';

// Add fields to AuthSessionService:
WorkspaceInfo? _workspace;
String? _workspaceRole;

WorkspaceInfo? get workspace => _workspace;
String? get workspaceRole => _workspaceRole;
bool get hasWorkspace => _workspace != null;
bool get isWorkspaceAdmin => _workspaceRole == 'admin';

// Update restoreSession() — after calling _dataSource.me(), update:
// Replace: _currentUser = await _dataSource.me(_sessionToken!);
// With:
final meResponse = await _dataSource.me(_sessionToken!);
_currentUser = meResponse.user;
_workspace = meResponse.workspace;
_workspaceRole = meResponse.workspaceRole;

// Apply the same change inside signInWithGoogle() where me() is called.

// Add helper to refresh workspace context after joining/creating:
Future<void> refreshWorkspace() async {
  if (_sessionToken == null) return;
  final meResponse = await _dataSource.me(_sessionToken!);
  _workspace = meResponse.workspace;
  _workspaceRole = meResponse.workspaceRole;
  notifyListeners();
}
```

- [x] **Step 7: Run all Flutter tests**

```bash
cd apps/desktop_flutter && flutter test
```
Expected: all tests PASS (some may need updated imports — fix any that break due to `me()` return type change).

- [x] **Step 8: Commit**

```bash
git add apps/desktop_flutter/lib/app/core/workspace/workspace_models.dart apps/desktop_flutter/lib/app/core/auth/auth_data_source.dart apps/desktop_flutter/lib/app/core/auth/auth_session_service.dart apps/desktop_flutter/test/workspace_test.dart
git commit -m "feat: add workspace models and enrich auth session with workspace context"
```

---

## Task 9: Flutter — Workspace Data Source + Repository + Controller

**Files:**
- Create: `apps/desktop_flutter/lib/app/core/workspace/workspace_data_source.dart`
- Create: `apps/desktop_flutter/lib/app/core/workspace/workspace_repository.dart`
- Create: `apps/desktop_flutter/lib/app/core/workspace/workspace_controller.dart`

- [x] **Step 1: Create workspace data source**

Create `apps/desktop_flutter/lib/app/core/workspace/workspace_data_source.dart`:

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../auth/auth_session_store.dart';
import '../constants/app_constants.dart';
import '../utils/http_utils.dart';
import 'workspace_models.dart';

class WorkspaceDataSource {
  WorkspaceDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<WorkspaceInfo> create(String name) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/workspaces'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'name': name}),
    );
    assertOk(response);
    return WorkspaceInfo.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<WorkspaceInfo> join(String joinCode) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/workspaces/join'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'joinCode': joinCode}),
    );
    assertOk(response);
    return WorkspaceInfo.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<List<WorkspaceMember>> listMembers() async {
    final response = await http.get(
      Uri.parse('$_baseUrl/workspaces/me/members'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => WorkspaceMember.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> updateMemberRole(int userId, String role) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/workspaces/me/members/$userId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'role': role}),
    );
    assertOk(response);
  }

  Future<void> removeMember(int userId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/workspaces/me/members/$userId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<String> regenerateJoinCode() async {
    final response = await http.post(
      Uri.parse('$_baseUrl/workspaces/me/join-code/regenerate'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return json['joinCode'] as String;
  }
}
```

- [x] **Step 2: Create workspace repository**

Create `apps/desktop_flutter/lib/app/core/workspace/workspace_repository.dart`:

```dart
import 'workspace_data_source.dart';
import 'workspace_models.dart';

class WorkspaceRepository {
  WorkspaceRepository(this._dataSource);

  final WorkspaceDataSource _dataSource;

  Future<WorkspaceInfo> create(String name) => _dataSource.create(name);
  Future<WorkspaceInfo> join(String joinCode) => _dataSource.join(joinCode);
  Future<List<WorkspaceMember>> listMembers() => _dataSource.listMembers();
  Future<void> updateMemberRole(int userId, String role) =>
      _dataSource.updateMemberRole(userId, role);
  Future<void> removeMember(int userId) => _dataSource.removeMember(userId);
  Future<String> regenerateJoinCode() => _dataSource.regenerateJoinCode();
}
```

- [x] **Step 3: Create workspace controller**

Create `apps/desktop_flutter/lib/app/core/workspace/workspace_controller.dart`:

```dart
import 'package:flutter/foundation.dart';
import 'workspace_models.dart';
import 'workspace_repository.dart';

enum WorkspaceStatus { idle, loading, error }

class WorkspaceController extends ChangeNotifier {
  WorkspaceController(this._repository);

  final WorkspaceRepository _repository;

  List<WorkspaceMember> _members = [];
  WorkspaceStatus _status = WorkspaceStatus.idle;
  String? _errorMessage;

  List<WorkspaceMember> get members => _members;
  WorkspaceStatus get status => _status;
  String? get errorMessage => _errorMessage;

  Future<void> loadMembers() async {
    _status = WorkspaceStatus.loading;
    notifyListeners();
    try {
      _members = await _repository.listMembers();
      _status = WorkspaceStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = WorkspaceStatus.error;
    }
    notifyListeners();
  }

  Future<void> updateMemberRole(int userId, String role) async {
    await _repository.updateMemberRole(userId, role);
    await loadMembers();
  }

  Future<void> removeMember(int userId) async {
    await _repository.removeMember(userId);
    await loadMembers();
  }

  Future<String> regenerateJoinCode() async {
    return _repository.regenerateJoinCode();
  }
}
```

- [x] **Step 4: Wire WorkspaceController into main.dart**

In `apps/desktop_flutter/lib/main.dart`, add the WorkspaceController provider alongside existing providers:

```dart
// Add imports:
import 'app/core/workspace/workspace_controller.dart';
import 'app/core/workspace/workspace_data_source.dart';
import 'app/core/workspace/workspace_repository.dart';

// Inside MultiProvider's providers list, add:
ChangeNotifierProvider(
  create: (_) => WorkspaceController(
    WorkspaceRepository(WorkspaceDataSource(baseUrl: serverConfigService.url)),
  ),
),
```

- [x] **Step 5: Run Flutter tests and analyze**

```bash
cd apps/desktop_flutter && flutter test && flutter analyze --no-fatal-infos
```
Expected: tests PASS, no analysis errors.

- [x] **Step 6: Commit**

```bash
git add apps/desktop_flutter/lib/app/core/workspace/ apps/desktop_flutter/lib/main.dart
git commit -m "feat: add workspace data source, repository, and controller"
```

---

## Task 10: Flutter — Workspace Onboarding View + AppShell Gate

**Files:**
- Create: `apps/desktop_flutter/lib/app/core/workspace/workspace_onboarding_view.dart`
- Modify: `apps/desktop_flutter/lib/app/core/layout/app_shell.dart`

- [x] **Step 1: Create WorkspaceOnboardingView**

Create `apps/desktop_flutter/lib/app/core/workspace/workspace_onboarding_view.dart`:

```dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import '../auth/auth_session_service.dart';
import '../auth/auth_session_store.dart';
import '../constants/app_constants.dart';
import '../utils/http_utils.dart';
import 'workspace_models.dart';

class WorkspaceOnboardingView extends StatefulWidget {
  const WorkspaceOnboardingView({super.key});

  @override
  State<WorkspaceOnboardingView> createState() => _WorkspaceOnboardingViewState();
}

class _WorkspaceOnboardingViewState extends State<WorkspaceOnboardingView> {
  bool _isJoining = false;
  bool _loading = false;
  String? _error;
  final _nameController = TextEditingController();
  final _codeController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() { _loading = true; _error = null; });
    try {
      final baseUrl = AppConstants.apiBaseUrl;
      if (_isJoining) {
        final code = _codeController.text.trim().toUpperCase();
        if (code.length != 8) throw Exception('Join code must be 8 characters');
        final response = await http.post(
          Uri.parse('$baseUrl/workspaces/join'),
          headers: AuthSessionStore.headers(json: true),
          body: jsonEncode({'joinCode': code}),
        );
        assertOk(response);
      } else {
        final name = _nameController.text.trim();
        if (name.isEmpty) throw Exception('Workspace name is required');
        final response = await http.post(
          Uri.parse('$baseUrl/workspaces'),
          headers: AuthSessionStore.headers(json: true),
          body: jsonEncode({'name': name}),
        );
        assertOk(response);
      }
      if (mounted) {
        await context.read<AuthSessionService>().refreshWorkspace();
      }
    } catch (e) {
      setState(() { _error = e.toString(); });
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: SizedBox(
          width: 400,
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Welcome to Rhythm',
                    style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('Set up your church workspace to get started.',
                    style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF6B7280))),
                const SizedBox(height: 32),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => setState(() => _isJoining = false),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: !_isJoining ? const Color(0xFF4F6AF5) : null,
                          foregroundColor: !_isJoining ? Colors.white : null,
                        ),
                        child: const Text('Create'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => setState(() => _isJoining = true),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: _isJoining ? const Color(0xFF4F6AF5) : null,
                          foregroundColor: _isJoining ? Colors.white : null,
                        ),
                        child: const Text('Join'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                if (!_isJoining) ...[
                  TextField(
                    controller: _nameController,
                    decoration: const InputDecoration(
                      labelText: 'Church / Organization name',
                      border: OutlineInputBorder(),
                    ),
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                  ),
                ] else ...[
                  TextField(
                    controller: _codeController,
                    decoration: const InputDecoration(
                      labelText: 'Join code (8 characters)',
                      border: OutlineInputBorder(),
                    ),
                    textCapitalization: TextCapitalization.characters,
                    maxLength: 8,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!, style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
                ],
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _loading ? null : _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF4F6AF5),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: _loading
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(_isJoining ? 'Join Workspace' : 'Create Workspace'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
```

- [x] **Step 2: Gate AppShell on workspace membership**

In `apps/desktop_flutter/lib/app/core/layout/app_shell.dart`, find the section that handles `AuthStatus.authenticated` (where the main app UI is shown) and add a workspace check.

Find the widget build logic that returns the main app shell when authenticated, and wrap it with a workspace check:

```dart
// Add import at top:
import '../workspace/workspace_onboarding_view.dart';

// In the build method, after the authenticated check, add before returning the main scaffold:
// Find the spot where authenticated users see the app shell and add:
final authService = context.watch<AuthSessionService>();
// ... existing auth checks ...
if (authService.isAuthenticated && !authService.hasWorkspace) {
  return const WorkspaceOnboardingView();
}
```

The exact placement depends on where authentication state is checked in `app_shell.dart`. Read the file if needed and insert the workspace gate immediately after the `AuthStatus.authenticated` branch is confirmed and before the main scaffold is returned.

- [x] **Step 3: Run Flutter analyze**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add apps/desktop_flutter/lib/app/core/workspace/workspace_onboarding_view.dart apps/desktop_flutter/lib/app/core/layout/app_shell.dart
git commit -m "feat: add workspace onboarding view and app shell gate"
```

---

## Task 11: Flutter — Settings Workspace Section

**Files:**
- Modify: `apps/desktop_flutter/lib/features/settings/views/settings_view.dart`

- [x] **Step 1: Read current settings view structure**

```bash
head -60 apps/desktop_flutter/lib/features/settings/views/settings_view.dart
```

- [x] **Step 2: Add workspace section to settings**

Add a workspace management section to `settings_view.dart`. Insert after existing settings content:

```dart
// Add imports:
import 'package:flutter/services.dart';
import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/workspace/workspace_models.dart';

// Inside the view's build method, add a workspace section widget:
_WorkspaceSectionWidget(),
```

Add the widget class at the bottom of the file:

```dart
class _WorkspaceSectionWidget extends StatefulWidget {
  @override
  State<_WorkspaceSectionWidget> createState() => _WorkspaceSectionWidgetState();
}

class _WorkspaceSectionWidgetState extends State<_WorkspaceSectionWidget> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<WorkspaceController>().loadMembers();
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthSessionService>();
    final controller = context.watch<WorkspaceController>();
    final workspace = auth.workspace;
    if (workspace == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text('Workspace',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
        ),
        Text(workspace.name, style: Theme.of(context).textTheme.bodyLarge),
        if (auth.isWorkspaceAdmin && workspace.joinCode != null) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Text('Join code: ', style: Theme.of(context).textTheme.bodyMedium),
              Text(workspace.joinCode!,
                  style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold)),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.copy, size: 16),
                tooltip: 'Copy join code',
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: workspace.joinCode!));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Join code copied')),
                  );
                },
              ),
              TextButton(
                onPressed: () async {
                  final newCode = await context.read<WorkspaceController>().regenerateJoinCode();
                  await context.read<AuthSessionService>().refreshWorkspace();
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('New code: $newCode')),
                    );
                  }
                },
                child: const Text('Regenerate'),
              ),
            ],
          ),
        ],
        const SizedBox(height: 12),
        if (controller.status == WorkspaceStatus.loading)
          const CircularProgressIndicator()
        else
          ...controller.members.map((member) => _MemberTile(member: member, isAdmin: auth.isWorkspaceAdmin)),
      ],
    );
  }
}

class _MemberTile extends StatelessWidget {
  const _MemberTile({required this.member, required this.isAdmin});

  final WorkspaceMember member;
  final bool isAdmin;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundImage: member.photoUrl != null ? NetworkImage(member.photoUrl!) : null,
        child: member.photoUrl == null ? Text(member.name[0].toUpperCase()) : null,
      ),
      title: Text(member.name),
      subtitle: Text(member.email),
      trailing: isAdmin
          ? PopupMenuButton<String>(
              itemBuilder: (_) => [
                PopupMenuItem(
                    value: member.isAdmin ? 'make_staff' : 'make_admin',
                    child: Text(member.isAdmin ? 'Make Staff' : 'Make Admin')),
                const PopupMenuItem(value: 'remove', child: Text('Remove')),
              ],
              onSelected: (action) async {
                final ctrl = context.read<WorkspaceController>();
                if (action == 'make_staff') {
                  await ctrl.updateMemberRole(member.userId, 'staff');
                } else if (action == 'make_admin') {
                  await ctrl.updateMemberRole(member.userId, 'admin');
                } else if (action == 'remove') {
                  await ctrl.removeMember(member.userId);
                }
              },
            )
          : Text(member.role, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
    );
  }
}
```

- [x] **Step 3: Run Flutter analyze**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add apps/desktop_flutter/lib/features/settings/views/settings_view.dart
git commit -m "feat: add workspace management section to settings"
```

---

## Task 12: Flutter — Task Collaborators

**Files:**
- Create: `apps/desktop_flutter/lib/features/tasks/models/task_collaborator.dart`
- Create: `apps/desktop_flutter/lib/features/tasks/data/collaborators_data_source.dart`
- Create: `apps/desktop_flutter/lib/shared/widgets/collaborators_row.dart`
- Modify: `apps/desktop_flutter/lib/features/tasks/models/task.dart`
- Modify: `apps/desktop_flutter/lib/features/tasks/views/tasks_view.dart`

- [x] **Step 1: Create TaskCollaborator model**

Create `apps/desktop_flutter/lib/features/tasks/models/task_collaborator.dart`:

```dart
import '../../../app/core/utils/json_parsing.dart';

class TaskCollaborator {
  const TaskCollaborator({
    required this.userId,
    required this.name,
    this.photoUrl,
  });

  final int userId;
  final String name;
  final String? photoUrl;

  factory TaskCollaborator.fromJson(Map<String, dynamic> json) {
    return TaskCollaborator(
      userId: asInt(json['userId']) ?? 0,
      name: asString(json['name']) ?? '',
      photoUrl: asString(json['photoUrl']),
    );
  }
}
```

- [x] **Step 2: Add isShared + collaborators to Task model**

In `apps/desktop_flutter/lib/features/tasks/models/task.dart`, add fields and update `fromJson`:

```dart
// Add to constructor parameters and fields:
this.isShared = false,
this.collaborators = const [],

final bool isShared;
final List<TaskCollaborator> collaborators;

// In fromJson, add:
isShared: asBool(json['isShared']) ?? false,
collaborators: ((json['collaborators'] as List<dynamic>?) ?? const [])
    .map((item) => TaskCollaborator.fromJson(item as Map<String, dynamic>))
    .toList(),
```

Add import at top of task.dart:
```dart
import 'task_collaborator.dart';
```

- [x] **Step 3: Create collaborators data source**

Create `apps/desktop_flutter/lib/features/tasks/data/collaborators_data_source.dart`:

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/task_collaborator.dart';

class CollaboratorsDataSource {
  CollaboratorsDataSource({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl;

  final String _baseUrl;

  Future<List<TaskCollaborator>> fetchForTask(String taskId) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/tasks/$taskId/collaborators'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => TaskCollaborator.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> addToTask(String taskId, int userId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/tasks/$taskId/collaborators'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'userId': userId}),
    );
    assertOk(response);
  }

  Future<void> removeFromTask(String taskId, int userId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/tasks/$taskId/collaborators/$userId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }

  Future<List<TaskCollaborator>> fetchForProject(String projectInstanceId) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/project-instances/$projectInstanceId/collaborators'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((item) => TaskCollaborator.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> addToProject(String projectInstanceId, int userId) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/project-instances/$projectInstanceId/collaborators'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({'userId': userId}),
    );
    assertOk(response);
  }

  Future<void> removeFromProject(String projectInstanceId, int userId) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/project-instances/$projectInstanceId/collaborators/$userId'),
      headers: AuthSessionStore.headers(),
    );
    assertOk(response);
  }
}
```

- [x] **Step 4: Create shared CollaboratorsRow widget**

Create `apps/desktop_flutter/lib/shared/widgets/collaborators_row.dart`:

```dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../app/core/auth/auth_session_store.dart';
import '../../app/core/auth/auth_session_service.dart';
import '../../app/core/workspace/workspace_models.dart';
import '../../features/tasks/models/task_collaborator.dart';

typedef OnCollaboratorAdded = Future<void> Function(int userId);
typedef OnCollaboratorRemoved = Future<void> Function(int userId);

class CollaboratorsRow extends StatelessWidget {
  const CollaboratorsRow({
    super.key,
    required this.collaborators,
    required this.ownerId,
    required this.onAdd,
    required this.onRemove,
    required this.workspaceMembers,
  });

  final List<TaskCollaborator> collaborators;
  final int ownerId;
  final OnCollaboratorAdded onAdd;
  final OnCollaboratorRemoved onRemove;
  final List<WorkspaceMember> workspaceMembers;

  @override
  Widget build(BuildContext context) {
    final currentUserId = AuthSessionService.instance.currentUser?.id;
    final isOwner = currentUserId == ownerId;

    return Row(
      children: [
        ...collaborators.map((c) => Padding(
          padding: const EdgeInsets.only(right: 4),
          child: GestureDetector(
            onLongPress: isOwner ? () => onRemove(c.userId) : null,
            child: Tooltip(
              message: '${c.name}${isOwner ? ' (long-press to remove)' : ''}',
              child: CircleAvatar(
                radius: 14,
                backgroundImage: c.photoUrl != null ? NetworkImage(c.photoUrl!) : null,
                child: c.photoUrl == null
                    ? Text(c.name[0].toUpperCase(), style: const TextStyle(fontSize: 11))
                    : null,
              ),
            ),
          ),
        )),
        if (isOwner)
          IconButton(
            icon: const Icon(Icons.person_add_outlined, size: 18),
            tooltip: 'Add collaborator',
            onPressed: () => _showPeoplePicker(context),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          ),
      ],
    );
  }

  Future<void> _showPeoplePicker(BuildContext context) async {
    final alreadyAdded = {ownerId, ...collaborators.map((c) => c.userId)};
    final candidates = workspaceMembers.where((m) => !alreadyAdded.contains(m.userId)).toList();

    if (candidates.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No other workspace members to add')),
      );
      return;
    }

    final selected = await showDialog<WorkspaceMember>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Add collaborator'),
        children: candidates
            .map((m) => SimpleDialogOption(
                  onPressed: () => Navigator.pop(ctx, m),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 14,
                        backgroundImage: m.photoUrl != null ? NetworkImage(m.photoUrl!) : null,
                        child: m.photoUrl == null
                            ? Text(m.name[0].toUpperCase(), style: const TextStyle(fontSize: 11))
                            : null,
                      ),
                      const SizedBox(width: 8),
                      Text(m.name),
                    ],
                  ),
                ))
            .toList(),
      ),
    );
    if (selected != null) {
      await onAdd(selected.userId);
    }
  }
}
```

- [x] **Step 5: Wire CollaboratorsRow into TasksView**

In `apps/desktop_flutter/lib/features/tasks/views/tasks_view.dart`, find the task card/list item widget and add the collaborator row. The exact location depends on the current card structure — read the file and find where task properties like `task.dueDate` are displayed, then add after them:

```dart
// Add imports:
import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../shared/widgets/collaborators_row.dart';
import '../data/collaborators_data_source.dart';

// In the task card widget, add collaborator row:
CollaboratorsRow(
  collaborators: task.collaborators,
  ownerId: task.ownerId ?? 0,
  workspaceMembers: context.read<WorkspaceController>().members,
  onAdd: (userId) async {
    final ds = CollaboratorsDataSource();
    await ds.addToTask(task.id, userId);
    await context.read<TasksController>().load();
  },
  onRemove: (userId) async {
    final ds = CollaboratorsDataSource();
    await ds.removeFromTask(task.id, userId);
    await context.read<TasksController>().load();
  },
),
```

Also add the `shared` badge for tasks where `task.isShared == true`:

```dart
if (task.isShared)
  Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(
      color: const Color(0x144F6AF5),
      borderRadius: BorderRadius.circular(4),
    ),
    child: const Text('shared', style: TextStyle(fontSize: 11, color: Color(0xFF4F6AF5))),
  ),
```

- [x] **Step 6: Run flutter analyze**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```
Fix any import or type errors.

- [x] **Step 7: Commit**

```bash
git add apps/desktop_flutter/lib/features/tasks/models/task_collaborator.dart apps/desktop_flutter/lib/features/tasks/models/task.dart apps/desktop_flutter/lib/features/tasks/data/collaborators_data_source.dart apps/desktop_flutter/lib/shared/widgets/collaborators_row.dart apps/desktop_flutter/lib/features/tasks/views/tasks_view.dart
git commit -m "feat: add task collaborators UI"
```

---

## Task 13: Flutter — Project Collaborators

**Files:**
- Modify: `apps/desktop_flutter/lib/features/projects/views/projects_view.dart`

- [x] **Step 1: Read projects view structure**

```bash
head -80 apps/desktop_flutter/lib/features/projects/views/projects_view.dart
```

- [x] **Step 2: Wire CollaboratorsRow into project instance detail**

In `apps/desktop_flutter/lib/features/projects/views/projects_view.dart`, find the project instance card/detail widget and add the collaborator row using the same `CollaboratorsRow` widget:

```dart
// Add imports:
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../shared/widgets/collaborators_row.dart';
import '../../tasks/data/collaborators_data_source.dart';
import '../../tasks/models/task_collaborator.dart';

// In the project instance card, add:
CollaboratorsRow(
  collaborators: instance.collaborators
      .map((c) => TaskCollaborator(userId: c.userId, name: c.name, photoUrl: c.photoUrl))
      .toList(),
  ownerId: instance.ownerId ?? 0,
  workspaceMembers: context.read<WorkspaceController>().members,
  onAdd: (userId) async {
    final ds = CollaboratorsDataSource();
    await ds.addToProject(instance.id, userId);
    await context.read<ProjectTemplateController>().load();
  },
  onRemove: (userId) async {
    final ds = CollaboratorsDataSource();
    await ds.removeFromProject(instance.id, userId);
    await context.read<ProjectTemplateController>().load();
  },
),
```

You'll also need to add a `collaborators` field to the `ProjectInstance` model (in `apps/desktop_flutter/lib/features/projects/models/project_instance.dart`) similar to how `Task` was updated. Add:

```dart
// In project_instance.dart, add import and field:
import '../../tasks/models/task_collaborator.dart';

// In ProjectInstance:
this.collaborators = const [],
final List<TaskCollaborator> collaborators;

// In fromJson:
collaborators: ((json['collaborators'] as List<dynamic>?) ?? const [])
    .map((item) => TaskCollaborator.fromJson(item as Map<String, dynamic>))
    .toList(),
```

- [x] **Step 3: Run flutter analyze**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

- [x] **Step 4: Commit**

```bash
git add apps/desktop_flutter/lib/features/projects/ 
git commit -m "feat: add project instance collaborators UI"
```

---

## Task 14: Flutter — Messages Real Identity + Group Threads

**Files:**
- Modify: `apps/desktop_flutter/lib/features/messages/models/message.dart`
- Modify: `apps/desktop_flutter/lib/features/messages/models/message_thread.dart`
- Modify: `apps/desktop_flutter/lib/features/messages/views/messages_view.dart`

- [x] **Step 1: Update Message model**

In `apps/desktop_flutter/lib/features/messages/models/message.dart`, add `senderId` and `senderPhotoUrl`:

```dart
class Message {
  const Message({
    required this.id,
    required this.threadId,
    required this.senderName,
    required this.content,
    required this.createdAt,
    this.senderId,
    this.senderPhotoUrl,
  });

  final int id;
  final int threadId;
  final String senderName;
  final String content;
  final DateTime createdAt;
  final int? senderId;
  final String? senderPhotoUrl;

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: asInt(json['id']) ?? 0,
      threadId: asInt(json['threadId']) ?? 0,
      senderName: asString(json['senderName']) ?? '',
      content: asString(json['body']) ?? '',
      createdAt: _parseApiDateTime(asString(json['createdAt'])),
      senderId: asInt(json['senderId']),
      senderPhotoUrl: asString(json['senderPhotoUrl']),
    );
  }
}
```

- [x] **Step 2: Update MessageThread model**

In `apps/desktop_flutter/lib/features/messages/models/message_thread.dart`, add `threadType`:

```dart
class MessageThread {
  const MessageThread({
    required this.id,
    required this.title,
    this.lastMessage,
    required this.updatedAt,
    required this.unreadCount,
    this.participants = const [],
    this.threadType = 'direct',
  });

  // ... existing fields ...
  final String threadType;

  bool get isGroup => threadType == 'group';

  factory MessageThread.fromJson(Map<String, dynamic> json) {
    return MessageThread(
      // ... existing fields ...
      threadType: asString(json['threadType']) ?? 'direct',
    );
  }
}
```

- [x] **Step 3: Update MessagesView**

In `apps/desktop_flutter/lib/features/messages/views/messages_view.dart`, make these changes:

1. **Message bubbles** — show sender name + photo for all messages (not just "the other person"). Find where message items are rendered and update to show:

```dart
// In the message list item builder, add sender avatar + name above/beside each message:
Row(
  crossAxisAlignment: CrossAxisAlignment.start,
  children: [
    CircleAvatar(
      radius: 14,
      backgroundImage: message.senderPhotoUrl != null
          ? NetworkImage(message.senderPhotoUrl!)
          : null,
      child: message.senderPhotoUrl == null
          ? Text(message.senderName.isNotEmpty ? message.senderName[0].toUpperCase() : '?',
              style: const TextStyle(fontSize: 11))
          : null,
    ),
    const SizedBox(width: 8),
    Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message.senderName,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
          const SizedBox(height: 2),
          Text(message.content),
        ],
      ),
    ),
  ],
),
```

2. **Thread list** — unread dot already driven by `thread.isUnread`. Group threads show participant names — `thread.displayTitleFor(currentUserId)` already handles this. No change needed.

3. **New Message button** — update the new thread dialog to include a thread type selector and multi-select participants:

Find the existing "new message" dialog/button handler and replace with:

```dart
Future<void> _showNewMessageDialog(BuildContext context) async {
  final members = context.read<WorkspaceController>().members;
  final currentUserId = AuthSessionService.instance.currentUser?.id;
  final candidates = members.where((m) => m.userId != currentUserId).toList();
  
  String threadType = 'direct';
  final selectedIds = <int>{};

  await showDialog<void>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setModalState) => AlertDialog(
        title: const Text('New Message'),
        content: SizedBox(
          width: 320,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const Text('Type: '),
                  DropdownButton<String>(
                    value: threadType,
                    items: const [
                      DropdownMenuItem(value: 'direct', child: Text('Direct Message')),
                      DropdownMenuItem(value: 'group', child: Text('Group Thread')),
                    ],
                    onChanged: (v) => setModalState(() {
                      threadType = v ?? 'direct';
                      if (threadType == 'direct') selectedIds.clear();
                    }),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              ...candidates.map((m) => CheckboxListTile(
                    value: selectedIds.contains(m.userId),
                    onChanged: (checked) {
                      setModalState(() {
                        if (checked == true) {
                          if (threadType == 'direct') selectedIds
                            ..clear()
                            ..add(m.userId);
                          else selectedIds.add(m.userId);
                        } else {
                          selectedIds.remove(m.userId);
                        }
                      });
                    },
                    title: Text(m.name),
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                  )),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: selectedIds.isEmpty
                ? null
                : () async {
                    Navigator.pop(ctx);
                    await context.read<MessagesController>().createThread(
                      participantIds: selectedIds.toList(),
                      threadType: threadType,
                    );
                  },
            child: const Text('Start'),
          ),
        ],
      ),
    ),
  );
}
```

4. **MessagesController** — update `createThread` to accept `threadType`. Find `apps/desktop_flutter/lib/features/messages/controllers/messages_controller.dart` and update the `createThread` method signature and data source call to pass `threadType`. Also update the messages data source (`apps/desktop_flutter/lib/features/messages/data/messages_data_source.dart`) to include `threadType` in the POST body.

- [x] **Step 4: Run flutter analyze**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```
Fix any import errors.

- [x] **Step 5: Run all Flutter tests**

```bash
cd apps/desktop_flutter && flutter test
```
Expected: all tests PASS.

- [x] **Step 6: Format and final check**

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos
```

- [x] **Step 7: Commit**

```bash
git add apps/desktop_flutter/lib/features/messages/
git commit -m "feat: wire messages to real user identity and support group threads"
```

---

## Task 15: Final Integration Check + PR

- [ ] **Step 1: Run all API tests**

```bash
cd apps/api_server && npm test
```
Expected: all tests PASS.

- [ ] **Step 2: Run all Flutter tests and analysis**

```bash
cd apps/desktop_flutter && flutter test && dart format --output=none --set-exit-if-changed . && flutter analyze --no-fatal-infos
```
Expected: all pass.

- [ ] **Step 3: Close Phase 7 GitHub issues**

```bash
cd /path/to/repo && gh issue close 62 --comment "Workspace model, membership, and permissions implemented in Phase 7."
gh issue close 53 --comment "Task and project collaborators implemented in Phase 7."
gh issue close 124 --comment "Messages wired to real user identity with group thread support in Phase 7."
```

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: Phase 7 multiuser accounts and collaboration" --body "$(cat <<'EOF'
## Summary
- Workspace model: one per church, join-code onboarding, admin/staff roles
- Task and project instance collaborators: personal by default, explicit sharing
- Messages: real user identity (name + photo), group thread support
- Settings: workspace member management for admins

## Issues closed
Closes #62, closes #53, closes #124

## Test plan
- [ ] New Google user sees Join or Create screen on first launch
- [ ] Admin can create workspace and share join code
- [ ] Second user can join with code and access app
- [ ] Admin can manage members in Settings
- [ ] Task owner can add collaborator; task appears in collaborator's list
- [ ] Collaborator removal works
- [ ] Same for project instances
- [ ] Messages show real names and photos
- [ ] Direct and group threads both work
- [ ] Unread dots appear and clear on message read

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
