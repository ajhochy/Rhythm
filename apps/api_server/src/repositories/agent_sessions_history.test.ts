import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import * as history from './agent_sessions_repository';
import { UsersRepository } from './users_repository';

describe('E26 SQLite history contract', () => {
  let db: Database.Database;
  let queries: string[];
  const repo = new history.AgentSessionsRepository();
  const seed = (id: string, fields: Record<string, unknown> = {}) => {
    db.prepare(`INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, created_at, updated_at)
      VALUES (?, 'claude-code', 'closed', '/project/alpha', ?, '2026-01-01', '2026-01-01')`).run(id, id);
    for (const [key, value] of Object.entries(fields)) {
      db.prepare(`UPDATE agent_sessions SET ${key} = ? WHERE id = ?`).run(value, id);
    }
  };
  const page = (opts: Parameters<typeof history.listPage>[0] = {}) => {
    expect(history.listPage, 'E26 query path must exist without changing legacy methods').toBeTypeOf('function');
    return history.listPage(opts);
  };
  beforeEach(() => {
    queries = [];
    db = new Database(':memory:', { verbose: (sql) => queries.push(String(sql)) });
    runMigrations(db);
    setDb(db);
    new UsersRepository().create({ name: 'Owner', email: 'owner@example.test' });
    new UsersRepository().create({ name: 'Other', email: 'other@example.test' });
    for (const id of ['p', 'q']) db.prepare("INSERT INTO projects (id, name, cwd, created_at) VALUES (?, ?, '/tmp', '2026-01-01')").run(id, id);
  });
  afterEach(() => db.close());

  it('E26-c1: bounded deterministic COALESCE activity order reaches history beyond 100', () => {
    for (let i = 0; i < 105; i++) seed(`root-${String(i).padStart(3, '0')}`);
    seed('activity', { last_activity_at: '2026-03-01', updated_at: '2026-02-01' });
    seed('updated', { updated_at: '2026-02-01' });
    const first = page({ limit: 100 });
    expect(first.sessions).toHaveLength(100);
    expect(first.sessions.slice(0, 3).map(s => s.id)).toEqual(['activity', 'updated', 'root-104']);
    expect(first.pageInfo.hasMore).toBe(true);
    const second = page({ limit: 100, cursor: first.pageInfo.nextCursor! });
    expect(second.sessions.map(s => s.id)).toEqual(['root-006', 'root-005', 'root-004', 'root-003', 'root-002', 'root-001', 'root-000']);
    expect(second.pageInfo).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('E26-c2: frozen membership avoids duplicates and omissions after insert and backward/forward activity updates', () => {
    for (const id of ['a', 'b', 'c', 'd']) seed(id);
    const first = page({ limit: 2 });
    expect(first.sessions.map(s => s.id)).toEqual(['d', 'c']);
    seed('new', { last_activity_at: '2027-01-01' });
    db.prepare("UPDATE agent_sessions SET last_activity_at = '2020-01-01' WHERE id = 'd'").run();
    db.prepare("UPDATE agent_sessions SET last_activity_at = '2028-01-01' WHERE id = 'a'").run();
    const second = page({ limit: 2, cursor: first.pageInfo.nextCursor! });
    expect(second.sessions.map(s => s.id)).toEqual(['b', 'a']);
    expect(page({ limit: 2, cursor: first.pageInfo.nextCursor! }).sessions).toEqual(second.sessions);
    expect(page({ limit: 2 }).sessions.map(s => s.id)).toEqual(['a', 'new']);
  });

  it('E26-c3: trimmed case-insensitive literal search finds old roots and matching children with nonmatching ancestors', () => {
    seed('old', { name: 'Needle name' });
    for (let i = 0; i < 101; i++) seed(`new-${i}`, { updated_at: '2026-02-01' });
    seed('parent');
    seed('middle', { parent_session_id: 'parent' });
    seed('child', { parent_session_id: 'middle', last_preview: 'NEEDLE preview' });
    seed('path', { cwd: '/Needle/project' });
    seed('task', { task_title: 'Needle task' });
    db.prepare("UPDATE projects SET name = 'Needle project' WHERE id = 'p'").run();
    seed('project', { project_id: 'p' });
    expect(repo.listAll().map(s => s.id)).not.toContain('old');
    const found = page({ search: '  nEeDlE  ' });
    expect(found.sessions.map(s => s.id).sort()).toEqual(['child', 'old', 'path', 'project', 'task']);
    expect(found.ancestors.map(s => s.id).sort()).toEqual(['middle', 'parent']);
    expect(found.sessions.find(s => s.id === 'child')?.parentSessionId).toBe('middle');
    expect(page({ search: '%' }).sessions).toEqual([]);
  });

  it('E26-c4: scope/category, archived and project filters compose without exposing other owners', () => {
    seed('chat');
    seed('scheduled', { category: 'scheduled', is_system: 1, project_id: 'p', archived_at: '2026-02-01' });
    seed('other-project', { category: 'scheduled', is_system: 1, project_id: 'q', archived_at: '2026-02-01' });
    seed('private', { category: 'scheduled', project_id: 'p', archived_at: '2026-02-01', owner_user_id: 2 });
    seed('self', { category: 'self_improvement', is_system: 1 });
    expect(page().sessions.map(s => s.id)).toEqual(['chat']);
    expect(page({ scope: 'scheduled', archivedOnly: true, projectId: 'p', ownerUserId: 1 }).sessions.map(s => s.id)).toEqual(['scheduled']);
    expect(page({ scope: 'scheduled', projectId: 'p', ownerUserId: 1 }).sessions).toEqual([]);
    expect(page({ scope: 'scheduled', includeArchived: true, projectId: 'p', ownerUserId: 1 }).sessions.map(s => s.id)).toEqual(['scheduled']);
    expect(page({ scope: 'self_improvement' }).sessions.map(s => s.id)).toEqual(['self']);
    expect(page({ projectId: null }).sessions.map(s => s.id)).toEqual(['chat']);
  });

  it('E26-c5: every parent has explicit bounded child continuation past 500 and down another level', () => {
    seed('parent');
    for (let i = 0; i < 505; i++) seed(`child-${String(i).padStart(3, '0')}`, { parent_session_id: 'parent' });
    seed('grandchild', { parent_session_id: 'child-504' });
    expect(page().sessions[0]).toMatchObject({ id: 'parent', hasChildren: true });
    expect(history.listChildrenPage).toBeTypeOf('function');
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const result = history.listChildrenPage('parent', { limit: 100, cursor });
      expect(result.sessions.length).toBeLessThanOrEqual(100);
      ids.push(...result.sessions.map(s => s.id));
      cursor = result.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(505);
    expect(new Set(ids).size).toBe(505);
    expect(history.listChildrenPage('child-504', {}).sessions.map(s => s.id)).toEqual(['grandchild']);
  });

  it('subagent-counts-c1: one SQLite child-stats query returns exact direct totals with nested and filter isolation', () => {
    seed('zero', { project_id: 'p', owner_user_id: 1 });
    seed('parent-38', { project_id: 'p', owner_user_id: 1 });
    for (let i = 0; i < 38; i++) seed(`p38-child-${i}`, { parent_session_id: 'parent-38', project_id: 'p', owner_user_id: 1, status: 'working' });

    seed('parent-164', { project_id: 'p', owner_user_id: 1 });
    seed('nested-60', { parent_session_id: 'parent-164', project_id: 'p', owner_user_id: 1, status: 'working' });
    for (let i = 0; i < 163; i++) seed(`p164-child-${String(i).padStart(3, '0')}`, {
      parent_session_id: 'parent-164', project_id: 'p', owner_user_id: 1,
      status: i < 37 ? 'working' : 'closed',
    });
    for (let i = 0; i < 60; i++) seed(`nested-child-${String(i).padStart(2, '0')}`, {
      parent_session_id: 'nested-60', project_id: 'p', owner_user_id: 1,
      last_preview: i === 59 ? 'nested-count-needle' : null,
    });
    seed('excluded-archived', { parent_session_id: 'parent-164', project_id: 'p', owner_user_id: 1, archived_at: '2026-02-01' });
    seed('excluded-project', { parent_session_id: 'parent-164', project_id: 'q', owner_user_id: 1 });
    seed('excluded-owner', { parent_session_id: 'parent-164', project_id: 'p', owner_user_id: 2 });
    seed('excluded-scope', { parent_session_id: 'parent-164', project_id: 'p', owner_user_id: 1, category: 'scheduled', is_system: 1 });

    queries = [];
    const roots = page({ projectId: 'p', ownerUserId: 1 }).sessions;
    expect(roots.find((row) => row.id === 'zero')).toMatchObject({ hasChildren: false, childCount: 0, runningChildCount: 0 });
    expect(roots.find((row) => row.id === 'parent-38')).toMatchObject({ hasChildren: true, childCount: 38, runningChildCount: 38 });
    expect(roots.find((row) => row.id === 'parent-164')).toMatchObject({ hasChildren: true, childCount: 164, runningChildCount: 38 });
    expect(queries.filter((sql) => /FROM agent_sessions\s+WHERE parent_session_id IN/i.test(sql))).toHaveLength(1);
    expect(queries.filter((sql) => /FROM agent_sessions WHERE parent_session_id =/i.test(sql))).toHaveLength(0);

    const firstChildren = history.listChildrenPage('parent-164', { projectId: 'p', ownerUserId: 1, limit: 100 });
    expect(firstChildren.sessions).toHaveLength(100);
    expect(firstChildren.pageInfo.hasMore).toBe(true);
    const nested = firstChildren.sessions.find((row) => row.id === 'nested-60')
      ?? history.listChildrenPage('parent-164', { projectId: 'p', ownerUserId: 1, limit: 100, cursor: firstChildren.pageInfo.nextCursor! }).sessions.find((row) => row.id === 'nested-60');
    expect(nested).toMatchObject({ childCount: 60, runningChildCount: 0, hasChildren: true });

    const found = page({ projectId: 'p', ownerUserId: 1, search: 'nested-count-needle' });
    expect(found.sessions).toHaveLength(1);
    expect(found.ancestors.find((row) => row.id === 'nested-60')).toMatchObject({ childCount: 60, runningChildCount: 0 });
    expect(found.ancestors.find((row) => row.id === 'parent-164')).toMatchObject({ childCount: 164, runningChildCount: 38 });
    expect(page({ projectId: 'p', ownerUserId: 1, includeArchived: true }).sessions.find((row) => row.id === 'parent-164')).toMatchObject({ childCount: 165 });
  });

  it('E26-c6: legacy list order, root cap and descendant cap remain unchanged', () => {
    for (let i = 0; i < 105; i++) seed(`root-${i}`, { updated_at: `2026-01-${String(i % 28 + 1).padStart(2, '0')}` });
    const expected = db.prepare(`SELECT id FROM agent_sessions WHERE parent_session_id IS NULL
      ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC LIMIT 100`).all() as { id: string }[];
    expect(repo.listAll().map(s => s.id)).toEqual(expected.map(s => s.id));
    const parent = expected[0].id;
    for (let i = 0; i < 505; i++) seed(`child-${i}`, { parent_session_id: parent });
    expect(repo.listAll()[0].children).toHaveLength(500);
  });

  it('E26-c7: malformed, expired, cross-query cursors and invalid limits reject with bounded 400', () => {
    seed('a'); seed('b');
    for (const limit of [0, -1, 101, 1.5, NaN, Infinity]) {
      expect(() => page({ limit })).toThrow('limit');
    }
    for (const cursor of ['', 'garbage', 'x'.repeat(1000), Buffer.from('{}').toString('base64url')]) {
      expect(() => page({ cursor })).toThrow('cursor');
    }
    const first = page({ limit: 1, ownerUserId: 1 });
    expect(() => page({ cursor: first.pageInfo.nextCursor!, ownerUserId: 2 })).toThrow('cursor');
    expect(() => page({ cursor: first.pageInfo.nextCursor!, ownerUserId: 1, search: 'a' })).toThrow('cursor');
    for (let i = 0; i < 33; i++) page({ limit: 1 });
    expect(() => page({ cursor: first.pageInfo.nextCursor!, ownerUserId: 1 })).toThrow('expired');
  });

  it('E26-c2/c8: continuation rechecks ownership and removes deleted members without skipping eligible rows', () => {
    for (const id of ['a', 'b', 'c', 'd']) seed(id, { owner_user_id: 1 });
    const first = page({ limit: 1, ownerUserId: 1 });
    expect(first.sessions.map(s => s.id)).toEqual(['d']);
    db.prepare("UPDATE agent_sessions SET owner_user_id = 2 WHERE id = 'c'").run();
    db.prepare("DELETE FROM agent_sessions WHERE id = 'b'").run();
    const second = page({ limit: 1, ownerUserId: 1, cursor: first.pageInfo.nextCursor! });
    expect(second.sessions.map(s => s.id)).toEqual(['a']);
    expect(second.pageInfo.hasMore).toBe(false);
  });
});
