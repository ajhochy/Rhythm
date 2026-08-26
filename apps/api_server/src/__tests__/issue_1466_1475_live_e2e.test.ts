import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const apiBase = (process.env.RHYTHM_LIVE_API_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';

type Session = {
  id: string;
  parentSessionId: string | null;
  children?: Session[];
};

type Task = { id: string; status: string };

function assertIsolatedSandbox(): void {
  if (
    process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
    apiBase !== 'http://127.0.0.1:4098' ||
    !dbPath.startsWith('/') ||
    !sandboxDir.startsWith('/') ||
    resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
    dbPath.includes('/Library/Application Support/Rhythm/') ||
    !existsSync(dbPath)
  ) {
    throw new Error('Issues #1466/#1475 live E2E requires the attested isolated sandbox');
  }
}

async function api<T>(route: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${route}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.text();
  expect(response.ok, `${init.method ?? 'GET'} ${route} -> ${response.status}: ${body}`).toBe(true);
  return (body ? JSON.parse(body) : undefined) as T;
}

describeLive('issues #1466/#1475 live HTTP behavior', () => {
  const marker = randomUUID();
  const token = `issue-1466-1475-${marker}`;
  const rootId = `issue-1466-root-${marker}`;
  const childIds = Array.from({ length: 101 }, (_, index) => `issue-1466-child-${index}-${marker}`);
  const taskIds: string[] = [];
  let db: Database.Database;
  let userId = 0;

  beforeAll(() => {
    assertIsolatedSandbox();
    db = new Database(dbPath);
    userId = Number(db.prepare(
      'INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)',
    ).run('Issues 1466/1475 live', `issue-1466-1475-${marker}@example.test`, marker).lastInsertRowid);
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
      token,
      userId,
      new Date(Date.now() + 600_000).toISOString(),
    );

    const insertSession = db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, created_at, updated_at,
          parent_session_id, owner_user_id, category)
       VALUES (?, 'claude-code', 'idle', ?, ?, ?, ?, ?, ?, 'chat')`,
    );
    const oldTimestamp = '2000-01-01T00:00:00.000Z';
    insertSession.run(rootId, sandboxDir, `Issue 1466 root ${marker}`, oldTimestamp, oldTimestamp, null, userId);
    childIds.forEach((childId, index) => {
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      insertSession.run(childId, sandboxDir, `Issue 1466 child ${index}`, timestamp, timestamp, rootId, userId);
    });
  });

  afterAll(async () => {
    try {
      await Promise.all(taskIds.map(async (taskId) => {
        try {
          await api<void>(`/tasks/${taskId}`, token, { method: 'DELETE' });
        } catch {
          // Cleanup is best effort if the behavior assertion failed after delete.
        }
      }));
      if (db) {
        db.prepare('DELETE FROM agent_sessions WHERE id = ? OR parent_session_id = ?').run(rootId, rootId);
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        if (userId) db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
    } finally {
      db?.close();
    }
  });

  it('issue-1466: an old root remains top-level with all 101 newer children nested', async () => {
    // Regression caught: LIMIT before parent filtering consumes the page with
    // newer children and drops this deliberately old root.
    const body = await api<{ sessions: Session[] }>('/agent-sessions?scope=chats', token);
    const root = body.sessions.find((session) => session.id === rootId);
    expect(root).toBeDefined();
    expect(body.sessions.some((session) => childIds.includes(session.id))).toBe(false);
    expect(root?.children).toHaveLength(101);
    expect(root?.children?.map((child) => child.id).sort()).toEqual([...childIds].sort());
    expect(root?.children?.every((child) => child.parentSessionId === rootId)).toBe(true);
  });

  it('issue-1475: deferred survives mutations and the real Open/All/exact filters', async () => {
    // Regression caught: Deferred either fails to persist or leaks into Open
    // while disappearing from All/the exact deferred query.
    const created = await api<Task>('/tasks', token, {
      method: 'POST',
      body: JSON.stringify({ title: `Issue 1475 ${marker}`, status: 'deferred' }),
    });
    taskIds.push(created.id);
    expect(created.status).toBe('deferred');

    expect((await api<Task>(`/tasks/${created.id}`, token, {
      method: 'PATCH', body: JSON.stringify({ status: 'open' }),
    })).status).toBe('open');
    expect((await api<Task>(`/tasks/${created.id}`, token, {
      method: 'PATCH', body: JSON.stringify({ status: 'deferred' }),
    })).status).toBe('deferred');
    expect((await api<Task>(`/tasks/${created.id}`, token)).status).toBe('deferred');

    const open = await api<Task[]>('/tasks', token);
    const all = await api<Task[]>('/tasks?status=all', token);
    const deferred = await api<Task[]>('/tasks?status=deferred', token);
    expect(open.map((task) => task.id)).not.toContain(created.id);
    expect(all.map((task) => task.id)).toContain(created.id);
    expect(deferred.map((task) => task.id)).toContain(created.id);
    expect(deferred.find((task) => task.id === created.id)?.status).toBe('deferred');

    await api<void>(`/tasks/${created.id}`, token, { method: 'DELETE' });
    taskIds.splice(taskIds.indexOf(created.id), 1);
  });
});
