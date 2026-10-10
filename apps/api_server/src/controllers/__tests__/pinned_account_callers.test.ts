import Database from 'better-sqlite3';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ routing: vi.fn(), cascade: vi.fn(async () => ({ outcome: 'terminal' })) }));
vi.mock('../../services/turn_redispatch', () => ({ advanceFallbackCascade: boundary.cascade, finalizeErrorStatus: vi.fn() }));
vi.mock('../../services/opencode_engine', () => ({ opencodeClient: { isReady: true,
  createSession: async () => ({ id: 'synthetic-sdk' }), listAuthedProviders: async () => ['anthropic', 'openai'],
  listAgents: async () => [{ name: 'build', mode: 'primary', builtIn: true }],
}, opencodeSessionMap: new Map() }));
vi.mock('../../services/opencode_stream_bridge', () => ({ streamBridge: { streamSession: async () => undefined } }));
vi.mock('../../services/ws_gateway', () => ({ broadcast: vi.fn(), broadcastSessionUpdated: vi.fn() }));
vi.mock('../../services/anthropic_accounts_service', () => ({ anthropicAccountsService: {
  getAccount: (id: string) => ['a', 'b'].includes(id) ? { id } : undefined,
  defaultAccount: () => ({ id: 'a' }), setRouting: boundary.routing,
} }));
vi.mock('../../services/openai_accounts_service', () => ({ openaiAccountsService: {
  getAccount: (id: string) => ['o', 'p'].includes(id) ? { id } : undefined,
  defaultAccount: () => ({ id: 'o' }), setRouting: boundary.routing,
} }));
vi.mock('../../services/usage_budget_service', () => ({ subscribeUsageBudgetRefresh: () => () => undefined, getUsageBudget: async () => ({ providers: [], fetchedAt: new Date().toISOString() }) }));
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentSessionsController } from '../agent_sessions_controller';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { applyGridAccount } from '../../services/decision/router_grid_turn';
import { opencodeSpilloverRouter } from '../../routes/opencode_spillover_routes';
import { switchAutoSessionAccount, isAutoAccountSession, markAutoAccountSession, clearAutoAccountSessionsForTests } from '../../services/decision/capacity_router';
let db: Database.Database, prev: Database.Database | null;
const controller = new AgentSessionsController();
beforeEach(() => {
  db = new Database(':memory:'); runMigrations(db); prev = setDb(db);
  clearAutoAccountSessionsForTests(); boundary.routing.mockClear(); boundary.cascade.mockClear();
  process.env.AGENT_DECISION_CAPACITY_ROUTING = 'shadow';
});
// Call the real registered handler in memory: no listener, socket, or API runtime.
async function spill(body: Record<string, unknown>) {
  const layer = opencodeSpilloverRouter.stack.find((layer: any) => layer.route?.path === '/');
  if (!layer?.route) throw new Error('spillover route missing');
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await layer.route.stack[0].handle({ body } as any, res, vi.fn());
  return res;
}
it.each(['anthropic', 'openai'] as const)('c16: stale same-provider %s spillover cannot move an explicit pin', async provider => {
  const row = await call('create', { cwd: process.env.TMPDIR, name: 'synthetic', anthropicAccountId: 'a', openaiAccountId: 'o' });
  boundary.routing.mockClear();
  const res = await spill({ sdkSessionId: 'synthetic-sdk', providerID: provider, toAccountId: provider === 'anthropic' ? 'b' : 'p' });
  expect(res.status).toHaveBeenCalledWith(202);
  expect(boundary.routing).not.toHaveBeenCalled();
  expect(new AgentSessionsRepository().findById(row.id)?.[provider === 'anthropic' ? 'anthropicAccountId' : 'openaiAccountId']).toBe(provider === 'anthropic' ? 'a' : 'o');
});
it.each(['anthropic', 'openai'] as const)('c17: automatic %s spillover persists unpinned provenance', async provider => {
  const row = await call('create', { cwd: process.env.TMPDIR, name: 'synthetic' });
  const account = provider === 'anthropic' ? 'b' : 'p';
  await spill({ sdkSessionId: 'synthetic-sdk', providerID: provider, toAccountId: account });
  expect(boundary.routing).toHaveBeenLastCalledWith('synthetic-sdk', account, { pinned: false });
  expect(isAutoAccountSession(row.id, provider)).toBe(true);
  expect(new AgentSessionsRepository().findById(row.id)?.[provider === 'anthropic' ? 'anthropicAccountId' : 'openaiAccountId']).toBe(account);
});
it('c18: pinned Anthropic exhaustion still invokes the cross-provider cascade without account writes', async () => {
  await call('create', { cwd: process.env.TMPDIR, name: 'synthetic', anthropicAccountId: 'a' });
  boundary.routing.mockClear();
  await spill({ sdkSessionId: 'synthetic-sdk', fromAccountId: 'a', exhausted: true });
  expect(boundary.cascade).toHaveBeenCalledWith(expect.any(String), { providerID: 'anthropic', message: 'anthropic provider exhausted', fromAccountId: 'a' });
  expect(boundary.routing).not.toHaveBeenCalled();
});

