# Phase 8: Collaboration Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make owner/collaborator assignment consistent across Tasks, Rhythms, Weekly Planner, and Projects — workspace-filtered pickers everywhere, step-level assignees on rhythms and projects, and admin tools to add workspace members directly.

**Architecture:** Backend migrations add `assignee_id` to project/rhythm steps and a `rhythm_collaborators` table. A new `workspace/me/members/add` endpoint lets admins add users directly. On the Flutter side, a shared `WorkspaceMemberPicker` widget replaces every ad-hoc user dropdown. Each screen gets updated to use it uniformly.

**Tech Stack:** TypeScript/Express/SQLite+Postgres (API), vitest (API tests), Flutter/Dart (desktop), flutter_test (Flutter tests)

---

## Terminology

- **Owner** — the single person who created/owns a task, rhythm, or project. Can manage collaborators.
- **Collaborator** — additional person CC'd on a task, or a co-owner of a rhythm/project who can see everything and edit steps assigned to them.
- **Assignee** — the person assigned to a specific step within a rhythm or project.

---

## File Map

### API Server — Modified Files
- `apps/api_server/src/database/migrations.ts` — add `assignee_id` to `project_template_steps`, `project_instance_steps`; add `rhythm_collaborators` table
- `apps/api_server/src/database/postgres_bootstrap.ts` — same additions for Postgres
- `apps/api_server/src/models/recurring_task_rule.ts` — add `collaborators: WorkspaceMember[]` to `RecurringTaskRule`; add `WorkspaceMember` import
- `apps/api_server/src/repositories/recurring_task_rules_repository.ts` — filter list by owner/collaborator; add `addCollaborator`, `removeCollaborator`, `listCollaborators` methods
- `apps/api_server/src/controllers/recurring_rules_controller.ts` — add `addCollaborator`, `removeCollaborator` handlers
- `apps/api_server/src/routes/recurring_rules_routes.ts` — add `POST /:id/collaborators`, `DELETE /:id/collaborators/:userId`
- `apps/api_server/src/models/project_template.ts` — add `assigneeId: number | null` and `assigneeName: string | null` to `ProjectTemplateStep`; add `assigneeId` to `CreateStepDto`
- `apps/api_server/src/models/project_instance.ts` — add `assigneeId: number | null` and `assigneeName: string | null` to `ProjectInstanceStep`
- `apps/api_server/src/repositories/project_templates_repository.ts` — include `assignee_id` in step read/write; join users for `assigneeName`
- `apps/api_server/src/repositories/project_instances_repository.ts` — include `assignee_id` in step read/write; copy from template step on instance create; join users for `assigneeName`
- `apps/api_server/src/controllers/workspace_controller.ts` — add `addMemberDirect` handler
- `apps/api_server/src/routes/workspace_routes.ts` — add `POST /me/members/add`

### API Server — New Files
- `apps/api_server/src/__tests__/phase8_collaboration.test.ts` — tests for rhythm collaborators, step assignees, direct member add

### Flutter — New Files
- `apps/desktop_flutter/lib/shared/widgets/workspace_member_picker.dart` — reusable inline dropdown for picking a workspace member (or none); uses `List<WorkspaceMember>`

### Flutter — Modified Files
- `apps/desktop_flutter/lib/features/tasks/models/recurring_task_rule.dart` — add `ownerId: int?` and `collaborators: List<RhythmCollaborator>` to `RecurringTaskRule`; add `RhythmCollaborator` class
- `apps/desktop_flutter/lib/features/rhythms/data/rhythms_data_source.dart` — add `addCollaborator(rhythmId, userId)`, `removeCollaborator(rhythmId, userId)` HTTP methods
- `apps/desktop_flutter/lib/features/rhythms/controllers/rhythms_controller.dart` — expose `addCollaborator`, `removeCollaborator`; switch step picker source from `_users` (all users) to workspace members
- `apps/desktop_flutter/lib/features/rhythms/views/rhythms_view.dart` — use `WorkspaceMemberPicker` for step assignees; add rhythm-level collaborators row (owner can add/remove); only owner sees edit/delete buttons
- `apps/desktop_flutter/lib/features/projects/models/project_template_step.dart` — add `assigneeId: int?`, `assigneeName: String?`
- `apps/desktop_flutter/lib/features/projects/models/project_instance.dart` — add `assigneeId: int?`, `assigneeName: String?` to `ProjectInstanceStep`
- `apps/desktop_flutter/lib/features/projects/views/projects_view.dart` — add `WorkspaceMemberPicker` for step assignees in template editor and instance editor
- `apps/desktop_flutter/lib/features/weekly_planner/controllers/weekly_planner_controller.dart` — add `ownerId` param to `createTask`; add `updateTaskOwner(taskId, ownerId)` method
- `apps/desktop_flutter/lib/features/weekly_planner/views/weekly_planner_view.dart` — add `WorkspaceMemberPicker` for owner to both create-task dialogs; add owner row + collaborators row to `_DetailPane`
- `apps/desktop_flutter/lib/features/settings/views/settings_view.dart` — add "Add member" button (admin only) that shows a search dialog

---

## Task 1: Database Migrations

**Files:**
- Modify: `apps/api_server/src/database/migrations.ts`
- Modify: `apps/api_server/src/database/postgres_bootstrap.ts`

- [ ] **Step 1: Add `assignee_id` to `project_template_steps`**

At the end of `runMigrations` in `migrations.ts`, after the existing Phase 7 block, add:

