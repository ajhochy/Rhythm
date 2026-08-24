import Database from 'better-sqlite3';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

type SqliteDb = Database.Database;

function createDb(): SqliteDb {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return db;
}

function seedScopeReferences(db: SqliteDb): {
  ownerUserId: number;
  projectId: string;
  taskId: string;
  scheduledTaskId: string;
} {
  const ownerUserId = Number(
    db.prepare(
      `INSERT INTO users (name, email, google_sub)
       VALUES ('Delegation Owner', 'delegation-owner@example.com', 'delegation-owner')`,
    ).run().lastInsertRowid,
  );
  const projectId = 'project-delegated-scope';
  const taskId = 'task-delegated-scope';
  const scheduledTaskId = 'scheduled-delegated-scope';
  db.prepare(
    `INSERT INTO projects
       (id, name, cwd, vcs_dirty, created_at)
     VALUES (?, 'Delegation project', '/tmp/delegated-scope', 0, ?)`,
  ).run(projectId, new Date().toISOString());
  db.prepare(`INSERT INTO tasks (id, title) VALUES (?, 'Delegation task')`).run(taskId);
  db.prepare(
    `INSERT INTO agent_scheduled_tasks
       (id, name, prompt, created_by_user_id)
     VALUES (?, 'Delegation schedule', 'Run delegated work', ?)`,
  ).run(scheduledTaskId, ownerUserId);
  return { ownerUserId, projectId, taskId, scheduledTaskId };
}

function stampParentScope(
  db: SqliteDb,
  parentId: string,
  refs: ReturnType<typeof seedScopeReferences>,
  category: 'chat' | 'scheduled' | 'self_improvement',
  isSystem: number,
): void {
  db.prepare(
    `UPDATE agent_sessions
        SET task_id = ?,
            task_title = 'Delegation task',
            project_id = ?,
            scheduled_task_id = ?,
            is_system = ?,
            anthropic_account_id = 'anthropic-parent',
            owner_user_id = ?,
            delegation_depth = 1,
            category = ?,
            worktree_name = 'delegated-worktree',
            worktree_path = '/tmp/delegated-scope/.worktrees/child',
            worktree_branch = 'feature/delegated-scope'
      WHERE id = ?`,
  ).run(
    refs.taskId,
    refs.projectId,
    category === 'scheduled' ? refs.scheduledTaskId : null,
    isSystem,
    refs.ownerUserId,
    category,
    parentId,
  );
}

function scopeSnapshot(db: SqliteDb, id: string) {
  return db.prepare(
    `SELECT task_id, task_title, project_id, scheduled_task_id, is_system,
            anthropic_account_id, owner_user_id, delegation_depth, category,
            worktree_name, worktree_path, worktree_branch
       FROM agent_sessions
      WHERE id = ?`,
  ).get(id) as Record<string, unknown>;
}

function totalChanges(db: SqliteDb): number {
  return db.prepare(`SELECT total_changes()`).pluck().get() as number;
}

