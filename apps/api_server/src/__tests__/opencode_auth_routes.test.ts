import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import type { AddressInfo } from 'node:net';

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listAuthedProviders: vi.fn().mockResolvedValue(['openrouter']),
    listProviders: vi.fn().mockResolvedValue([]),
    setAuth: vi.fn().mockResolvedValue(true),
    getOAuthUrl: vi.fn(),
    handleOAuthCallback: vi.fn(),
    statusMessage: 'Opencode SDK ready',
  },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('GET /opencode/auth/', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeEach(async () => {
    setDb(makeDb());
    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((res, rej) =>
      server.close((e) => (e ? rej(e) : res())),
    );
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('returns providers from listAuthedProviders, not listProviders', async () => {
    const res = await fetch(`${baseUrl}/opencode/auth/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: string[]; ready: boolean };
    expect(body.providers).toEqual(['openrouter']);
    expect(body.ready).toBe(true);
  });
});