```typescript
  // Phase 8: step assignees + rhythm collaborators
  const templateStepCols = (db.pragma('table_info(project_template_steps)') as { name: string }[]).map((c) => c.name);
  if (!templateStepCols.includes('assignee_id')) {
    db.exec(`ALTER TABLE project_template_steps ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  }

  const instanceStepCols = (db.pragma('table_info(project_instance_steps)') as { name: string }[]).map((c) => c.name);
  if (!instanceStepCols.includes('assignee_id')) {
    db.exec(`ALTER TABLE project_instance_steps ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS rhythm_collaborators (
      rhythm_id TEXT NOT NULL REFERENCES recurring_task_rules(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (rhythm_id, user_id)
    );
  `);
```

- [ ] **Step 2: Add same changes to Postgres bootstrap**

In `postgres_bootstrap.ts` inside `runPostgresBootstrap`, after the existing Phase 7 `CREATE TABLE` blocks, add:

```typescript
  await pool.query(`
    ALTER TABLE project_template_steps ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE project_instance_steps ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    CREATE TABLE IF NOT EXISTS rhythm_collaborators (
      rhythm_id TEXT NOT NULL REFERENCES recurring_task_rules(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (${UTC_TEXT_NOW}),
      PRIMARY KEY (rhythm_id, user_id)
    );
  `);
```

- [ ] **Step 3: Restart the API server and verify no migration errors**

```bash
cd apps/api_server && npm run dev
```

Expected: server starts on :4000 with no errors. Check logs for migration output.

- [ ] **Step 4: Commit**

```bash
git add apps/api_server/src/database/migrations.ts apps/api_server/src/database/postgres_bootstrap.ts
git commit -m "feat: add step assignee_id columns and rhythm_collaborators table"
```

---

## Task 2: Rhythm Collaborators — API

**Files:**
- Create: `apps/api_server/src/__tests__/phase8_collaboration.test.ts`
- Modify: `apps/api_server/src/models/recurring_task_rule.ts`
- Modify: `apps/api_server/src/repositories/recurring_task_rules_repository.ts`
- Modify: `apps/api_server/src/controllers/recurring_rules_controller.ts`
- Modify: `apps/api_server/src/routes/recurring_rules_routes.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api_server/src/__tests__/phase8_collaboration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { getDb } from '../database/db';

// Helper: create a user and get a session token
async function registerUser(name: string, email: string): Promise<string> {
  // Insert user directly for test isolation
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, created_at) VALUES (?, ?, ?, datetime('now'))`).run(9000 + Math.floor(Math.random() * 1000), name, email);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
  db.prepare(`INSERT OR IGNORE INTO sessions (id, user_id, token, created_at) VALUES (?, ?, ?, datetime('now'))`).run(crypto.randomUUID(), user.id, `test-token-${user.id}`);
  return `test-token-${user.id}`;
}

describe('Rhythm Collaborators', () => {
  let ownerToken: string;
  let collaboratorToken: string;
  let rhythmId: string;

  beforeAll(async () => {
    ownerToken = await registerUser('Rhythm Owner', `rhythm-owner-${Date.now()}@test.com`);
    collaboratorToken = await registerUser('Collab User', `collab-${Date.now()}@test.com`);

    // Get the collaborator's user id
    const db = getDb();
    const collabUser = db.prepare('SELECT id FROM users WHERE name = ?').get('Collab User') as any;
    const ownerUser = db.prepare("SELECT id FROM users WHERE name = 'Rhythm Owner'").get() as any;

    // Create a workspace and add both users
    const ws = db.prepare(`INSERT INTO workspaces (name, join_code, created_by, created_at) VALUES (?, ?, ?, datetime('now'))`).run('Test Church', 'TESTCODE', ownerUser.id);
    const wsId = ws.lastInsertRowid;
    db.prepare(`INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'admin')`).run(wsId, ownerUser.id);
    db.prepare(`INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'staff')`).run(wsId, collabUser.id);

    // Create a rhythm owned by the owner
    const res = await request(app)
      .post('/recurring-rules')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Test Rhythm', frequency: 'weekly', dayOfWeek: 1 });
    rhythmId = res.body.id;
  });

  it('owner can add a collaborator to a rhythm', async () => {
    const db = getDb();
    const collabUser = db.prepare("SELECT id FROM users WHERE name = 'Collab User'").get() as any;

    const res = await request(app)
      .post(`/recurring-rules/${rhythmId}/collaborators`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: collabUser.id });

    expect(res.status).toBe(204);
  });

  it('collaborator can see the rhythm in their list', async () => {
    const res = await request(app)
      .get('/recurring-rules')
      .set('Authorization', `Bearer ${collaboratorToken}`);

    expect(res.status).toBe(200);
    const found = res.body.find((r: any) => r.id === rhythmId);
    expect(found).toBeTruthy();
  });

  it('rhythm includes collaborators list', async () => {
    const res = await request(app)
      .get(`/recurring-rules/${rhythmId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.collaborators).toBeInstanceOf(Array);
    expect(res.body.collaborators.length).toBe(1);
    expect(res.body.collaborators[0].name).toBe('Collab User');
  });

  it('owner can remove a collaborator', async () => {
    const db = getDb();
    const collabUser = db.prepare("SELECT id FROM users WHERE name = 'Collab User'").get() as any;

    const res = await request(app)
      .delete(`/recurring-rules/${rhythmId}/collaborators/${collabUser.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(204);
  });

  it('collaborator can no longer see the rhythm after removal', async () => {
    const res = await request(app)
      .get('/recurring-rules')
      .set('Authorization', `Bearer ${collaboratorToken}`);

    expect(res.status).toBe(200);
    const found = res.body.find((r: any) => r.id === rhythmId);
    expect(found).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api_server && npx vitest run src/__tests__/phase8_collaboration.test.ts
```

Expected: failures on 404/missing collaborator routes.

- [ ] **Step 3: Update `RecurringTaskRule` model**

In `apps/api_server/src/models/recurring_task_rule.ts`, add a `RhythmCollaborator` interface and `collaborators` field:

```typescript
export interface RhythmCollaborator {
  userId: number;
  name: string;
  email: string;
  photoUrl: string | null;
}

// In RecurringTaskRule interface, add:
//   collaborators: RhythmCollaborator[];
```

Full updated interface section (replace the existing `RecurringTaskRule` interface):

```typescript
export interface RhythmCollaborator {
  userId: number;
  name: string;
  email: string;
  photoUrl: string | null;
}

export interface RecurringTaskRule {
  id: string;
  title: string;
  frequency: 'weekly' | 'monthly' | 'annual';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  month: number | null;
  enabled: boolean;
  ownerId: number | null;
  steps: RecurringTaskRuleStep[];
  collaborators: RhythmCollaborator[];
  progress?: RecurringTaskRuleProgress;
  createdAt: string;
}
```

Also update `CreateRecurringTaskRuleDto` and `UpdateRecurringTaskRuleDto` — no changes needed (collaborators managed via separate endpoints).

- [ ] **Step 4: Update `RecurringTaskRulesRepository`**

In `apps/api_server/src/repositories/recurring_task_rules_repository.ts`:

**Add `rowToCollaborator` helper after existing helpers:**
```typescript
interface CollaboratorRow {
  user_id: number;
  name: string;
  email: string;
  photo_url: string | null;
}

function rowToCollaborator(row: CollaboratorRow): RhythmCollaborator {
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    photoUrl: row.photo_url,
  };
}
```

**Add import at top:**
```typescript
import type { RhythmCollaborator } from '../models/recurring_task_rule';
```

**Add `listCollaborators` helper (sync, used internally):**
```typescript
  private listCollaboratorsForRule(rhythmId: string): RhythmCollaborator[] {
    if (isPostgres()) return []; // handled async path
    return (getDb()
      .prepare(
        `SELECT rc.user_id, u.name, u.email, u.photo_url
         FROM rhythm_collaborators rc JOIN users u ON u.id = rc.user_id
         WHERE rc.rhythm_id = ?`
      )
      .all(rhythmId) as CollaboratorRow[]).map(rowToCollaborator);
  }

  private async listCollaboratorsForRuleAsync(rhythmId: string): Promise<RhythmCollaborator[]> {
    if (!isPostgres()) return this.listCollaboratorsForRule(rhythmId);
    const { rows } = await getPool().query<CollaboratorRow>(
      `SELECT rc.user_id, u.name, u.email, u.photo_url
       FROM rhythm_collaborators rc JOIN users u ON u.id = rc.user_id
       WHERE rc.rhythm_id = $1`,
      [rhythmId]
    );
    return rows.map(rowToCollaborator);
  }
```

**Update `toRule` mapper** to add `collaborators: []` (will be populated separately):

In the existing `toRule` / `rowToRule` function, add `collaborators: []` to the returned object.

**Update `findAll` and `findAllAsync`** to filter by owner OR collaborator:

Replace the existing `findAll` and `findAllAsync` methods:

```typescript
  findAll(userId?: number): RecurringTaskRule[] {
    const rows = userId
      ? (getDb()
          .prepare(
            `SELECT DISTINCT r.* FROM recurring_task_rules r
             LEFT JOIN rhythm_collaborators rc ON rc.rhythm_id = r.id
             WHERE r.owner_id = ? OR rc.user_id = ? OR r.owner_id IS NULL
             ORDER BY r.created_at ASC`
          )
          .all(userId, userId) as RuleRow[])
      : (getDb()
          .prepare('SELECT * FROM recurring_task_rules ORDER BY created_at ASC')
          .all() as RuleRow[]);
    return rows.map((row) => ({
      ...rowToRule(row),
      collaborators: this.listCollaboratorsForRule(row.id),
    }));
  }

  async findAllAsync(userId?: number): Promise<RecurringTaskRule[]> {
    if (!isPostgres()) return this.findAll(userId);
    const { rows } = userId
      ? await getPool().query<RuleRow>(
          `SELECT DISTINCT r.* FROM recurring_task_rules r
           LEFT JOIN rhythm_collaborators rc ON rc.rhythm_id = r.id
           WHERE r.owner_id = $1 OR rc.user_id = $1 OR r.owner_id IS NULL
           ORDER BY r.created_at ASC`,
          [userId]
        )
      : await getPool().query<RuleRow>('SELECT * FROM recurring_task_rules ORDER BY created_at ASC');
    return Promise.all(
      rows.map(async (row) => ({
        ...rowToRule(row),
        collaborators: await this.listCollaboratorsForRuleAsync(row.id),
      }))
    );
  }
```

**Update `findById` and `findByIdAsync`** to include `collaborators`:

```typescript
  findById(id: string, userId?: number): RecurringTaskRule {
    const row = userId
      ? (getDb()
          .prepare(
            `SELECT DISTINCT r.* FROM recurring_task_rules r
             LEFT JOIN rhythm_collaborators rc ON rc.rhythm_id = r.id
             WHERE r.id = ? AND (r.owner_id = ? OR rc.user_id = ? OR r.owner_id IS NULL)`
          )
          .get(id, userId, userId) as RuleRow | undefined)
      : (getDb()
          .prepare('SELECT * FROM recurring_task_rules WHERE id = ?')
          .get(id) as RuleRow | undefined);
    if (!row) throw new Error('Rhythm not found');
    return { ...rowToRule(row), collaborators: this.listCollaboratorsForRule(id) };
  }

  async findByIdAsync(id: string, userId?: number): Promise<RecurringTaskRule> {
    if (!isPostgres()) return this.findById(id, userId);
    const { rows } = userId
      ? await getPool().query<RuleRow>(
          `SELECT DISTINCT r.* FROM recurring_task_rules r
           LEFT JOIN rhythm_collaborators rc ON rc.rhythm_id = r.id
           WHERE r.id = $1 AND (r.owner_id = $2 OR rc.user_id = $2 OR r.owner_id IS NULL)`,
          [id, userId]
        )
      : await getPool().query<RuleRow>('SELECT * FROM recurring_task_rules WHERE id = $1', [id]);
    if (!rows[0]) throw new Error('Rhythm not found');
    return { ...rowToRule(rows[0]), collaborators: await this.listCollaboratorsForRuleAsync(id) };
  }
```

**Add collaborator CRUD methods at the end of the class:**

```typescript
  addCollaborator(rhythmId: string, userId: number): void {
    getDb()
      .prepare('INSERT OR IGNORE INTO rhythm_collaborators (rhythm_id, user_id) VALUES (?, ?)')
      .run(rhythmId, userId);
  }

  async addCollaboratorAsync(rhythmId: string, userId: number): Promise<void> {
    if (!isPostgres()) return this.addCollaborator(rhythmId, userId);
    await getPool().query(
      'INSERT INTO rhythm_collaborators (rhythm_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [rhythmId, userId]
    );
  }

  removeCollaborator(rhythmId: string, userId: number): void {
    getDb()
      .prepare('DELETE FROM rhythm_collaborators WHERE rhythm_id = ? AND user_id = ?')
      .run(rhythmId, userId);
  }

  async removeCollaboratorAsync(rhythmId: string, userId: number): Promise<void> {
    if (!isPostgres()) return this.removeCollaborator(rhythmId, userId);
    await getPool().query(
      'DELETE FROM rhythm_collaborators WHERE rhythm_id = $1 AND user_id = $2',
      [rhythmId, userId]
    );
  }
```

- [ ] **Step 5: Add collaborator handlers to `RecurringRulesController`**

In `apps/api_server/src/controllers/recurring_rules_controller.ts`, add two methods to the class:

```typescript
  async addCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.body as Record<string, unknown>;
      if (!userId || typeof userId !== 'number') {
        throw AppError.badRequest('userId is required and must be a number');
      }
      await repo.addCollaboratorAsync(req.params.id, userId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  async removeCollaborator(req: Request, res: Response, next: NextFunction) {
    try {
      const collaboratorUserId = Number(req.params.userId);
      if (!collaboratorUserId) throw AppError.badRequest('Invalid userId');
      await repo.removeCollaboratorAsync(req.params.id, collaboratorUserId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
```

Where `repo` is the existing `RecurringTaskRulesRepository` instance already in the file.

- [ ] **Step 6: Add collaborator routes**

In `apps/api_server/src/routes/recurring_rules_routes.ts`, add after the existing routes:

```typescript
recurringRulesRouter.post('/:id/collaborators', controller.addCollaborator.bind(controller));
recurringRulesRouter.delete('/:id/collaborators/:userId', controller.removeCollaborator.bind(controller));
```

- [ ] **Step 7: Run tests**

```bash
cd apps/api_server && npx vitest run src/__tests__/phase8_collaboration.test.ts
```

Expected: all rhythm collaborator tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api_server/src/models/recurring_task_rule.ts \
        apps/api_server/src/repositories/recurring_task_rules_repository.ts \
        apps/api_server/src/controllers/recurring_rules_controller.ts \
        apps/api_server/src/routes/recurring_rules_routes.ts \
        apps/api_server/src/__tests__/phase8_collaboration.test.ts
git commit -m "feat: add rhythm collaborators API with owner/collaborator visibility filter"
```

---

## Task 3: Project Step Assignees — API

**Files:**
- Modify: `apps/api_server/src/models/project_template.ts`
- Modify: `apps/api_server/src/models/project_instance.ts`
- Modify: `apps/api_server/src/repositories/project_templates_repository.ts`
- Modify: `apps/api_server/src/repositories/project_instances_repository.ts`

- [ ] **Step 1: Update `ProjectTemplateStep` model**

In `apps/api_server/src/models/project_template.ts`, add `assigneeId` and `assigneeName` to `ProjectTemplateStep` and `CreateStepDto`:

```typescript
export interface ProjectTemplateStep {
  id: string;
  templateId: string;
  title: string;
  offsetDays: number;
  offsetDescription: string | null;
  sortOrder: number;
  assigneeId: number | null;
  assigneeName: string | null;
}

// In CreateStepDto, add:
//   assigneeId?: number | null;
```

Full `CreateStepDto` (replace existing):
```typescript
export interface CreateStepDto {
  title: string;
  offsetDays: number;
  offsetDescription?: string | null;
  sortOrder?: number;
  assigneeId?: number | null;
}
```

- [ ] **Step 2: Update `ProjectInstanceStep` model**

In `apps/api_server/src/models/project_instance.ts`, add `assigneeId` and `assigneeName` to `ProjectInstanceStep`:

```typescript
export interface ProjectInstanceStep {
  id: string;
  instanceId: string;
  stepId: string;
  title: string;
  dueDate: string;
  status: 'open' | 'done';
  notes: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
}
```

- [ ] **Step 3: Update `ProjectTemplatesRepository` to read/write `assignee_id`**

In `apps/api_server/src/repositories/project_templates_repository.ts`:

**Update `StepRow` interface** (if it exists as a local type, otherwise find where step rows are mapped):
```typescript
interface StepRow {
  id: string;
  template_id: string;
  title: string;
  offset_days: number;
  offset_description: string | null;
  sort_order: number;
  assignee_id: number | null;
  assignee_name?: string | null; // from JOIN
}
```

**Update `rowToStep` helper** (or equivalent mapper) to include assignee fields:
```typescript
function rowToStep(row: StepRow): ProjectTemplateStep {
  return {
    id: row.id,
    templateId: row.template_id,
    title: row.title,
    offsetDays: row.offset_days,
    offsetDescription: row.offset_description,
    sortOrder: row.sort_order,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name ?? null,
  };
}
```

**Update step SELECT queries** to LEFT JOIN users for `assigneeName`. Wherever steps are queried, change:
```sql
SELECT * FROM project_template_steps WHERE template_id = ?
```
to:
```sql
SELECT pts.*, u.name AS assignee_name
FROM project_template_steps pts
LEFT JOIN users u ON u.id = pts.assignee_id
WHERE pts.template_id = ?
ORDER BY pts.sort_order ASC
```
(Apply same JOIN pattern to single-step queries.)

**Update `addStep` INSERT** to include `assignee_id`:
```typescript
// In addStep / addStepAsync, add assignee_id to the INSERT:
`INSERT INTO project_template_steps (id, template_id, title, offset_days, offset_description, sort_order, assignee_id)
 VALUES (?, ?, ?, ?, ?, ?, ?)`
// ...with data.assigneeId ?? null as the last value
```

**Update `updateStep`** to include `assignee_id` in the UPDATE:
```typescript
`UPDATE project_template_steps SET title = ?, offset_days = ?, offset_description = ?, sort_order = ?, assignee_id = ? WHERE id = ?`
// ...with data.assigneeId ?? null before the id
```

- [ ] **Step 4: Update `ProjectInstancesRepository` to read/write `assignee_id` and copy from template on create**

In `apps/api_server/src/repositories/project_instances_repository.ts`:

**Update `InstanceStepRow` interface:**
```typescript
interface InstanceStepRow {
  id: string;
  instance_id: string;
  step_id: string;
  title: string;
  due_date: string;
  status: string;
  notes: string | null;
  assignee_id: number | null;
  assignee_name?: string | null;
}
```

**Update `rowToInstanceStep` mapper:**
```typescript
function rowToInstanceStep(row: InstanceStepRow): ProjectInstanceStep {
  return {
    id: row.id,
    instanceId: row.instance_id,
    stepId: row.step_id,
    title: row.title,
    dueDate: row.due_date,
    status: row.status as 'open' | 'done',
    notes: row.notes,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name ?? null,
  };
}
```

**Update step SELECT queries** to LEFT JOIN users:
```sql
SELECT pis.*, u.name AS assignee_name
FROM project_instance_steps pis
LEFT JOIN users u ON u.id = pis.assignee_id
WHERE pis.instance_id = ?
ORDER BY pis.due_date ASC
```

**Update the template-to-instance copy** (where instance steps are inserted from template steps). Find the INSERT that copies steps and add `assignee_id`:
```typescript
// SQLite version — find the INSERT INTO project_instance_steps line and update to:
`INSERT INTO project_instance_steps (id, instance_id, step_id, title, due_date, status, assignee_id)
 VALUES (?, ?, ?, ?, ?, 'open', ?)`
// The last value comes from the template step's assignee_id
```

For Postgres version, same pattern: add `, assignee_id` to the column list and `, $N` to the values with the template step's `assignee_id`.

**Update `updateStep`** to support reassigning:
In the `updateStep` / `updateStepAsync` method, add `assigneeId?: number | null` to the update DTO and include it in the SQL:
```typescript
`UPDATE project_instance_steps SET title = ?, due_date = ?, status = ?, notes = ?, assignee_id = ? WHERE id = ?`
```

- [ ] **Step 5: Add step assignee tests to test file**

Append to `apps/api_server/src/__tests__/phase8_collaboration.test.ts`:

```typescript
describe('Project Step Assignees', () => {
  let ownerToken: string;
  let templateId: string;
  let stepId: string;
  let assigneeUserId: number;

  beforeAll(async () => {
    ownerToken = await registerUser('Project Owner', `proj-owner-${Date.now()}@test.com`);
    const db = getDb();
    const ownerUser = db.prepare(`SELECT id FROM users WHERE name = 'Project Owner'`).get() as any;
    assigneeUserId = ownerUser.id;

    // Create template
    const tRes = await request(app)
      .post('/project-templates')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Test Template', anchorLabel: 'Event Date' });
    templateId = tRes.body.id;

    // Add step with assignee
    const sRes = await request(app)
      .post(`/project-templates/${templateId}/steps`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Print bulletins', offsetDays: -3, sortOrder: 1, assigneeId: assigneeUserId });
    stepId = sRes.body.id;
  });

  it('template step includes assigneeId and assigneeName', async () => {
    const res = await request(app)
      .get(`/project-templates/${templateId}/steps`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const step = res.body.find((s: any) => s.id === stepId);
    expect(step.assigneeId).toBe(assigneeUserId);
    expect(step.assigneeName).toBeTruthy();
  });

  it('instance steps inherit assigneeId from template on launch', async () => {
    const iRes = await request(app)
      .post('/project-instances')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ templateId, anchorDate: '2026-05-01', name: 'Test Instance' });

    const instanceId = iRes.body.id;
    const stepsRes = await request(app)
      .get(`/project-instances/${instanceId}/steps`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(stepsRes.status).toBe(200);
    const step = stepsRes.body[0];
    expect(step.assigneeId).toBe(assigneeUserId);
    expect(step.assigneeName).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run all API tests**

```bash
cd apps/api_server && npx vitest run
```

Expected: all tests pass including new step assignee tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api_server/src/models/project_template.ts \
        apps/api_server/src/models/project_instance.ts \
        apps/api_server/src/repositories/project_templates_repository.ts \
        apps/api_server/src/repositories/project_instances_repository.ts \
        apps/api_server/src/__tests__/phase8_collaboration.test.ts
git commit -m "feat: add assignee_id to project template and instance steps"
```

---

## Task 4: Workspace Direct Add Member — API

**Files:**
- Modify: `apps/api_server/src/controllers/workspace_controller.ts`
- Modify: `apps/api_server/src/routes/workspace_routes.ts`
- Modify: `apps/api_server/src/repositories/workspace_repository.ts`

- [ ] **Step 1: Add `addMemberDirect` to `WorkspaceRepository`**

In `apps/api_server/src/repositories/workspace_repository.ts`, add these methods to the class (alongside the existing `joinByCodeAsync`):

```typescript
  addMemberDirect(workspaceId: number, userId: number): void {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'staff', datetime('now'))`
      )
      .run(workspaceId, userId);
  }

  async addMemberDirectAsync(workspaceId: number, userId: number): Promise<void> {
    if (!isPostgres()) return this.addMemberDirect(workspaceId, userId);
    await getPool().query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES ($1, $2, 'staff', ${UTC_TEXT_NOW})
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, userId]
    );
  }
```

- [ ] **Step 2: Add `addMemberDirect` handler to `WorkspaceController`**

In `apps/api_server/src/controllers/workspace_controller.ts`, add:

```typescript
  async addMemberDirect(req: Request, res: Response, next: NextFunction) {
    try {
      const ws = await repo.findForUserAsync(req.auth!.user.id);
      if (!ws || ws.role !== 'admin') throw AppError.forbidden('Admin only');
      const { userId } = req.body as Record<string, unknown>;
      if (!userId || typeof userId !== 'number') {
        throw AppError.badRequest('userId is required and must be a number');
      }
      await repo.addMemberDirectAsync(ws.id, userId);
      const members = await repo.listMembersAsync(ws.id);
      res.json(members);
    } catch (err) {
      next(err);
    }
  }
```

- [ ] **Step 3: Register the route**

In `apps/api_server/src/routes/workspace_routes.ts`, add:

```typescript
workspaceRouter.post('/me/members/add', controller.addMemberDirect.bind(controller));
```

- [ ] **Step 4: Run all API tests**

```bash
cd apps/api_server && npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api_server/src/repositories/workspace_repository.ts \
        apps/api_server/src/controllers/workspace_controller.ts \
        apps/api_server/src/routes/workspace_routes.ts
git commit -m "feat: add POST /workspaces/me/members/add for admin direct-add"
```

---

## Task 5: Flutter — `WorkspaceMemberPicker` Widget

**Files:**
- Create: `apps/desktop_flutter/lib/shared/widgets/workspace_member_picker.dart`

- [ ] **Step 1: Create the widget**

```dart
import 'package:flutter/material.dart';
import '../../app/core/workspace/workspace_models.dart';

/// A compact dropdown that lets the user pick one workspace member (or nobody).
/// Shows a small avatar + name chip for the currently selected member.
/// Pass [workspaceMembers] from WorkspaceController.members.
class WorkspaceMemberPicker extends StatelessWidget {
  const WorkspaceMemberPicker({
    super.key,
    required this.workspaceMembers,
    required this.selectedUserId,
    required this.onChanged,
    this.label = 'Assign to',
    this.allowNone = true,
  });

  final List<WorkspaceMember> workspaceMembers;
  final int? selectedUserId;
  final ValueChanged<int?> onChanged;
  final String label;
  final bool allowNone;

  @override
  Widget build(BuildContext context) {
    final selectedMember = workspaceMembers
        .where((m) => m.userId == selectedUserId)
        .firstOrNull;

    return DropdownButtonHideUnderline(
      child: DropdownButton<int?>(
        value: selectedUserId,
        hint: Text(
          label,
          style: const TextStyle(fontSize: 13, color: Color(0xFF9CA3AF)),
        ),
        isDense: true,
        items: [
          if (allowNone)
            const DropdownMenuItem<int?>(
              value: null,
              child: Text('— None —', style: TextStyle(fontSize: 13)),
            ),
          ...workspaceMembers.map(
            (m) => DropdownMenuItem<int?>(
              value: m.userId,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircleAvatar(
                    radius: 10,
                    backgroundColor: const Color(0xFF4F6AF5),
                    child: Text(
                      m.name.isNotEmpty ? m.name[0].toUpperCase() : '?',
                      style: const TextStyle(fontSize: 9, color: Colors.white),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(m.name, style: const TextStyle(fontSize: 13)),
                ],
              ),
            ),
          ),
        ],
        onChanged: onChanged,
        selectedItemBuilder: (_) => [
          if (allowNone)
            Text(
              '— None —',
              style: const TextStyle(fontSize: 13, color: Color(0xFF9CA3AF)),
            ),
          ...workspaceMembers.map(
            (m) => Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircleAvatar(
                  radius: 10,
                  backgroundColor: const Color(0xFF4F6AF5),
                  child: Text(
                    m.name.isNotEmpty ? m.name[0].toUpperCase() : '?',
                    style: const TextStyle(fontSize: 9, color: Colors.white),
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  m.name,
                  style: const TextStyle(fontSize: 12),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Run `flutter analyze`**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

Expected: no errors on the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop_flutter/lib/shared/widgets/workspace_member_picker.dart
git commit -m "feat: add WorkspaceMemberPicker shared widget"
```

---

## Task 6: Flutter — Rhythms Consistency

**Files:**
- Modify: `apps/desktop_flutter/lib/features/tasks/models/recurring_task_rule.dart`
- Modify: `apps/desktop_flutter/lib/features/rhythms/data/rhythms_data_source.dart`
- Modify: `apps/desktop_flutter/lib/features/rhythms/controllers/rhythms_controller.dart`
- Modify: `apps/desktop_flutter/lib/features/rhythms/views/rhythms_view.dart`

- [ ] **Step 1: Update `RecurringTaskRule` Flutter model**

In `apps/desktop_flutter/lib/features/tasks/models/recurring_task_rule.dart`:

**Add `RhythmCollaborator` class before `RecurringTaskRuleStep`:**

```dart
class RhythmCollaborator {
  RhythmCollaborator({
    required this.userId,
    required this.name,
    required this.email,
    this.photoUrl,
  });

  factory RhythmCollaborator.fromJson(Map<String, dynamic> json) {
    return RhythmCollaborator(
      userId: json['userId'] as int,
      name: json['name'] as String? ?? '',
      email: json['email'] as String? ?? '',
      photoUrl: json['photoUrl'] as String?,
    );
  }

  final int userId;
  final String name;
  final String email;
  final String? photoUrl;
}
```

**Add `ownerId` and `collaborators` to `RecurringTaskRule`:**

In the `RecurringTaskRule` class constructor and fields, add:
```dart
// In constructor params:
this.ownerId,
this.collaborators = const [],

// In fromJson:
ownerId: asInt(json['ownerId']),
collaborators: ((json['collaborators'] as List<dynamic>?) ?? const [])
    .map((c) => RhythmCollaborator.fromJson(c as Map<String, dynamic>))
    .toList(),

// As fields:
final int? ownerId;
final List<RhythmCollaborator> collaborators;
```

Also update `copyWith` to include `ownerId` and `collaborators` (pass-through if not provided).

- [ ] **Step 2: Update `RhythmsDataSource`**

In `apps/desktop_flutter/lib/features/rhythms/data/rhythms_data_source.dart`, add:

```dart
Future<void> addCollaborator(String rhythmId, int userId) async {
  final uri = Uri.parse('$_baseUrl/recurring-rules/$rhythmId/collaborators');
  await http.post(
    uri,
    headers: {
      'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    },
    body: jsonEncode({'userId': userId}),
  );
}

Future<void> removeCollaborator(String rhythmId, int userId) async {
  final uri = Uri.parse('$_baseUrl/recurring-rules/$rhythmId/collaborators/$userId');
  await http.delete(
    uri,
    headers: {
      if (_token != null) 'Authorization': 'Bearer $_token',
    },
  );
}
```

(Check the constructor of `RhythmsDataSource` for how `_baseUrl` and `_token` are stored; follow the same pattern as other methods in the file.)

- [ ] **Step 3: Update `RhythmsController`**

In `apps/desktop_flutter/lib/features/rhythms/controllers/rhythms_controller.dart`:

The controller currently loads `_users: List<AuthUser>`. The rhythms view needs workspace members for the picker. Since `WorkspaceController` is available via Provider, **remove the `_users` list from this controller** (rhythms_view will read members directly from `context.read<WorkspaceController>().members`).

Add collaborator methods:

```dart
Future<void> addCollaborator(String rhythmId, int userId) async {
  try {
    await _dataSource.addCollaborator(rhythmId, userId);
    await load();
  } catch (e) {
    _errorMessage = e.toString();
    notifyListeners();
  }
}

Future<void> removeCollaborator(String rhythmId, int userId) async {
  try {
    await _dataSource.removeCollaborator(rhythmId, userId);
    await load();
  } catch (e) {
    _errorMessage = e.toString();
    notifyListeners();
  }
}
```

Also remove the `users` getter and the `Future.wait` that loaded users alongside rhythms, since the view will get members from `WorkspaceController`.

- [ ] **Step 4: Update `rhythms_view.dart` step picker and add collaborators UI**

In `apps/desktop_flutter/lib/features/rhythms/views/rhythms_view.dart`:

**Replace the `_StepEditorRow` user picker** — change the `DropdownButton` / dropdown that uses `widget.users` / `users: widget.controller.users` to use `WorkspaceMemberPicker` instead:

```dart
// Replace the existing dropdown in _StepEditorRow with:
import '../../../shared/widgets/workspace_member_picker.dart';
import '../../../app/core/workspace/workspace_controller.dart';
// ...inside _StepEditorRow build:
WorkspaceMemberPicker(
  workspaceMembers: context.read<WorkspaceController>().members,
  selectedUserId: step.assigneeId,
  onChanged: (value) => onAssigneeChanged(value),
  label: 'Assign step',
),
```

**Add rhythm-level collaborators row** to each rhythm card. After the existing step list or progress info, show a `CollaboratorsRow`-style widget. Since `CollaboratorsRow` is in `shared/widgets/collaborators_row.dart`, you can reuse it — but it takes `List<TaskCollaborator>`. Instead, inline a simple avatar row using the rhythm's `collaborators` field:

```dart
// In the rhythm card, add:
if (rhythm.collaborators.isNotEmpty || rhythm.ownerId == currentUserId) ...[
  const SizedBox(height: 8),
  Row(
    children: [
      ...rhythm.collaborators.map(
        (c) => Padding(
          padding: const EdgeInsets.only(right: 4),
          child: Tooltip(
            message: c.name,
            child: CircleAvatar(
              radius: 12,
              backgroundColor: const Color(0xFF4F6AF5),
              child: Text(c.name[0].toUpperCase(),
                  style: const TextStyle(fontSize: 10, color: Colors.white)),
            ),
          ),
        ),
      ),
      if (rhythm.ownerId == currentUserId)
        IconButton(
          icon: const Icon(Icons.person_add_outlined, size: 16),
          tooltip: 'Add collaborator',
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          onPressed: () => _showAddCollaboratorDialog(context, rhythm),
        ),
    ],
  ),
],
```

**Add `_showAddCollaboratorDialog`** method to the rhythm card or parent state:

```dart
Future<void> _showAddCollaboratorDialog(
    BuildContext context, RecurringTaskRule rhythm) async {
  final members = context.read<WorkspaceController>().members;
  final already = {
    rhythm.ownerId,
    ...rhythm.collaborators.map((c) => c.userId),
  };
  final candidates = members.where((m) => !already.contains(m.userId)).toList();

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
                      child: Text(m.name[0].toUpperCase()),
                    ),
                    const SizedBox(width: 8),
                    Text(m.name),
                  ],
                ),
              ))
          .toList(),
    ),
  );

  if (selected != null && context.mounted) {
    await context.read<RhythmsController>().addCollaborator(rhythm.id, selected.userId);
  }
}
```

Also add a "Remove collaborator" option (long-press on avatar or in an edit dialog) if the current user is the owner — follow the same pattern as `CollaboratorsRow`.

- [ ] **Step 5: Run `flutter analyze --no-fatal-infos`**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

Expected: no errors.

- [ ] **Step 6: Run `dart format .`**

```bash
cd apps/desktop_flutter && dart format .
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop_flutter/lib/features/tasks/models/recurring_task_rule.dart \
        apps/desktop_flutter/lib/features/rhythms/data/rhythms_data_source.dart \
        apps/desktop_flutter/lib/features/rhythms/controllers/rhythms_controller.dart \
        apps/desktop_flutter/lib/features/rhythms/views/rhythms_view.dart
git commit -m "feat: rhythm collaborators UI with workspace-filtered step picker"
```

---

## Task 7: Flutter — Tasks Cleanup

**Files:**
- Modify: `apps/desktop_flutter/lib/features/tasks/views/tasks_view.dart`

The tasks view already has `CollaboratorsRow` wired in — it only renders when `task.ownerId != null`. Tasks created after Phase 7 will have `ownerId` set automatically by the API (`req.auth?.user.id`). The only cleanup needed is cosmetic: use the label "Owner" / "Collaborators" consistently and ensure the collaborator row shows on all tasks owned by the current user regardless of `isShared`.

- [ ] **Step 1: Remove `isShared` gate from collaborator row**

In `apps/desktop_flutter/lib/features/tasks/views/tasks_view.dart`, find:

```dart
if (task.ownerId != null) ...[
```

This is correct — keep it. But remove the separate `if (task.isShared)` block that shows the "shared" badge (it's redundant now that collaborators are visible). Delete:

```dart
if (task.isShared) ...[
  const SizedBox(height: 8),
  Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(
      color: const Color(0x144F6AF5),
      borderRadius: BorderRadius.circular(4),
    ),
    child: const Text('shared',
        style: TextStyle(fontSize: 11, color: Color(0xFF4F6AF5))),
  ),
],
```

- [ ] **Step 2: Run `flutter analyze --no-fatal-infos`**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop_flutter/lib/features/tasks/views/tasks_view.dart
git commit -m "fix: remove redundant isShared badge from task cards"
```

---

## Task 8: Flutter — Weekly Planner Owner Assignment

**Files:**
- Modify: `apps/desktop_flutter/lib/features/weekly_planner/controllers/weekly_planner_controller.dart`
- Modify: `apps/desktop_flutter/lib/features/weekly_planner/views/weekly_planner_view.dart`

- [ ] **Step 1: Update `WeeklyPlannerController.createTask` to accept `ownerId`**

In `apps/desktop_flutter/lib/features/weekly_planner/controllers/weekly_planner_controller.dart`:

Find `createTask` and update signature and body:

```dart
Future<void> createTask(String title, {String? dueDate, int? ownerId}) async {
  try {
    await _repository.createTask(title, dueDate: dueDate, ownerId: ownerId);
    await load();
  } catch (e) {
    // existing error handling
  }
}
```

Also check `TasksRepository.create` — it needs an `ownerId` param. Update it if not already present:

In `apps/desktop_flutter/lib/features/tasks/repositories/tasks_repository.dart`, find the `create` method. If it doesn't pass `ownerId`, add:

```dart
Future<Task> create(String title, {String? notes, String? dueDate, int? ownerId}) async {
  // In the HTTP POST body, add: if (ownerId != null) 'ownerId': ownerId,
}
```

And in the data source `apps/desktop_flutter/lib/features/tasks/data/tasks_local_data_source.dart`, add `ownerId` to the request body map.

- [ ] **Step 2: Update `updateTask` in controller to accept `ownerId`**

In `WeeklyPlannerController`, find `updateTask` and add `ownerId` as an optional param that gets passed to the repository update call.

- [ ] **Step 3: Update both create-task dialogs in `weekly_planner_view.dart`**

There are two dialogs: `_showAddBacklogTaskDialog` (backlog pane) and `_showAddTaskDialog` (day column). Update both to include an owner picker.

For each dialog, change from a simple `AlertDialog` to a `StatefulBuilder` so the picker can update:

```dart
Future<void> _showAddBacklogTaskDialog(BuildContext context) async {
  final ctrl = TextEditingController();
  int? selectedOwnerId;
  final members = context.read<WorkspaceController>().members;

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setDialogState) => AlertDialog(
        backgroundColor: _kSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        ),
        title: const Text('Add unscheduled task'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: ctrl,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'Task title',
                filled: true,
                fillColor: _kSurfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                  borderSide: const BorderSide(color: _kBorder),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                  borderSide: const BorderSide(color: _kBorder),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                  borderSide: const BorderSide(color: _kPrimary),
                ),
              ),
              onSubmitted: (_) => Navigator.pop(ctx, true),
            ),
            if (members.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Text('Owner', style: TextStyle(fontSize: 12, color: _kTextSecondary)),
              const SizedBox(height: 4),
              WorkspaceMemberPicker(
                workspaceMembers: members,
                selectedUserId: selectedOwnerId,
                onChanged: (v) => setDialogState(() => selectedOwnerId = v),
                label: 'Assign owner',
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Add')),
        ],
      ),
    ),
  );
  if (confirmed == true && ctrl.text.trim().isNotEmpty) {
    await controller.createTask(ctrl.text.trim(), ownerId: selectedOwnerId);
  }
}
```

Apply the same pattern to `_showAddTaskDialog` (pass `dueDate: widget.date` in createTask and include `ownerId: selectedOwnerId`).

Add the import at the top of the file:
```dart
import '../../../shared/widgets/workspace_member_picker.dart';
import '../../../app/core/workspace/workspace_controller.dart';
```

- [ ] **Step 4: Add owner + collaborator rows to `_DetailPane`**

In `_DetailPaneState`, add:

```dart
int? _ownerId;
bool _ownerDirty = false;
```

In `_syncFromTask`:
```dart
_ownerId = widget.task.ownerId;
_ownerDirty = false;
```

In `didUpdateWidget`, add:
```dart
if (oldWidget.task.ownerId != widget.task.ownerId) _syncFromTask();
```

In `_saveDetailChanges`, add the owner save if dirty:
```dart
if (_ownerDirty) {
  await widget.controller.updateTask(
    widget.task,
    ownerId: _ownerId,
  );
}
```

In the `build` method, inside the `Column` in `SingleChildScrollView`, add after the date row:

```dart
// Add import at top of file:
// import '../../../shared/widgets/workspace_member_picker.dart';
// import '../../../app/core/workspace/workspace_controller.dart';

if (!isShadowEvent) ...[
  const SizedBox(height: 8),
  const Text(
    'OWNER',
    style: TextStyle(
      fontSize: 10,
      color: _kTextSecondary,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.4,
    ),
  ),
  const SizedBox(height: 4),
  WorkspaceMemberPicker(
    workspaceMembers: context.read<WorkspaceController>().members,
    selectedUserId: _ownerId,
    onChanged: (v) => setState(() {
      _ownerId = v;
      _ownerDirty = _ownerId != widget.task.ownerId;
    }),
    label: 'No owner',
  ),
  if (widget.task.collaborators.isNotEmpty) ...[
    const SizedBox(height: 12),
    const Text(
      'COLLABORATORS',
      style: TextStyle(
        fontSize: 10,
        color: _kTextSecondary,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.4,
      ),
    ),
    const SizedBox(height: 4),
    CollaboratorsRow(
      collaborators: widget.task.collaborators,
      ownerId: widget.task.ownerId ?? -1,
      workspaceMembers: context.read<WorkspaceController>().members,
      onAdd: (userId) async {
        final ds = CollaboratorsDataSource();
        await ds.addToTask(widget.task.id, userId);
        await widget.controller.load();
      },
      onRemove: (userId) async {
        final ds = CollaboratorsDataSource();
        await ds.removeFromTask(widget.task.id, userId);
        await widget.controller.load();
      },
    ),
  ],
],
```

Also add the missing imports at the top of `weekly_planner_view.dart`:
```dart
import '../../../shared/widgets/collaborators_row.dart';
import '../../tasks/data/collaborators_data_source.dart';
```

- [ ] **Step 5: Run `flutter analyze --no-fatal-infos` and fix any issues**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

- [ ] **Step 6: Run `dart format .`**

```bash
cd apps/desktop_flutter && dart format .
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop_flutter/lib/features/weekly_planner/
git commit -m "feat: add owner picker to weekly planner create dialogs and detail pane"
```

---

## Task 9: Flutter — Projects Step Assignees

**Files:**
- Modify: `apps/desktop_flutter/lib/features/projects/models/project_template_step.dart`
- Modify: `apps/desktop_flutter/lib/features/projects/models/project_instance.dart`
- Modify: `apps/desktop_flutter/lib/features/projects/views/projects_view.dart`

Also check and update `apps/desktop_flutter/lib/features/projects/data/project_template_data_source.dart` and the projects repository.

- [ ] **Step 1: Update `ProjectTemplateStep` Flutter model**

In `apps/desktop_flutter/lib/features/projects/models/project_template_step.dart`, add `assigneeId` and `assigneeName`:

```dart
class ProjectTemplateStep {
  ProjectTemplateStep({
    required this.id,
    required this.templateId,
    required this.title,
    required this.offsetDays,
    required this.sortOrder,
    this.offsetDescription,
    this.assigneeId,
    this.assigneeName,
  });

  factory ProjectTemplateStep.fromJson(Map<String, dynamic> json) {
    return ProjectTemplateStep(
      id: asString(json['id']) ?? '',
      templateId: asString(json['templateId']) ?? '',
      title: asString(json['title']) ?? '',
      offsetDays: asInt(json['offsetDays']) ?? 0,
      offsetDescription: asString(json['offsetDescription']),
      sortOrder: asInt(json['sortOrder']) ?? 0,
      assigneeId: asInt(json['assigneeId']),
      assigneeName: asString(json['assigneeName']),
    );
  }

  final String id;
  final String templateId;
  final String title;
  final int offsetDays;
  final String? offsetDescription;
  final int sortOrder;
  final int? assigneeId;
  final String? assigneeName;
}
```

- [ ] **Step 2: Update `ProjectInstanceStep` Flutter model**

In `apps/desktop_flutter/lib/features/projects/models/project_instance.dart`, add to `ProjectInstanceStep`:

```dart
// In constructor:
this.assigneeId,
this.assigneeName,

// In fromJson:
assigneeId: json['assigneeId'] as int?,
assigneeName: json['assigneeName'] as String?,

// As fields:
final int? assigneeId;
final String? assigneeName;
```

- [ ] **Step 3: Update project data source to send `assigneeId` on step create/update**

In `apps/desktop_flutter/lib/features/projects/data/project_template_data_source.dart` (check exact filename), find the `addStep` and `updateStep` HTTP calls. Add `assigneeId` to the request body:

```dart
// In addStep body map:
if (assigneeId != null) 'assigneeId': assigneeId,

// Update method signature to accept assigneeId:
Future<ProjectTemplateStep> addStep(
  String templateId,
  String title, {
  int offsetDays = 0,
  String? offsetDescription,
  int sortOrder = 0,
  int? assigneeId,
})
```

Do the same for `updateStep`.

Also update the instance step update call in `apps/desktop_flutter/lib/features/projects/data/projects_local_data_source.dart` (or equivalent instance data source) to pass `assigneeId`.

- [ ] **Step 4: Add `WorkspaceMemberPicker` to template step editor in `projects_view.dart`**

In `apps/desktop_flutter/lib/features/projects/views/projects_view.dart`, find the template step editor widget (the dialog or inline form where template steps are created/edited). Add a `WorkspaceMemberPicker` after the title field:

```dart
// At top of file, add imports:
import '../../../shared/widgets/workspace_member_picker.dart';
import '../../../app/core/workspace/workspace_controller.dart';

// In the step editor state, add:
int? _stepAssigneeId;

// In the step form UI, add after the title field:
const SizedBox(height: 8),
WorkspaceMemberPicker(
  workspaceMembers: context.read<WorkspaceController>().members,
  selectedUserId: _stepAssigneeId,
  onChanged: (v) => setState(() => _stepAssigneeId = v),
  label: 'Assign step',
),

// When saving the step, pass assigneeId: _stepAssigneeId
```

- [ ] **Step 5: Add assignee display + picker to instance step editor in `projects_view.dart`**

Find where project instance steps are displayed (the step cards in an active project). Show the `assigneeName` if set, and if the current user is the project owner, show a `WorkspaceMemberPicker` to reassign:

```dart
// In the instance step card, add:
if (step.assigneeName != null) ...[
  const SizedBox(height: 4),
  Row(
    children: [
      const Icon(Icons.person_outline, size: 14, color: Color(0xFF6B7280)),
      const SizedBox(width: 4),
      Text(
        step.assigneeName!,
        style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
      ),
    ],
  ),
],
// If owner, show picker to reassign:
if (isOwner)
  WorkspaceMemberPicker(
    workspaceMembers: context.read<WorkspaceController>().members,
    selectedUserId: step.assigneeId,
    onChanged: (v) async {
      await projectController.updateInstanceStep(
        step.id,
        assigneeId: v,
      );
    },
    label: 'Assign',
  ),
```

- [ ] **Step 6: Run `flutter analyze --no-fatal-infos`**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

Fix any errors, then:

- [ ] **Step 7: Run `dart format .`**

```bash
cd apps/desktop_flutter && dart format .
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop_flutter/lib/features/projects/
git commit -m "feat: add step-level assignee to project templates and instances"
```

---

## Task 10: Flutter — Settings Admin Direct-Add Member

**Files:**
- Modify: `apps/desktop_flutter/lib/features/settings/views/settings_view.dart`
- Modify: `apps/desktop_flutter/lib/app/core/workspace/workspace_data_source.dart`
- Modify: `apps/desktop_flutter/lib/app/core/workspace/workspace_controller.dart`

- [ ] **Step 1: Add `addMemberDirect` to `WorkspaceDataSource`**

In `apps/desktop_flutter/lib/app/core/workspace/workspace_data_source.dart`, add:

```dart
Future<List<WorkspaceMember>> addMemberDirect(int userId) async {
  final uri = Uri.parse('$_baseUrl/workspaces/me/members/add');
  final response = await http.post(
    uri,
    headers: {
      'Content-Type': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    },
    body: jsonEncode({'userId': userId}),
  );
  if (response.statusCode != 200) {
    throw Exception('Failed to add member: ${response.body}');
  }
  final List<dynamic> data = jsonDecode(response.body) as List<dynamic>;
  return data
      .map((m) => WorkspaceMember.fromJson(m as Map<String, dynamic>))
      .toList();
}
```

- [ ] **Step 2: Add `addMemberDirect` to `WorkspaceController`**

In `apps/desktop_flutter/lib/app/core/workspace/workspace_controller.dart`, add:

```dart
Future<void> addMemberDirect(int userId) async {
  try {
    _members = await _repository.addMemberDirect(userId);
    notifyListeners();
  } catch (e) {
    // silently log — settings view will show snackbar
    rethrow;
  }
}
```

Also add the method to `WorkspaceRepository`:
```dart
// In workspace_repository.dart:
Future<List<WorkspaceMember>> addMemberDirect(int userId) async {
  return await _dataSource.addMemberDirect(userId);
}
```

- [ ] **Step 3: Add "Add member" button and search dialog to `settings_view.dart`**

In `apps/desktop_flutter/lib/features/settings/views/settings_view.dart`, find the workspace section where members are listed. After the members list, add (admin-only):

```dart
if (auth.isWorkspaceAdmin) ...[
  const SizedBox(height: 12),
  OutlinedButton.icon(
    icon: const Icon(Icons.person_add_outlined, size: 16),
    label: const Text('Add member'),
    onPressed: () => _showAddMemberDialog(context),
    style: OutlinedButton.styleFrom(
      foregroundColor: const Color(0xFF4F6AF5),
      side: const BorderSide(color: Color(0xFF4F6AF5)),
    ),
  ),
],
```

Add `_showAddMemberDialog` to the settings view state or as a function:

```dart
Future<void> _showAddMemberDialog(BuildContext context) async {
  // Fetch all users to search from
  // Use a simple text field to filter by name
  final ctrl = TextEditingController();
  int? selectedUserId;

  // Load all users via http GET /users using the server config base URL
  final baseUrl = context.read<ServerConfigService>().url;
  final token = context.read<AuthSessionService>().token;
  final usersRes = await http.get(
    Uri.parse('$baseUrl/users'),
    headers: {'Authorization': 'Bearer $token'},
  );
  if (!context.mounted) return;
  final allUsers = (jsonDecode(usersRes.body) as List<dynamic>)
      .map((u) => u as Map<String, dynamic>)
      .toList();
  final workspaceController = context.read<WorkspaceController>();
  final existingIds = workspaceController.members.map((m) => m.userId).toSet();

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setDialogState) {
        final query = ctrl.text.toLowerCase();
        final filtered = allUsers
            .where((u) =>
                !existingIds.contains(u['id'] as int) &&
                (u['name'] as String? ?? '').toLowerCase().contains(query))
            .toList();
        return AlertDialog(
          title: const Text('Add workspace member'),
          content: SizedBox(
            width: 320,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: ctrl,
                  autofocus: true,
                  decoration: const InputDecoration(
                    hintText: 'Search by name...',
                    isDense: true,
                  ),
                  onChanged: (_) => setDialogState(() {}),
                ),
                const SizedBox(height: 8),
                if (filtered.isEmpty)
                  const Text('No users found', style: TextStyle(color: Color(0xFF9CA3AF)))
                else
                  ...filtered.take(8).map(
                    (u) => RadioListTile<int>(
                      value: u['id'] as int,
                      groupValue: selectedUserId,
                      title: Text(u['name'] as String? ?? ''),
                      subtitle: Text(u['email'] as String? ?? ''),
                      onChanged: (v) => setDialogState(() => selectedUserId = v),
                      dense: true,
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: selectedUserId == null ? null : () => Navigator.pop(ctx, true),
              child: const Text('Add'),
            ),
          ],
        );
      },
    ),
  );

  if (confirmed == true && selectedUserId != null && context.mounted) {
    try {
      await context.read<WorkspaceController>().addMemberDirect(selectedUserId!);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Member added')),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to add member: $e')),
      );
    }
  }
}
```

Add necessary imports at top of `settings_view.dart`:
```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/server/server_config_service.dart';
```

(Check whether these are already imported — only add the missing ones.)

- [ ] **Step 4: Run `flutter analyze --no-fatal-infos`**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

- [ ] **Step 5: Run `dart format .`**

```bash
cd apps/desktop_flutter && dart format .
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop_flutter/lib/features/settings/views/settings_view.dart \
        apps/desktop_flutter/lib/app/core/workspace/workspace_data_source.dart \
        apps/desktop_flutter/lib/app/core/workspace/workspace_controller.dart \
        apps/desktop_flutter/lib/app/core/workspace/workspace_repository.dart
