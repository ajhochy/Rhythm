import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { startTestServer } from './helpers/real_server';

async function app() {
  vi.resetModules(); vi.stubEnv('AGENT_LOCAL', 'true');
  const { runMigrations } = await import('../database/migrations');
  const { setDb } = await import('../database/db');
  const db = new Database(':memory:'); runMigrations(db); setDb(db);
  return startTestServer((await import('../app')).createApp());
}

describe('/creative-platform', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { if (close) await close(); close = undefined; vi.unstubAllEnvs(); vi.resetModules(); });
  it('lists/statuses locally and creates a pending approval instead of downloading', async () => {
    const server = await app(); close = server.close;
    const list = await fetch(`${server.baseUrl}/creative-platform`);
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(7);
    const pending = await fetch(`${server.baseUrl}/creative-platform/openmontage/request-or-start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'creative-test' }) });
    expect(pending.status).toBe(202);
    expect((await pending.json() as { status: string }).status).toBe('pending');
    const verify = await fetch(`${server.baseUrl}/creative-platform/openmontage/verify`, { method: 'POST' });
    expect((await verify.json() as { id: string }).id).toBe('openmontage');
  });
});
