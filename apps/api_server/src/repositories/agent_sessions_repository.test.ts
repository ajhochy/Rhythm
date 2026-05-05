import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from './agent_sessions_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('AgentSessionsRepository', () => {
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

  it('deleteOlderThan removes old sessions and returns count', () => {
    repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/a', name: 'A' });
    repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/b', name: 'B' });

    // Use a future cutoff to delete all sessions
    const cutoff = new Date(Date.now() + 60_000).toISOString();
    const deleted = repo.deleteOlderThan(cutoff);
    expect(deleted).toBe(2);
    expect(repo.listAll()).toHaveLength(0);
  });
});