git commit -m "feat: admin can add workspace members directly from Settings"
```

---

## Task 11: Create GitHub Notifications Issue + PR

- [ ] **Step 1: Create GitHub issue for notifications feature**

```bash
gh issue create \
  --title "feat: in-app notifications for task/rhythm/project assignments and completions" \
  --body "$(cat <<'EOF'
## Overview

Phase 8 wired up owner/collaborator assignments across Tasks, Rhythms, Projects, and Weekly Planner. The next step is delivering notifications so staff know when:

- A task is assigned to them (owner set)
- They are added as a collaborator on a task, rhythm, or project
- A rhythm step they are waiting on is completed (so they know the next step is theirs)
- A project step assigned to them becomes due

## Scope

- [ ] Notification model + DB table (type, recipient_user_id, entity_type, entity_id, message, read_at, created_at)
- [ ] API endpoints: GET /notifications (unread), POST /notifications/:id/read, POST /notifications/read-all
- [ ] Server-side triggers: create notification rows when collaborators are added, when steps complete, when ownership changes
- [ ] Flutter: notification bell icon in app shell header with unread count badge
- [ ] Flutter: notification panel (slide-out or dropdown) with mark-read and navigate-to-item

## Out of Scope (for now)
- Push notifications / OS-level alerts
- Email notifications
- Real-time push via WebSocket (polling on app focus is acceptable MVP)

