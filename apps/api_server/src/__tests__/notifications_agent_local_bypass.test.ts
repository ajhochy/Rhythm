import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  attachWsGateway: vi.fn(),
}));

describe('POST /notifications/agent — AGENT_LOCAL bypass', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let prevAgentLocal: string | undefined;

  beforeEach(async () => {
    prevAgentLocal = process.env.AGENT_LOCAL;
    process.env.AGENT_LOCAL = 'true';

    vi.resetModules();

    const { runMigrations } = await import('../database/migrations');
    const { setDb } = await import('../database/db');
    const { createApp } = await import('../app');

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () =>
      new Promise<void>((res, rej) =>
        server.close((e) => (e ? rej(e) : res())),
      );
  });

  afterEach(async () => {
    if (prevAgentLocal === undefined) {
      delete process.env.AGENT_LOCAL;
    } else {
      process.env.AGENT_LOCAL = prevAgentLocal;
    }
    await closeServer();
    vi.clearAllMocks();
  });

  it('returns 201 for POST /notifications/agent with no Authorization header when AGENT_LOCAL=true', async () => {
    const res = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Smoke', body: 'No auth header' }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: number };
    expect(data.id).toBeGreaterThan(0);
  });

  it('still validates payload when AGENT_LOCAL=true', async () => {
    const res = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'missing title' }),
    });
    expect(res.status).toBe(400);
  });
});
