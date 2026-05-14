import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AddressInfo } from 'node:net';

// Mock the Opencode engine so we can control provider availability in tests
vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listProviders: vi.fn().mockResolvedValue(['anthropic', 'openai', 'google']),
    statusMessage: 'Opencode SDK ready',
  };
  return { opencodeClient: mockClient };
});

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function makeServer() {
  return createApp().listen(0);
}

async function setup() {
  const db = makeDb();
  setDb(db);

  const usersRepo = new UsersRepository();
  const sessionsRepo = new SessionsRepository();
  const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
  const session = await sessionsRepo.createAsync(user.id);
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  };

  const server = makeServer();
  await new Promise<void>((r) => server.once('listening', () => r()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const closeServer = () =>
    new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

  return { baseUrl, closeServer, authHeaders };
}

describe('GET /agents/capabilities', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('returns a key for every enabled config', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const caps = (await res.json()) as Record<string, boolean>;

    // After migrations the seeded presets are all enabled
    expect(typeof caps['claude-code']).toBe('boolean');
    expect(typeof caps['codex']).toBe('boolean');
    expect(typeof caps['gemini-cli']).toBe('boolean');
    expect(typeof caps['opencode']).toBe('boolean');
  });

  it('returns true for claude-code when anthropic provider is connected', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    // anthropic is in the default mock provider list
    expect(caps['claude-code']).toBe(true);
  });

  it('returns false for claude-code when anthropic provider is not connected', async () => {
    // Re-mock listProviders to exclude anthropic
    const { opencodeClient } = await import('../services/opencode_engine');
    vi.mocked(opencodeClient.listProviders).mockResolvedValueOnce(['openai', 'google']);

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(false);
    expect(caps['codex']).toBe(true); // openai is still connected
  });

  it('returns false for all when no providers are connected but engine is ready', async () => {
    const { opencodeClient } = await import('../services/opencode_engine');
    vi.mocked(opencodeClient.listProviders).mockResolvedValueOnce([]);

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(false);
    expect(caps['codex']).toBe(false);
    expect(caps['gemini-cli']).toBe(false);
    // opencode is always available when engine is ready
    expect(caps['opencode']).toBe(true);
  });

  it('returns false for opencode when engine is not ready', async () => {
    const { opencodeClient } = await import('../services/opencode_engine');
    Object.defineProperty(opencodeClient, 'isReady', { get: () => false });

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect(caps['opencode']).toBe(false);
  });

  it('omits a config that is disabled', async () => {
    // Disable claude-code
    const repo = new AgentConfigsRepository();
    repo.update('claude-code', { enabled: false });

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect('claude-code' in caps).toBe(false);
    // Others still present
    expect('codex' in caps).toBe(true);
  });

  it('includes a newly created custom config when enabled', async () => {
    const repo = new AgentConfigsRepository();
    repo.insert({ label: 'My Custom Agent', icon: '', command: 'mycustomagent --run', enabled: true });

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;

    // Should have 5 keys (4 presets + 1 custom)
    const ids = Object.keys(caps);
    expect(ids.length).toBe(5);
  });
});

describe('POST /agents/capabilities/refresh', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('returns the same shape as GET /', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities/refresh`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const caps = (await res.json()) as Record<string, boolean>;
    expect(typeof caps['claude-code']).toBe('boolean');
    expect(typeof caps['codex']).toBe('boolean');
  });

  it('reflects fresh state after a config change', async () => {
    const repo = new AgentConfigsRepository();

    const getRes = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const before = (await getRes.json()) as Record<string, boolean>;
    expect('codex' in before).toBe(true);

    repo.update('codex', { enabled: false });

    const refreshRes = await fetch(`${baseUrl}/agents/capabilities/refresh`, {
      method: 'POST',
      headers: authHeaders,
    });
    const after = (await refreshRes.json()) as Record<string, boolean>;
    expect('codex' in after).toBe(false);
  });
});
