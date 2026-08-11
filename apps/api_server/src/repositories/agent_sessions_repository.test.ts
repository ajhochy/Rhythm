import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentSessionsRepository } from './agent_sessions_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('AgentSessionsRepository', () => {
  it('persists an explicit plan permission mode at session creation', () => {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Plan at creation',
      permissionMode: 'plan',
    } as Parameters<AgentSessionsRepository['insert']>[0] & { permissionMode: 'plan' });

    expect(session.permissionMode).toBe('plan');
    expect(repo.findById(session.id)?.permissionMode).toBe('plan');
  });

  let repo: AgentSessionsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSessionsRepository();
  });

  it('insert creates a session with status starting', () => {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/test',
      name: 'Test Session',
    });

    expect(session.id).toBeTypeOf('string');
    expect(session.id).toHaveLength(36); // UUID v4 length
    expect(session.agentKind).toBe('claude-code');
    expect(session.status).toBe('starting');
    expect(session.taskId).toBeNull();
    expect(session.cwd).toBe('/tmp/test');
    expect(session.name).toBe('Test Session');
    expect(session.sessionToken).toBeNull();
    expect(session.createdAt).toBeTypeOf('string');
    expect(session.updatedAt).toBeTypeOf('string');
  });

  it('listAll returns all sessions', () => {
    repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'A' });
    repo.insert({ agentKind: 'codex', taskId: null, cwd: '/b', name: 'B' });

    const sessions = repo.listAll();
    expect(sessions).toHaveLength(2);
    const names = sessions.map((s) => s.name);
    expect(names).toContain('A');
    expect(names).toContain('B');
  });

  it('listAll respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: `Session ${i}` });
    }
    const sessions = repo.listAll(3);
    expect(sessions).toHaveLength(3);
  });

  it('updateStatus changes the session status', () => {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Status Test',
    });

    repo.updateStatus(session.id, 'working');
    const updated = repo.findById(session.id);
    expect(updated?.status).toBe('working');
  });

  it('markClosed sets status to closed', () => {
    const session = repo.insert({
      agentKind: 'codex',
      taskId: null,
      cwd: '/tmp',
      name: 'Close Test',
    });

    repo.markClosed(session.id);
    const closed = repo.findById(session.id);
    expect(closed?.status).toBe('closed');
  });

  it('listActive returns only starting/working/idle sessions', () => {
    const s1 = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'A' });
    const s2 = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/b', name: 'B' });
    repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/c', name: 'C' });

    repo.updateStatus(s1.id, 'working');
    repo.updateStatus(s2.id, 'closed');

    const active = repo.listActive();
    // s1 (working) and C (starting) should be active, s2 (closed) should not
    expect(active).toHaveLength(2);
    expect(active.every((s) => ['starting', 'working', 'idle'].includes(s.status))).toBe(true);
  });

  it('listResumable returns only sessions with status resumable and a session_token', () => {
    const s1 = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'A' });
    const s2 = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/b', name: 'B' });

    repo.updateStatus(s1.id, 'resumable');
    repo.updateToken(s1.id, 'abc123');
    repo.updateStatus(s2.id, 'resumable');
    // s2 has no token

    const resumable = repo.listResumable();
    expect(resumable).toHaveLength(1);
    expect(resumable[0].id).toBe(s1.id);
  });

  it('findById returns null for non-existent id', () => {
    const result = repo.findById('non-existent-id');
    expect(result).toBeNull();
  });

  it('deleteOlderThan removes old CLOSED sessions and returns count', () => {
    const s1 = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'A' });
    const s2 = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/b', name: 'B' });
    // Mark both closed — deleteOlderThan only prunes closed sessions
    repo.markClosed(s1.id);
    repo.markClosed(s2.id);

    // Use a future cutoff to delete all closed sessions
    const cutoff = new Date(Date.now() + 60_000).toISOString();
    const deleted = repo.deleteOlderThan(cutoff);
    expect(deleted).toBe(2);
    expect(repo.listAll()).toHaveLength(0);
  });

  it('deleteOlderThan does NOT remove active or resumable sessions', () => {
    const s1 = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'A' });
    const s2 = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/b', name: 'B' });
    // s1 stays in 'starting'; s2 is resumable
    repo.updateStatus(s2.id, 'resumable');
    repo.updateToken(s2.id, 'tok123');

    const cutoff = new Date(Date.now() + 60_000).toISOString();
    const deleted = repo.deleteOlderThan(cutoff);
    expect(deleted).toBe(0);
    expect(repo.listAll()).toHaveLength(2);
  });

  // USO A1 (#1024) / B1 (#1028) — scope-aware listAll.
  describe('listAll scope', () => {
    function seedScheduledTask(id: string) {
      getDb()
        .prepare(`INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)`)
        .run(id, `Task ${id}`, 'do the thing');
    }

    beforeEach(() => {
      seedScheduledTask('sched-1');
    });

    it('no scope === scope:chats === is_system=0 interactive set', () => {
      const chat = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Chat' });
      repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Scheduled',
        scheduledTaskId: 'sched-1', isSystem: true,
      });
      repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'SelfImprove',
        isSystem: true, category: 'self_improvement',
      });

      const noScope = repo.listAll(100);
      const chats = repo.listAll(100, { scope: 'chats' });
      expect(noScope.map((s) => s.id)).toEqual([chat.id]);
      expect(chats.map((s) => s.id)).toEqual([chat.id]);
    });

    it('issue-1348-c1: chats scope returns roots and excludes delegated children', () => {
      // Regression caught: delegated rows inherit category=chat and
      // is_system=0, so filtering on only those columns floods Chats with
      // subagent runs.
      const parent = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Real chat',
      });
      repo.setSdkSessionId(parent.id, 'sdk-parent-1348');
      const child = repo.upsertChildSession(
        'sdk-child-1348',
        'sdk-parent-1348',
        'Delegated: Specialist',
        '/a',
      );

      expect(child?.parentSessionId).toBe(parent.id);
      expect(repo.listAll(100, { scope: 'chats' }).map((s) => s.id)).toEqual([
        parent.id,
      ]);
    });

    it('the three scopes return disjoint row sets', () => {
      const chat = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Chat' });
      const scheduled = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Scheduled',
        scheduledTaskId: 'sched-1', isSystem: true,
      });
      const selfImprove = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'SelfImprove',
        isSystem: true, category: 'self_improvement',
      });

      expect(repo.listAll(100, { scope: 'chats' }).map((s) => s.id)).toEqual([chat.id]);
      expect(repo.listAll(100, { scope: 'scheduled' }).map((s) => s.id)).toEqual([scheduled.id]);
      expect(repo.listAll(100, { scope: 'self_improvement' }).map((s) => s.id)).toEqual([selfImprove.id]);
    });

    it('scope:scheduled includes scheduled rows that chats excludes; rows carry parentSessionId', () => {
      const scheduled = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Scheduled',
        scheduledTaskId: 'sched-1', isSystem: true,
      });
      const chatsIds = repo.listAll(100, { scope: 'chats' }).map((s) => s.id);
      const scheduledRows = repo.listAll(100, { scope: 'scheduled' });
      expect(chatsIds).not.toContain(scheduled.id);
      expect(scheduledRows.map((s) => s.id)).toContain(scheduled.id);
      // parent_session_id is preserved on the returned model (null here).
      expect(scheduledRows[0]).toHaveProperty('parentSessionId', null);
    });
  });

  // USO B1 (#1028) — category stamping + legacy derive.
  describe('category', () => {
    function seedScheduledTask(id: string) {
      getDb()
        .prepare(`INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)`)
        .run(id, `Task ${id}`, 'do the thing');
    }

    it('stamps chat by default for interactive sessions', () => {
      const s = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Chat' });
      expect(s.category).toBe('chat');
    });

    it('derives scheduled when scheduledTaskId is set', () => {
      seedScheduledTask('sched-cat');
      const s = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Scheduled',
        scheduledTaskId: 'sched-cat', isSystem: true,
      });
      expect(s.category).toBe('scheduled');
    });

    it('honors an explicit self_improvement category', () => {
      const s = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'SelfImprove',
        isSystem: true, category: 'self_improvement',
      });
      expect(s.category).toBe('self_improvement');
    });

    it('backfills legacy rows: scheduled_task_id NOT NULL → scheduled, else chat', () => {
      seedScheduledTask('sched-legacy');
      // Simulate the state right after ADD COLUMN ... DEFAULT 'chat' but BEFORE
      // the backfill UPDATE: every pre-#1028 row carries the 'chat' default,
      // including scheduled ones. Force both to 'chat' to model that.
      const chat = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'LegacyChat' });
      const scheduled = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'LegacyScheduled',
        scheduledTaskId: 'sched-legacy', isSystem: true,
      });
      getDb().prepare(`UPDATE agent_sessions SET category = 'chat'`).run();
      // Re-run the migration's backfill statement.
      getDb()
        .prepare(`UPDATE agent_sessions SET category = 'scheduled' WHERE scheduled_task_id IS NOT NULL`)
        .run();

      expect(repo.findById(chat.id)?.category).toBe('chat');
      expect(repo.findById(scheduled.id)?.category).toBe('scheduled');
    });
  });

  // #904 — background loop activity log.
  describe('listByScheduledTaskId', () => {
    function seedScheduledTask(id: string) {
      getDb()
        .prepare(
          `INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)`,
        )
        .run(id, `Task ${id}`, 'do the thing');
    }

    beforeEach(() => {
      seedScheduledTask('sched-1');
      seedScheduledTask('sched-2');
    });

    it('returns only runs for the given scheduled task, most recent first', () => {
      const s1 = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Run 1',
        scheduledTaskId: 'sched-1', isSystem: true,
      });
      // Back-date s1 so ordering is deterministic regardless of the two
      // inserts landing within the same second-resolution timestamp.
      getDb()
        .prepare(`UPDATE agent_sessions SET created_at = ? WHERE id = ?`)
        .run(new Date(Date.now() - 60_000).toISOString(), s1.id);
      const s2 = repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Run 2',
        scheduledTaskId: 'sched-1', isSystem: true,
      });
      repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Other task run',
        scheduledTaskId: 'sched-2', isSystem: true,
      });

      const runs = repo.listByScheduledTaskId('sched-1');
      expect(runs.map((r) => r.id)).toEqual([s2.id, s1.id]);
    });

    it('includes is_system=1 rows (excluded from listAll/listByProject)', () => {
      repo.insert({
        agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'Background run',
        scheduledTaskId: 'sched-1', isSystem: true,
      });

      expect(repo.listByScheduledTaskId('sched-1')).toHaveLength(1);
      expect(repo.listAll()).toHaveLength(0);
    });

    it('returns an empty array for a task with no runs yet', () => {
      expect(repo.listByScheduledTaskId('never-run')).toEqual([]);
    });
  });
});