it.each(['pinned', null] as const)('stale child auto marker cannot override inherited %s provenance in same-provider spillover', async source => {
  const repo = new AgentSessionsRepository();
  const parent = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/p', name: 'parent', modelMode: 'fixed',
    anthropicAccountId: 'a', anthropicAccountSource: source });
  repo.setSdkSessionId(parent.id, `sdk-parent-${String(source)}`);
  const child = repo.upsertChildSession(`sdk-child-${String(source)}`, `sdk-parent-${String(source)}`, 'child', '/c')!;
  markAutoAccountSession(child.id, 'anthropic'); // stale process-memory marker from before inheritance repair
  boundary.routing.mockClear();
  const res = await spill({ sdkSessionId: child.sdkSessionId, providerID: 'anthropic', toAccountId: 'b' });
  expect(res.status).toHaveBeenCalledWith(202); expect(boundary.routing).not.toHaveBeenCalled();
  expect(repo.findById(child.id)).toMatchObject({ anthropicAccountId: 'a', anthropicAccountSource: source });
  expect(isAutoAccountSession(child.id, 'anthropic')).toBe(false);
});
afterEach(() => { setDb(prev); db.close(); delete process.env.AGENT_DECISION_CAPACITY_ROUTING; });
async function call(method: 'create' | 'update', body: Record<string, unknown>, id?: string) {
  let result: any; const next = vi.fn();
  const res: any = { status: vi.fn().mockReturnThis(), json: (value: any) => { result = value; } };
  await controller[method]({ body, params: { id } } as any, res, next);
  expect(next.mock.calls).toEqual([]); return result;
}
it.each(['requested', 'profile', 'default'])('c11: %s account provenance reaches the plugin store', async source => {
  const profiles = new AgentConfigsRepository(); profiles.insert({ id: 'synthetic', label: 'Synthetic', icon: 'S' });
  profiles.update('synthetic', { defaultAnthropicAccountId: 'a', defaultOpenaiAccountId: 'o' });
  const body = source === 'requested' ? { anthropicAccountId: 'a', openaiAccountId: 'o' }
    : source === 'profile' ? { agentId: 'synthetic' } : {};
  const row = await call('create', { cwd: process.env.TMPDIR, name: 'synthetic', ...body });
  for (const [provider, account] of [['anthropic', 'a'], ['openai', 'o']] as const) {
    expect(isAutoAccountSession(row.id, provider)).toBe(source === 'default');
    expect(boundary.routing).toHaveBeenCalledWith('synthetic-sdk', account, { pinned: source !== 'default' });
  }
});
it.each(['anthropic', 'openai'] as const)('c12: explicit %s PATCH pins; same-account grid reapply cannot clear it', async provider => {
  const row = await call('create', { cwd: process.env.TMPDIR, name: 'synthetic' });
  const account = provider === 'anthropic' ? 'a' : 'o';
  await call('update', { [provider === 'anthropic' ? 'anthropicAccountId' : 'openaiAccountId']: account }, row.id);
  expect(isAutoAccountSession(row.id, provider)).toBe(false);
  expect(boundary.routing).toHaveBeenLastCalledWith('synthetic-sdk', account, { pinned: true });
  await applyGridAccount(row.id, provider, account);
  expect(boundary.routing).toHaveBeenLastCalledWith('synthetic-sdk', account, { pinned: true });
});
it.each(['anthropic', 'openai'] as const)('c13: automatic %s grid and capacity switches clear pin provenance', async provider => {
  const row = await call('create', { cwd: process.env.TMPDIR, name: 'synthetic' });
  const next = provider === 'anthropic' ? 'b' : 'p';
  await applyGridAccount(row.id, provider, next);
  expect(boundary.routing).toHaveBeenLastCalledWith('synthetic-sdk', next, { pinned: false });
  const original = provider === 'anthropic' ? 'a' : 'o';
  expect(await switchAutoSessionAccount({ sessionId: row.id, providerID: provider, accountId: original, modeOverride: 'on' })).toBe(true);
  expect(boundary.routing).toHaveBeenLastCalledWith('synthetic-sdk', original, { pinned: false });
  expect(new AgentSessionsRepository().findById(row.id)?.[provider === 'anthropic' ? 'anthropicAccountId' : 'openaiAccountId']).toBe(original);
});
it('explicit same-account pin fails truthfully when durable provenance insert fails', async () => {
  const row = await call('create', { cwd: process.env.TMPDIR, name: 'synthetic pin failure' });
  const account = row.anthropicAccountId;
  const attempts = new (await import('../../services/decision/router_grid_attempts_repository')).RouterGridAttemptsRepository();
  await attempts.append(row.id, { tier: 4, category: 'knowledge', canQueue: false, securitySensitive: false, estInputTokens: 1, source: 'rules', reason: 'ok' },
    { kind: 'route', model: 'anthropic/fake', provider: 'anthropic', effortRequested: 'low', effortApplied: 'low', accountId: account, accountSource: 'router', tierUsed: 4, reason: 'ok', degraded: false, applied: true, trace: [] });
  const spy = vi.spyOn((await import('../../services/decision/router_grid_attempts_repository')).RouterGridAttemptsRepository.prototype, 'append').mockRejectedValueOnce(new Error('synthetic durable insert failure'));
  const next = vi.fn(); const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await controller.update({ body: { anthropicAccountId: account }, params: { id: row.id } } as any, res, next);
  expect(next).toHaveBeenCalledOnce(); expect(String(next.mock.calls[0][0]?.message)).toContain('synthetic durable insert failure');
  expect(isAutoAccountSession(row.id, 'anthropic')).toBe(false);
  expect(new AgentSessionsRepository().findById(row.id)?.anthropicAccountSource).toBe('pinned');
  expect((await attempts.readState(row.id))?.accountSource).toBe('router');
  expect(boundary.routing).not.toHaveBeenCalledWith('synthetic-sdk', account, { pinned: true });
  spy.mockRestore();
});
