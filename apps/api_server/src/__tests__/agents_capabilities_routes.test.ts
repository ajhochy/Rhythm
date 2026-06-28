import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { startTestServer } from './helpers/real_server';

// Mock the Opencode engine so we can control provider availability in tests
vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai', 'google']),
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

  const { baseUrl, close: closeServer } = await startTestServer(createApp());

  return { baseUrl, closeServer, authHeaders };
}

// ── issue-685-c6: GET /agents/capabilities includes provider-to-agent-kind mapping ──

describe('issue-685-c6: GET /agents/capabilities includes provider-to-agent-kind mapping', () => {
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

  it('response includes providerToAgentKind object', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body['providerToAgentKind']).toBe('object');
    expect(body['providerToAgentKind']).not.toBeNull();
  });

  it('providerToAgentKind maps anthropic → claude-code, openai → codex, google → gemini-cli', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const body = (await res.json()) as Record<string, unknown>;
    const mapping = body['providerToAgentKind'] as Record<string, string>;
    expect(mapping['anthropic']).toBe('claude-code');
    expect(mapping['openai']).toBe('codex');
    expect(mapping['google']).toBe('gemini-cli');
  });

  it('providerToAgentKind maps github-copilot → claude-code', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const body = (await res.json()) as Record<string, unknown>;
    const mapping = body['providerToAgentKind'] as Record<string, string>;
    expect(mapping['github-copilot']).toBe('claude-code');
  });

  it('POST /refresh also includes providerToAgentKind', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities/refresh`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body['providerToAgentKind']).toBe('object');
    expect((body['providerToAgentKind'] as Record<string, string>)['anthropic']).toBe('claude-code');
  });
});

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
    vi.mocked(opencodeClient.listAuthedProviders).mockResolvedValueOnce(['openai', 'google']);

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(false);
    expect(caps['codex']).toBe(true); // openai is still connected
  });

  it('flips all CLI agents to true when only an aggregator (openrouter) is connected (#584)', async () => {
    const { opencodeClient } = await import('../services/opencode_engine');
    vi.mocked(opencodeClient.listAuthedProviders).mockResolvedValueOnce(['openrouter']);

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(true);
    expect(caps['codex']).toBe(true);
    expect(caps['gemini-cli']).toBe(true);
    expect(caps['opencode']).toBe(true);
  });

  it('treats together and groq as aggregators for CLI agents (#584)', async () => {
    const { opencodeClient } = await import('../services/opencode_engine');
    vi.mocked(opencodeClient.listAuthedProviders).mockResolvedValueOnce(['together']);

    let res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    let caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(true);
    expect(caps['codex']).toBe(true);
    expect(caps['gemini-cli']).toBe(true);

    vi.mocked(opencodeClient.listAuthedProviders).mockResolvedValueOnce(['groq']);
    res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(true);
    expect(caps['codex']).toBe(true);
    expect(caps['gemini-cli']).toBe(true);
  });

  it('keeps unrelated CLI agents false when only the direct provider is connected (#584 regression)', async () => {
    const { opencodeClient } = await import('../services/opencode_engine');
    vi.mocked(opencodeClient.listAuthedProviders).mockResolvedValueOnce(['anthropic']);

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(true);
    expect(caps['codex']).toBe(false);
    expect(caps['gemini-cli']).toBe(false);
  });

  it('returns false for all when no providers are connected but engine is ready', async () => {
    const { opencodeClient } = await import('../services/opencode_engine');
    vi.mocked(opencodeClient.listAuthedProviders).mockResolvedValueOnce([]);

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
    const caps = (await res.json()) as Record<string, unknown>;

    // Should have 4 presets + 1 custom = 5 capability keys, plus providerToAgentKind
    const ids = Object.keys(caps).filter((k) => k !== 'providerToAgentKind');
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
