/**
 * Gallery folders: CRUD, move/rename designs, folder delete unfiles (never deletes) its designs,
 * and the schema lands in BOTH SQLite migrations and the Postgres bootstrap.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';
import { getDb, setDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

describe('agent design folders schema', () => {
  it('SQLite migrations create agent_design_folders and agent_designs.folder_id idempotently', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db);
    const cols = (table: string) => (db.pragma(`table_info(${table})`) as { name: string; notnull: number }[]);
    expect(cols('agent_design_folders').map((c) => c.name)).toEqual(['id', 'name', 'sort_order', 'created_at', 'updated_at']);
    expect(cols('agent_design_folders').find((c) => c.name === 'name')?.notnull).toBe(1);
    expect(cols('agent_designs').map((c) => c.name)).toContain('folder_id');
  });

  it('Postgres bootstrap creates the same folder table and folder_id column', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await runPostgresBootstrap({ query, connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement).replace(/\s+/g, ' ')).join('\n');
    const table = /CREATE TABLE IF NOT EXISTS agent_design_folders \((.*)\)\s*$/m.exec(sql)?.[1] ?? '';
    expect(table.split(/,(?![^(]*\))/).map((clause) => clause.trim().split(' ')[0])).toEqual(['id', 'name', 'sort_order', 'created_at', 'updated_at']);
    expect(table).toContain('name TEXT NOT NULL');
    expect(sql).toContain('ALTER TABLE agent_designs ADD COLUMN IF NOT EXISTS folder_id TEXT');
  });
});

describe('/agent-designs folders routes', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({ name: 'Designer', email: 'folders@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    ({ baseUrl, close } = await startTestServer(createApp()));
  });
  afterEach(async () => { await close(); });

  const call = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() as any };
  };
  const design = async (title: string) => (await call('POST', '/agent-designs', { title, provider: 'canva', artifactUrl: 'https://cdn.example.test/a.png' })).body;

  it('creates, lists, renames and deletes folders; moving and renaming designs', async () => {
    const a = await call('POST', '/agent-designs/folders', { name: '  Sundays ' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name: 'Sundays', sortOrder: 0 });
    const b = (await call('POST', '/agent-designs/folders', { name: 'Youth' })).body;
    expect(b.sortOrder).toBe(1);
    expect((await call('POST', '/agent-designs/folders', { name: '   ' })).status).toBe(400);
    expect((await call('GET', '/agent-designs/folders')).body.map((f: any) => f.name)).toEqual(['Sundays', 'Youth']);

    const renamed = await call('PATCH', `/agent-designs/folders/${b.id}`, { name: 'Students' });
    expect(renamed.body.name).toBe('Students');
    expect((await call('PATCH', '/agent-designs/folders/missing', { name: 'x' })).status).toBe(404);

    const d = await design('Banner');
    expect(d.folderId).toBeNull();
    const moved = await call('PATCH', `/agent-designs/${d.id}`, { folderId: a.body.id, title: 'Easter banner' });
    expect(moved.body).toMatchObject({ folderId: a.body.id, title: 'Easter banner' });
    expect((await call('GET', '/agent-designs')).body[0].folderId).toBe(a.body.id);
    expect((await call('PATCH', `/agent-designs/${d.id}`, { folderId: 'nope' })).status).toBe(400);
    expect((await call('PATCH', `/agent-designs/${d.id}`, { title: '' })).status).toBe(400);
    expect((await call('PATCH', '/agent-designs/missing', { title: 'x' })).status).toBe(404);
    expect((await call('PATCH', `/agent-designs/${d.id}`, { folderId: null })).body.folderId).toBeNull();
  });

  it('deleting a folder moves its designs to Unfiled and never deletes them', async () => {
    const folder = (await call('POST', '/agent-designs/folders', { name: 'Archive' })).body;
    const d1 = await design('One');
    const d2 = await design('Two');
    await call('PATCH', `/agent-designs/${d1.id}`, { folderId: folder.id });
    await call('PATCH', `/agent-designs/${d2.id}`, { folderId: folder.id });
    expect((await call('DELETE', `/agent-designs/folders/${folder.id}`)).status).toBe(204);
    expect((await call('DELETE', `/agent-designs/folders/${folder.id}`)).status).toBe(404);
    const list = (await call('GET', '/agent-designs')).body;
    expect(list).toHaveLength(2);
    expect(list.every((row: any) => row.folderId === null)).toBe(true);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM agent_design_folders').get()).toEqual({ n: 0 });
  });
});
