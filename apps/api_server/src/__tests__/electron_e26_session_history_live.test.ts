import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { SessionHistoryPage } from '../repositories/agent_sessions_repository';

// Manager runs ONLY after rebuilding/restarting the shared sandbox. This test
// starts no servers, sends no prompts, and deletes only its UUID-namespaced rows.
describe.skipIf(process.env.RHYTHM_LIVE_E2E !== '1')('E26 live sandbox HTTP history', () => {
  it('E26-c10: real HTTP sees old/search/child history, stable continuation and bounded errors', async () => {
    const base = process.env.E26_API_URL ?? 'http://127.0.0.1:7698';
    expect(base).toBe('http://127.0.0.1:7698');
    const sandbox = realpathSync(process.env.RHYTHM_SANDBOX_DIR!);
    expect(sandbox.startsWith('/private/tmp/') || sandbox.startsWith('/private/var/folders/')).toBe(true);
    const dbPath = realpathSync(path.join(sandbox, 'rhythm.db'));
    expect(path.dirname(dbPath)).toBe(sandbox);
    const token = process.env.E26_AUTH_TOKEN;
    expect(token, 'explicit synthetic sandbox token required').toBeTruthy();
    const headers = { Authorization: `Bearer ${token}` };
    const health = await fetch(`${base}/opencode/health`, { headers });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ready' });
    // Refuse the old API before creating fixtures.
    const probe = await fetch(`${base}/agent-sessions?limit=1`, { headers });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toHaveProperty('pageInfo.limit', 1);

    const db = new Database(dbPath, { fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    const prefix = `e26-${randomUUID()}`;
    const projectId = `${prefix}-project`;
    const parentId = `${prefix}-parent`;
    const needle = `${prefix}-needle`;
    const insert = db.prepare(`INSERT INTO agent_sessions
      (id, agent_kind, status, cwd, name, project_id, parent_session_id, last_preview, created_at, updated_at)
      VALUES (?, '', 'closed', ?, ?, ?, ?, ?, ?, ?)`);
    const seed = (suffix: string, name: string, parent: string | null = null, preview: string | null = null, time = '2026-01-01') => {
      const id = `${prefix}-${suffix}`;
      insert.run(id, sandbox, name, projectId, parent, preview, time, time);
      return id;
    };
    const get = async (query: Record<string, string>) => {
      const response = await fetch(`${base}/agent-sessions?${new URLSearchParams({ projectId, ...query })}`, { headers });
      const body = await response.json();
      expect(response.status).toBe(200);
      return body as SessionHistoryPage & { resumable: unknown[] };
    };
    try {
      db.transaction(() => {
        db.prepare('INSERT INTO projects (id, name, cwd, created_at) VALUES (?, ?, ?, ?)').run(projectId, prefix, sandbox, '2026-01-01');
        seed('old', needle);
        seed('parent', 'nonmatching parent');
        for (let i = 0; i < 105; i++) seed(`root-${String(i).padStart(3, '0')}`, 'recent root', null, null, '2026-02-01');
        for (let i = 0; i < 164; i++) seed(`child-${String(i).padStart(3, '0')}`, 'child', parentId, i === 163 ? needle.toUpperCase() : null);
      })();
      const legacy = await get({});
      expect(Object.keys(legacy).sort()).toEqual(['resumable', 'sessions']);
      expect(legacy.sessions).toHaveLength(100);
      expect(legacy.sessions.some(s => s.id === `${prefix}-old`)).toBe(false);
      const found = await get({ search: `  ${needle.toUpperCase()}  ` });
      expect(found.sessions.map(s => s.id).sort()).toEqual([`${prefix}-child-163`, `${prefix}-old`]);
      expect(found.ancestors.map(s => s.id)).toEqual([parentId]);
      expect(found.ancestors[0]).toMatchObject({ childCount: 164, runningChildCount: 0, hasChildren: true });

      const first = await get({ limit: '100' });
      expect(first.sessions).toHaveLength(100);
      expect(first.pageInfo.hasMore).toBe(true);
      const updatedId = first.sessions[0].id;
      seed('concurrent', 'new insert', null, null, '2028-01-01');
      db.prepare("UPDATE agent_sessions SET last_activity_at = '2020-01-01' WHERE id = ?").run(updatedId);
      const second = await get({ limit: '100', cursor: first.pageInfo.nextCursor! });
      const rootIds = [...first.sessions, ...second.sessions].map(s => s.id);
      expect(rootIds).toHaveLength(107);
      expect(new Set(rootIds).size).toBe(107);
      expect(rootIds).not.toContain(`${prefix}-concurrent`);
      expect(second.pageInfo.hasMore).toBe(false);
      let cursor: string | null = null;
      const childIds: string[] = [];
      const childPageSizes: number[] = [];
      do {
        const result = await get({ parentId, limit: '100', ...(cursor ? { cursor } : {}) });
        expect(result.sessions.length).toBeLessThanOrEqual(100);
        childPageSizes.push(result.sessions.length);
        expect(result.sessions.every((session) => session.childCount === 0 && session.runningChildCount === 0)).toBe(true);
        childIds.push(...result.sessions.map(s => s.id));
        cursor = result.pageInfo.nextCursor;
      } while (cursor);
      expect(childPageSizes).toEqual([100, 64]);
      expect(childIds).toHaveLength(164);
      expect(new Set(childIds).size).toBe(164);
      for (const query of ['limit=101', 'limit=0', 'cursor=invalid']) {
        const response = await fetch(`${base}/agent-sessions?${query}`, { headers });
        const text = await response.text();
        expect(response.status).toBe(400);
        expect(text.length).toBeLessThan(500);
      }
    } finally {
      db.transaction(() => {
        db.prepare('DELETE FROM agent_sessions WHERE project_id = ? AND parent_session_id IS NOT NULL').run(projectId);
        db.prepare('DELETE FROM agent_sessions WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      })();
      db.close();
    }
  }, 60_000);
});
