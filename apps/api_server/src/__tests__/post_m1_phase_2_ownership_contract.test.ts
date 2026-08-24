import Database from 'better-sqlite3';
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startTestServer } from './helpers/real_server';

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
  broadcastAgentConfigsChanged: vi.fn(),
}));

vi.mock('../services/opencode_agent_writer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/opencode_agent_writer')>();
  return {
    ...original,
    writeAgentProfileFile: vi.fn(() => 'written'),
    deleteAgentProfileFile: vi.fn(),
    syncAgentProfileFileForState: vi.fn(),
  };
});

type Scenario = {
  db: Database.Database;
  baseUrl: string;
  tokens: [string, string];
  close(): Promise<void>;
};

let active: Scenario | undefined;

async function startScenario(agentLocal: boolean): Promise<Scenario> {
  vi.resetModules();
  const { env } = await import('../config/env');
  env.agentLocal = agentLocal;
  env.agentExecutionEnabled = true;
  env.agentOriginGuardEnabled = true;
  env.localRendererOrigins = ['http://127.0.0.1:4175'];

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const { UsersRepository } = await import('../repositories/users_repository');
  const { SessionsRepository } = await import('../repositories/sessions_repository');
  const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
  const { createApp } = await import('../app');

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const users = new UsersRepository();
  const sessions = new SessionsRepository();
  const first = users.create({ name: 'Phase 2 actor one', email: 'p2-one@example.invalid' });
  const second = users.create({ name: 'Phase 2 actor two', email: 'p2-two@example.invalid' });
  const firstSession = await sessions.createAsync(first.id);
  const secondSession = await sessions.createAsync(second.id);
  new AgentConfigsRepository().insert({
    id: 'phase-2-global-catalog-probe',
    label: 'Phase 2 Global Catalog Probe',
    icon: 'P2',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
  });

  const server = await startTestServer(createApp());
  return {
    db,
    baseUrl: server.baseUrl,
    tokens: [firstSession.token, secondSession.token],
    async close() {
      await server.close();
      db.close();
    },
  };
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function getWithHost(baseUrl: string, host: string): Promise<{ status: number; body: string }> {
  const url = new URL('/agent-configs', baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: { Host: host, Connection: 'close' },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.once('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    request.end();
  });
}

afterEach(async () => {
  await active?.close();
  active = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe.sequential('post-m1 Phase 2 actual profile access contract', () => {
  it('post-m1-p2-c3a: unauthenticated remote callers receive identical non-disclosing 401s', async () => {
    // Regression caught: collection/item auth ordering leaks a profile name, provider, path, or
    // whether an id exists; the identical bounded 401 assertion fails.
    active = await startScenario(false);
    const paths = [
      '/agent-configs',
      '/agent-configs/phase-2-global-catalog-probe',
      '/agent-configs/phase-2-does-not-exist',
    ];
    const observations = await Promise.all(paths.map(async (path) => {
      const response = await fetch(`${active!.baseUrl}${path}`);
      return { status: response.status, body: await response.text() };
    }));

    expect(observations.map(({ status }) => status)).toEqual([401, 401, 401]);
    expect(new Set(observations.map(({ body }) => body)).size).toBe(1);
    const disclosure = observations.map(({ body }) => body).join('\n');
    expect(disclosure).not.toMatch(/Phase 2 Global|anthropic|claude-sonnet|\/Users\/|\/home\//i);
  });

  it('post-m1-p2-c3b: every authenticated caller receives the same global catalog', async () => {
    // Regression caught: an undocumented user/workspace filter silently partitions global
    // agent_configs rows; the byte-equivalent normalized catalog assertion fails.
    active = await startScenario(false);
    const catalogs = await Promise.all(active.tokens.map(async (token) => {
      const response = await fetch(`${active!.baseUrl}/agent-configs`, { headers: auth(token) });
      expect(response.status).toBe(200);
      return await response.json() as Array<Record<string, unknown>>;
    }));
    const normalize = (catalog: Array<Record<string, unknown>>) => catalog
      .map((profile) => ({
        id: profile.id,
        label: profile.label,
        modelProvider: profile.modelProvider,
        modelId: profile.modelId,
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));

    expect(normalize(catalogs[0])).toEqual(normalize(catalogs[1]));
    expect(normalize(catalogs[0])).toContainEqual({
      id: 'phase-2-global-catalog-probe',
      label: 'Phase 2 Global Catalog Probe',
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    });
  });

  it('post-m1-p2-c3c: AGENT_LOCAL grants tokenless CRUD only through the loopback guard', async () => {
    // Regression caught: local auth bypass becomes remotely host-addressable, or the guard blocks
    // legitimate loopback Flutter traffic; the paired 200/403 assertions fail.
    active = await startScenario(true);
    const list = await fetch(`${active.baseUrl}/agent-configs`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'phase-2-global-catalog-probe',
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      }),
    ]));

    const patch = await fetch(`${active.baseUrl}/agent-configs/phase-2-global-catalog-probe`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelProvider: 'openai', modelId: 'gpt-5.6-terra' }),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({
      modelProvider: 'openai',
      modelId: 'gpt-5.6-terra',
    });

    const hostileHost = await getWithHost(active.baseUrl, 'attacker.invalid');
    expect(hostileHost.status).toBe(403);
    const body = hostileHost.body;
    expect(body).toContain('FORBIDDEN_ORIGIN');
    expect(body).not.toMatch(/Phase 2 Global|openai|gpt-5\.6|\/Users\/|\/home\//i);
  });
});