describe('delegated-session isolation', () => {
  let db: SqliteDb;
  let repo: AgentSessionsRepository;

  beforeEach(() => {
    db = createDb();
    repo = new AgentSessionsRepository();
  });

  it('issue-r1-delegated-session-isolation-c1: scheduled children inherit the complete parent scope', () => {
    // Regression caught: a scheduled parent spawning a child left category,
    // is_system and scheduled_task_id at Chat defaults.
    const refs = seedScopeReferences(db);
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/delegated-scope',
      name: 'Scheduled parent',
    });
    stampParentScope(db, parent.id, refs, 'scheduled', 1);
    repo.setSdkSessionId(parent.id, 'sdk-scheduled-parent');

    const child = repo.upsertChildSession(
      'sdk-scheduled-child',
      'sdk-scheduled-parent',
      'Scheduled specialist (@research subagent)',
      '/tmp/delegated-scope',
    );

    expect(child).not.toBeNull();
    expect(scopeSnapshot(db, child!.id)).toEqual({
      task_id: refs.taskId,
      task_title: 'Delegation task',
      project_id: refs.projectId,
      scheduled_task_id: refs.scheduledTaskId,
      is_system: 1,
      anthropic_account_id: 'anthropic-parent',
      owner_user_id: refs.ownerUserId,
      delegation_depth: 2,
      category: 'scheduled',
      worktree_name: 'delegated-worktree',
      worktree_path: '/tmp/delegated-scope/.worktrees/child',
      worktree_branch: 'feature/delegated-scope',
    });
    expect(repo.listAll(100, { scope: 'chats' }).map(({ id }) => id)).not.toContain(child!.id);
    expect(repo.listAll(100, { scope: 'scheduled' }).map(({ id }) => id)).toContain(child!.id);
  });

  it('issue-r1-delegated-session-isolation-c2: self-improvement children inherit parent classification', () => {
    // Regression caught: self-improvement child rows appeared in Chats because
    // the insert omitted category and is_system.
    const refs = seedScopeReferences(db);
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/delegated-scope',
      name: 'Self-improvement parent',
    });
    stampParentScope(db, parent.id, refs, 'self_improvement', 1);
    repo.setSdkSessionId(parent.id, 'sdk-self-parent');

    const child = repo.upsertChildSession(
      'sdk-self-child',
      'sdk-self-parent',
      'Curator specialist',
      '/tmp/delegated-scope',
    );

    expect(child).toMatchObject({
      category: 'self_improvement',
      isSystem: true,
      scheduledTaskId: null,
      ownerUserId: refs.ownerUserId,
      projectId: refs.projectId,
      delegationDepth: 2,
    });
    expect(repo.listAll(100, { scope: 'chats' }).map(({ id }) => id)).not.toContain(child!.id);
    expect(repo.listAll(100, { scope: 'self_improvement' }).map(({ id }) => id)).toContain(child!.id);
  });

  it('issue-r1-delegated-session-isolation-c3: plain chat children retain chat classification and appear in Chats (grouped under parent client-side)', () => {
    // AJ 2026-08-11: #1348's chats-scope exclusion of delegated children is
    // reverted. Children retain their inherited Chat classification AND are
    // returned by the Chats scope, carrying a parentSessionId so the desktop
    // groups them under their parent as a collapsed "N subagents" group (#910).
    const refs = seedScopeReferences(db);
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/delegated-scope',
      name: 'Chat parent',
      ownerUserId: refs.ownerUserId,
      projectId: refs.projectId,
      category: 'chat',
      isSystem: false,
    });
    repo.setSdkSessionId(parent.id, 'sdk-chat-parent');

    const child = repo.upsertChildSession(
      'sdk-chat-child',
      'sdk-chat-parent',
      'Chat specialist',
      '/tmp/delegated-scope',
    );

    expect(child).toMatchObject({
      category: 'chat',
      isSystem: false,
      scheduledTaskId: null,
      ownerUserId: refs.ownerUserId,
      projectId: refs.projectId,
      delegationDepth: 1,
    });
    expect(repo.listAll(100).map(({ id }) => id)).toContain(child!.id);
    expect(repo.listAll(100, { scope: 'chats' }).map(({ id }) => id)).toContain(child!.id);
  });

  it('issue-r1-delegated-session-isolation-c4: SQLite migration repairs only Chat children of non-Chat parents', () => {
    // Regression caught: an unguarded migration could rewrite unrelated
    // historical Chats or leave already-created scheduled children visible.
    const refs = seedScopeReferences(db);
    const scheduledParent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/delegated-scope',
      name: 'Scheduled parent',
    });
    stampParentScope(db, scheduledParent.id, refs, 'scheduled', 1);
    repo.setSdkSessionId(scheduledParent.id, 'sdk-backfill-parent');
    const leakedChild = repo.upsertChildSession(
      'sdk-backfill-child',
      'sdk-backfill-parent',
      'Leaked scheduled child',
      '/tmp/delegated-scope',
    )!;
    db.prepare(
      `UPDATE agent_sessions
          SET task_id = NULL,
              task_title = NULL,
              project_id = NULL,
              scheduled_task_id = NULL,
              is_system = 0,
              anthropic_account_id = NULL,
              owner_user_id = NULL,
              delegation_depth = 0,
              category = 'chat',
              worktree_name = NULL,
              worktree_path = NULL,
              worktree_branch = NULL
        WHERE id = ?`,
    ).run(leakedChild.id);

    const unrelatedTopLevel = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/unrelated',
      name: 'Unrelated historical Chat',
    });
    const chatParent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/unrelated',
      name: 'Chat parent',
    });
    repo.setSdkSessionId(chatParent.id, 'sdk-unrelated-chat-parent');
    const unrelatedChatChild = repo.upsertChildSession(
      'sdk-unrelated-chat-child',
      'sdk-unrelated-chat-parent',
      'Unrelated Chat child',
      '/tmp/unrelated',
    )!;
    const unrelatedBefore = [
      scopeSnapshot(db, unrelatedTopLevel.id),
      scopeSnapshot(db, unrelatedChatChild.id),
    ];

    runMigrations(db);

    expect(scopeSnapshot(db, leakedChild.id)).toMatchObject({
      category: 'scheduled',
      is_system: 1,
      scheduled_task_id: refs.scheduledTaskId,
      owner_user_id: refs.ownerUserId,
      project_id: refs.projectId,
    });
    expect([
      scopeSnapshot(db, unrelatedTopLevel.id),
      scopeSnapshot(db, unrelatedChatChild.id),
    ]).toEqual(unrelatedBefore);
  });

  it('issue-r1-delegated-session-isolation-c4: SQLite backfill is narrow and converges to zero changes', () => {
    // Regression caught: a restart-time repair without a convergent predicate
    // would keep rewriting rows on every boot.
    const refs = seedScopeReferences(db);
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/delegated-scope',
      name: 'Backfill parent',
    });
    stampParentScope(db, parent.id, refs, 'self_improvement', 1);
    const child = repo.insert({
      agentKind: 'research' as never,
      taskId: null,
      cwd: '/tmp/delegated-scope',
      name: 'Misclassified child',
    });
    db.prepare(
      `UPDATE agent_sessions SET parent_session_id = ? WHERE id = ?`,
    ).run(parent.id, child.id);

    const beforeFirstRun = totalChanges(db);
    runMigrations(db);
    expect(totalChanges(db) - beforeFirstRun).toBe(1);
    const beforeSecondRun = totalChanges(db);
    runMigrations(db);
    expect(totalChanges(db) - beforeSecondRun).toBe(0);
    expect(repo.findById(child.id)).toMatchObject({
      category: 'self_improvement',
      isSystem: true,
      parentSessionId: parent.id,
    });
  });

  it('issue-r1-delegated-session-isolation-c5: Postgres bootstrap installs equivalent pending resolution and scope repair', async () => {
    // Regression caught: shipping only SQLite SQL leaves production Postgres
    // children classified as Chats or crashes bootstrap on the missing table.
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await runPostgresBootstrap({
      query,
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as unknown as Pool);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS agent_pending_child_sessions/i);
    expect(sql).toMatch(
      /UPDATE agent_sessions AS child[\s\S]*FROM agent_sessions AS parent[\s\S]*child\.category = 'chat'[\s\S]*parent\.category <> 'chat'/i,
    );
  });

  it('issue-r1-delegated-session-isolation-c6: an unresolved child is durably resolved when its parent SDK id arrives', () => {
    // Regression caught: session.created can beat setSdkSessionId; an
    // in-memory-only retry loses the child forever across a restart.
    const refs = seedScopeReferences(db);
    const unresolved = repo.upsertChildSession(
      'sdk-late-child',
      'sdk-late-parent',
      'Late specialist (@research subagent)',
      '/tmp/delegated-scope',
    );
    expect(unresolved).toBeNull();
    const pendingTable = db.prepare(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'table'
          AND name = 'agent_pending_child_sessions'`,
    ).get();
    expect(pendingTable).toEqual({ name: 'agent_pending_child_sessions' });
    if (!pendingTable) return;
    expect(
      db.prepare(
        `SELECT child_sdk_session_id
           FROM agent_pending_child_sessions
          WHERE child_sdk_session_id = ?`,
      ).get('sdk-late-child'),
    ).toEqual({ child_sdk_session_id: 'sdk-late-child' });

    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/delegated-scope',
      name: 'Late parent',
    });
    stampParentScope(db, parent.id, refs, 'scheduled', 1);
    repo.setSdkSessionId(parent.id, 'sdk-late-parent');

    expect(repo.findBySdkSessionId('sdk-late-child')).toMatchObject({
      parentSessionId: parent.id,
      category: 'scheduled',
      isSystem: true,
      scheduledTaskId: refs.scheduledTaskId,
      ownerUserId: refs.ownerUserId,
      projectId: refs.projectId,
    });
    expect(
      db.prepare(
        `SELECT 1 FROM agent_pending_child_sessions WHERE child_sdk_session_id = ?`,
      ).get('sdk-late-child'),
    ).toBeUndefined();
  });
});
