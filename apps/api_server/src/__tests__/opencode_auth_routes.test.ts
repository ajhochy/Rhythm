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

const fakeBridge = vi.hoisted(() => ({
  hasClaudeCode: vi.fn().mockReturnValue(true),
  bridgeAnthropic: vi.fn().mockResolvedValue({
    success: true,
    provider: 'anthropic',
    subscriptionType: 'pro',
  }),
}));

vi.mock('../services/credentials_bridge_service', () => {
  return {
    CredentialsBridgeService: class {
      hasClaudeCode = fakeBridge.hasClaudeCode;
      bridgeAnthropic = fakeBridge.bridgeAnthropic;
    },
    credentialsBridge: fakeBridge,
  };
});

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

describe('POST /opencode/auth/anthropic/bridge', () => {
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

  it('returns 200 + provider on success', async () => {
    const res = await fetch(`${baseUrl}/opencode/auth/anthropic/bridge`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      provider: 'anthropic',
      subscriptionType: 'pro',
    });
  });

  it('returns 401 with reason when Keychain denied', async () => {
    const mod = await import('../services/credentials_bridge_service') as unknown as {
      credentialsBridge: typeof fakeBridge;
    };
    mod.credentialsBridge.bridgeAnthropic.mockResolvedValueOnce({
      success: false,
      reason: 'keychain_denied',
    });
    const res = await fetch(`${baseUrl}/opencode/auth/anthropic/bridge`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, reason: 'keychain_denied' });
  });

  // #658-c2 — the Settings "Reconnect" button sends ?force=true so the bridge
  // re-reads the keychain fresh instead of riding a cached token.
  it('issue-658-c2: passes force=true through to bridgeAnthropic when ?force=true', async () => {
    await fetch(`${baseUrl}/opencode/auth/anthropic/bridge?force=true`, { method: 'POST' });
    expect(fakeBridge.bridgeAnthropic).toHaveBeenCalledWith(
      expect.anything(),
      { force: true },
    );
  });

  it('issue-658-c2b: defaults force=false when query omitted', async () => {
    await fetch(`${baseUrl}/opencode/auth/anthropic/bridge`, { method: 'POST' });
    expect(fakeBridge.bridgeAnthropic).toHaveBeenCalledWith(
      expect.anything(),
      { force: false },
    );
  });
});

describe('GET /opencode/auth/sources', () => {
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

  it('returns Claude Code + Codex availability', async () => {
    const res = await fetch(`${baseUrl}/opencode/auth/sources`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claudeCode: boolean; codex: boolean };
    expect(typeof body.claudeCode).toBe('boolean');
    expect(typeof body.codex).toBe('boolean');
  });
});
