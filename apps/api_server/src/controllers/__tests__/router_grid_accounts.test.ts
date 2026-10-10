import Database from 'better-sqlite3';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ defaults: true, routing: vi.fn() }));
vi.mock('../../services/opencode_engine', () => ({ opencodeClient: { isReady: true,
  createSession: async () => ({ id: 'fake-sdk' }), listAuthedProviders: async () => ['anthropic', 'openai'],
  listAgents: async () => [{ name: 'build', mode: 'primary', builtIn: true }],
}, opencodeSessionMap: new Map() }));
vi.mock('../../services/opencode_stream_bridge', () => ({ streamBridge: { streamSession: async () => undefined } }));
vi.mock('../../services/ws_gateway', () => ({ broadcast: vi.fn(), broadcastSessionUpdated: vi.fn() }));
vi.mock('../../services/anthropic_accounts_service', () => ({ anthropicAccountsService: {
  getAccount: (id: string) => id === 'a' ? { id } : undefined,
  defaultAccount: () => boundary.defaults ? { id: 'a' } : undefined, setRouting: boundary.routing,
} }));
vi.mock('../../services/openai_accounts_service', () => ({ openaiAccountsService: {
  getAccount: (id: string) => id === 'o' ? { id } : undefined,
  defaultAccount: () => boundary.defaults ? { id: 'o' } : undefined, setRouting: boundary.routing,
} }));
vi.mock('../../services/usage_budget_service', () => ({ getUsageBudget: async () => ({ providers: [], fetchedAt: new Date().toISOString() }) }));
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentSessionsController } from '../agent_sessions_controller';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import * as capacity from '../../services/decision/capacity_router';
let db: Database.Database, prev: Database.Database | null;
const controller = new AgentSessionsController();
beforeEach(() => { db = new Database(':memory:'); runMigrations(db); prev = setDb(db);
  capacity.clearAutoAccountSessionsForTests(); boundary.defaults = true;
  process.env.AGENT_DECISION_CAPACITY_ROUTING = 'shadow';
});
afterEach(() => { setDb(prev); db.close(); delete process.env.AGENT_DECISION_CAPACITY_ROUTING; });
async function call(method: 'create' | 'update', body: Record<string, unknown>, id?: string) {
  let result: any; const next = vi.fn();
  const res: any = { status: vi.fn().mockReturnThis(), json: (value: any) => { result = value; } };
  await controller[method]({ body, params: { id } } as any, res, next);
  expect(next.mock.calls).toEqual([]); return result;
}
it.each([true, false])('repair-c1: store default/null is auto with capacity Shadow (defaults=%s)', async defaults => {
  boundary.defaults = defaults;
  const row = await call('create', { cwd: process.env.TMPDIR, name: 'fake', modelMode: 'auto' });
  expect(new AgentSessionsRepository().findById(row.id)?.anthropicAccountId).toBe(defaults ? 'a' : null);
  expect(capacity.isAutoAccountSession(row.id, 'anthropic')).toBe(true);
  expect(capacity.isAutoAccountSession(row.id, 'openai')).toBe(true);
});
it.each(['anthropic', 'openai'] as const)('repair-c1: explicit same-id PATCH revokes only %s even with legacy generic marker', async provider => {
  const row = await call('create', { cwd: process.env.TMPDIR, name: 'fake', modelMode: 'auto' });
  capacity.markAutoAccountSession(row.id);
  capacity.markAutoAccountSession(row.id, 'anthropic'); capacity.markAutoAccountSession(row.id, 'openai');
  const key = provider === 'anthropic' ? 'anthropicAccountId' : 'openaiAccountId';
  const value = provider === 'anthropic' ? 'a' : 'o';
  await call('update', { [key]: value }, row.id);
  expect(new AgentSessionsRepository().findById(row.id)?.[key]).toBe(value);
  expect(capacity.isAutoAccountSession(row.id, provider)).toBe(false);
  expect(capacity.isAutoAccountSession(row.id, provider === 'anthropic' ? 'openai' : 'anthropic')).toBe(true);
});
it('repair-c1: requested and profile accounts remain pins', async () => {
  const profiles = new AgentConfigsRepository(); profiles.insert({ id: 'fake', label: 'Fake', icon: 'F' });
  profiles.update('fake', { defaultAnthropicAccountId: 'a', defaultOpenaiAccountId: 'o' });
  for (const body of [{ anthropicAccountId: 'a', openaiAccountId: 'o' }, { agentId: 'fake' }]) {
    const row = await call('create', { cwd: process.env.TMPDIR, name: 'fake', ...body });
    expect(capacity.isAutoAccountSession(row.id, 'anthropic')).toBe(false);
    expect(capacity.isAutoAccountSession(row.id, 'openai')).toBe(false);
  }
});