## Notes
- Notification delivery is currently out of scope for Phase 8. This issue tracks the full implementation as a future milestone.
EOF
)"
```

- [ ] **Step 2: Run full test suite**

```bash
cd apps/api_server && npx vitest run
cd ../desktop_flutter && flutter test
```

Expected: all pass.

- [ ] **Step 3: Run `flutter analyze --no-fatal-infos`**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create \
  --title "feat: Phase 8 — collaboration consistency across all screens" \
  --body "$(cat <<'EOF'
## Summary

- Rhythm step assignee picker now workspace-filtered (was showing all users)
- Rhythm-level collaborators: owner can add/remove collaborators; only owners and collaborators see a rhythm
- Project template steps have `assigneeId`; assignments carry over to instances automatically
- Project instance steps show assignee name; owners can reassign
- Weekly Planner create-task dialogs include owner picker
- Weekly Planner detail pane shows owner picker + collaborators row
- Tasks: removed redundant "shared" badge
- Settings: admin can add workspace members directly (search by name, no join code needed)
- Notifications feature tracked in GitHub issue for future milestone

## Test plan
- [ ] Create a rhythm, add a step, assign it to a workspace member — verify picker only shows workspace members
- [ ] Add a collaborator to the rhythm — verify they can see it, owner can remove them
- [ ] Create a project template with step assignees — launch instance — verify assignees copy over
- [ ] Reassign a step in a live project instance — verify it changes without affecting template
- [ ] Create a task from weekly planner — assign owner — verify task card shows collaborator row
- [ ] Open detail pane on an existing task — change owner — verify it saves
- [ ] Admin adds a member directly from Settings — verify they appear in member list

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Tasks: owner + collaborators, workspace-filtered — Task 7 + existing Phase 7 code
- [x] Rhythms: workspace-filtered step picker — Task 6
- [x] Rhythms: multiple collaborators, only visible to owner/collaborators — Tasks 2 + 6
- [x] Weekly Planner: owner in create dialog — Task 8
- [x] Weekly Planner: owner/collaborators in inspector — Task 8
- [x] Projects: step assignees set in template, copy to instance — Tasks 3 + 9
- [x] Projects: reassign steps in live instance — Task 9
- [x] Universal workspace restriction — Tasks 2, 5, 6, 8, 9 all use WorkspaceMemberPicker
- [x] Admin direct-add workspace member — Tasks 4 + 10
- [x] Notifications issue — Task 11
