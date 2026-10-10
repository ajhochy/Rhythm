import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ usageListener: null as null | ((snapshot: any) => Promise<void> | void), usageError: null as Error | null, snapshot: {} as any, models: [] as any[], inventory: {} as Record<string, Array<{ id: string; status: string }>>, routing: vi.fn(), broadcast: vi.fn(), fetch: vi.fn(), prompt: vi.fn() }));
vi.mock('../usage_budget_service', () => ({ subscribeUsageBudgetRefresh: (listener: any) => { boundary.usageListener = listener; return () => { boundary.usageListener = null; }; }, getUsageBudget: vi.fn(async () => { if (boundary.usageError) throw boundary.usageError; return boundary.snapshot; }) }));
vi.mock('../opencode_engine', () => ({ opencodeClient: {
  isReady: true, ensureReady: async () => true, createSession: async () => ({ id: 'runner-sdk' }), prompt: boundary.prompt,
  listMcp: async () => ({}), isProviderInAuthStore: () => true,
  listAuthedProviders: async () => ['anthropic', 'openai', 'openrouter'],
  providerSnapshot: async () => ({ providers: ['anthropic', 'openai', 'openrouter'].map(id => ({ id, connected: true, models: boundary.models.filter(m => m.provider === id) })) }),
}, opencodeSessionMap: new Map() }));
vi.mock('../../routes/agents_models_routes', () => ({ listAgentModelCatalog: async () => boundary.models.map(m => ({ provider: m.provider, modelId: m.id, visible: true })) }));
vi.mock('../anthropic_accounts_service', () => ({ anthropicAccountsService: { defaultAccount: () => undefined, getAccount: (id: string) => ({ id }), setRouting: boundary.routing, listRedacted: () => ({ accounts: boundary.inventory.anthropic }) } }));
vi.mock('../openai_accounts_service', () => ({ openaiAccountsService: { defaultAccount: () => undefined, getAccount: (id: string) => ({ id }), setRouting: boundary.routing, listRedacted: () => ({ accounts: boundary.inventory.openai }) } }));
vi.mock('../opencode_stream_bridge', () => ({ streamBridge: { streamSession: async () => undefined } }));
vi.mock('../ws_gateway', () => ({ broadcast: boundary.broadcast, broadcastSessionUpdated: vi.fn(), broadcastSessionRemoved: vi.fn() }));

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { UsersRepository } from '../../repositories/users_repository';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { run as runAgent } from '../agent_runner';
import { defaultDecisionSettings, saveDecisionSettings } from './decision_settings';
import { defaultRouterGridConfig } from './router_grid_config';
import { OpenAIDecisionsClient } from './openai_decisions_client';
import { resetModelCatalogCache } from './model_catalog';
import { isAutoAccountSession, markAutoAccountSession, clearAutoAccountSessionsForTests, unmarkAutoAccountSession } from './capacity_router';
import { listDecisions } from './decision_log';
import * as diagnostics from './decision_log';
import { RouterGridAttemptsRepository } from './router_grid_attempts_repository';
import { RouterGridExhaustionStore } from './router_grid_exhaustion';
import { routeTurnForSession } from './turn_routing';
import { FreeModeHeld, routeMobilePromptBody } from './mobile_prompt_routing';
import { routerFreeStatePath } from './router_free_runtime';
import { applyGridAccount, gridEffortVariant, initializeRouterFreeRecovery, waitForFreeReleaseForTests, waitForGridShadowForTests } from './router_grid_turn';
import { getUsageBudget } from '../usage_budget_service';
import { opencodeSpilloverRouter } from '../../routes/opencode_spillover_routes';

let db: Database.Database, prev: Database.Database | null, dir: string;
let saved: Record<string, string | undefined>;
let owner: number;
const envKeys = ['RHYTHM_DECISION_ROUTER_FILE', 'AGENT_DECISION_MODEL_ROUTING', 'AGENT_DECISION_CAPACITY_ROUTING'];
const repo = new AgentSessionsRepository();
const base = { providerID: 'openai', modelID: 'gpt-6.1-sol' };
const client = () => new OpenAIDecisionsClient({ baseUrl: 'http://127.0.0.1:9999', model: 'fake', apiKey: 'fake', consent: true, fetchImpl: boundary.fetch });
function configure(mode: 'on' | 'shadow' = 'on') {
  const s = defaultDecisionSettings();
  Object.assign(s.routing, { engine: 'grid' });
  s.features.model_routing = mode;
  saveDecisionSettings(s);
}
function session(mode: 'auto' | 'fixed' = 'auto') {
  const row = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'grid', modelMode: mode, ownerUserId: owner });
  repo.updateFields(row.id, { providerId: base.providerID, modelId: base.modelID });
  repo.setSdkSessionId(row.id, `sdk-${row.id}`);
  return repo.findById(row.id)!;
}
function run(id: string, extra: Record<string, unknown> = {}) {
  const row = repo.findById(id)!;
  return routeTurnForSession({ sessionId: id, sessionRow: row, prompt: 'extract the names', agentId: 'openai',
    sessionAuto: row.modelMode === 'auto', requestedSource: 'auto', baseRoute: { providerID: row.providerId!, modelID: row.modelId! },
    client: { rerank: async () => ({ status: 'disabled', reason: 'synthetic', latencyMs: 0 }) }, ...extra, gridClient: client(),
  } as Parameters<typeof routeTurnForSession>[0]);
}
beforeEach(() => {
  saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'grid-g2-'));
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'decision-router.json');
  delete process.env.AGENT_DECISION_MODEL_ROUTING;
  process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
  db = new Database(':memory:'); runMigrations(db); prev = setDb(db);
  owner = new UsersRepository().create({ name: 'Fake', email: 'fake@example.test' }).id;
  initializeRouterFreeRecovery(); configure(); resetModelCatalogCache(); clearAutoAccountSessionsForTests(); vi.clearAllMocks();
  boundary.inventory = Object.fromEntries(['anthropic', 'openai'].map(provider => [provider, [1, 2].map(n => ({ id: `${provider}-${n}`, status: 'ok' }))]));
  boundary.models = Object.keys(defaultRouterGridConfig().models).map(full => {
    const [provider, ...id] = full.split('/'); return { provider, id: id.join('/'), name: id.join('/'), variants: ['low', 'medium', 'high'],
      capabilities: { input: { text: true }, output: { text: true }, toolcall: true } };
  });
  boundary.usageError = null;
  boundary.snapshot = { fetchedAt: new Date().toISOString(), providers: ['anthropic', 'openai'].flatMap(provider => [1, 2].map(n => ({
    provider, accountId: `${provider}-${n}`, kind: 'window', label: provider, items: [{ label: '5h', remainingFraction: n === 1 ? .6 : .9, resetAt: new Date(Date.now() + n * 3600000).toISOString() }],
  }))) };
  boundary.fetch.mockImplementation(async () => new Response(JSON.stringify({ usage: { input_tokens: 6 }, answers: [
    { name: 'tier', type: 'score', score: 0, confidence: 1, probabilities: ['tier4', 'tier3', 'tier2', 'tier1'].map((label, value) => ({ label, value, probability: value === 0 ? 1 : 0 })) },
    { name: 'category', type: 'choice', choice: 'knowledge', confidence: 1 },
    { name: 'can_queue', type: 'predicate', probability: 0 }, { name: 'security_sensitive', type: 'predicate', probability: 0 },
  ] }), { status: 200 }));
  vi.stubGlobal('fetch', boundary.fetch);
  boundary.prompt.mockResolvedValue({ info: { role: 'assistant', sessionID: 'runner-sdk' }, parts: [{ type: 'text', text: 'Synthetic reply' }] });
});
afterEach(() => { vi.unstubAllGlobals(); setDb(prev); db.close(); for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('G2 real turn router with synthetic external boundaries', () => {
  it.each(['unavailable', 'mixed'])('inventory-c1: nonempty %s usage cannot hide a healthy unknown-quota account', async kind => {
    boundary.models = boundary.models.filter(m => m.provider === 'anthropic');
    boundary.inventory = { anthropic: [{ id: 'anthropic-1', status: 'ok' }], openai: [] };
    boundary.snapshot.providers = [{ provider: 'anthropic', accountId: 'anthropic-1', kind: 'unavailable', label: 'probe unavailable', items: [] }];
    if (kind === 'mixed') boundary.snapshot.providers.push({ provider: 'openai', accountId: 'openai-1', kind: 'window', label: 'known', items: [{ label: '5h', remainingFraction: .8 }] });
    expect(boundary.snapshot.providers.length).toBe(kind === 'mixed' ? 2 : 1);
    expect(boundary.inventory.anthropic[0].status).toBe('ok');
    const s = session();
    expect(await run(s.id)).toMatchObject({ applied: true, route: { providerID: 'anthropic', modelID: 'claude-haiku-5-5' }, gridAccountId: 'anthropic-1' });
    expect(repo.findById(s.id)).toMatchObject({ anthropicAccountId: 'anthropic-1', routerVariant: 'low' });
    expect((await new RouterGridAttemptsRepository().readState(s.id))?.model).toBe('anthropic/claude-haiku-5-5');
    expect(await run(s.id)).toMatchObject({ applied: false, route: { providerID: 'anthropic', modelID: 'claude-haiku-5-5' }, variant: 'low' });
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['disconnected', 'needs_relogin', 'cooldown', 'known-zero'])('inventory-c2: unavailable snapshot must not readmit %s candidate', async state => {
    boundary.models = boundary.models.filter(m => m.provider === 'anthropic');
    boundary.inventory = { anthropic: state === 'disconnected' ? [] : [{ id: 'anthropic-1', status: state === 'needs_relogin' ? state : 'ok' }], openai: [] };
    boundary.snapshot.providers = [{ provider: 'anthropic', accountId: 'anthropic-1', kind: state === 'known-zero' ? 'window' : 'unavailable', label: 'fake',
      items: state === 'known-zero' ? [{ label: '5h', remainingFraction: 0 }] : [] }];
    const store = new RouterGridExhaustionStore();
    if (state === 'cooldown') store.markExhausted('anthropic', 'anthropic-1', Date.now() + 3600000);
    expect(state === 'cooldown' ? store.isExhausted('anthropic', 'anthropic-1') : state === 'known-zero' ? boundary.snapshot.providers[0].items[0].remainingFraction === 0 : !boundary.inventory.anthropic.some(a => a.status === 'ok')).toBe(true);
    const s = session(); expect(await run(s.id)).toMatchObject({ applied: false, route: base });
    expect(repo.findById(s.id)?.anthropicAccountId).toBeNull();
    expect(listDecisions()[0].detail).toMatchObject({ kind: 'none', model: null, accountId: null });
    expect(await new RouterGridAttemptsRepository().readState(s.id)).toBeNull();
  });
  it('inventory-c3: supplement cannot replace known quota or duplicate a known exhausted account', async () => {
    boundary.models = boundary.models.filter(m => m.provider === 'anthropic');
    boundary.snapshot.providers = [{ provider: 'anthropic', accountId: 'anthropic-1', kind: 'window', label: 'known', items: [{ label: '5h', remainingFraction: .8 }] },
      { provider: 'anthropic', accountId: 'anthropic-2', kind: 'unavailable', label: 'unknown', items: [] }];
    const s = session(); await run(s.id);
    expect(repo.findById(s.id)?.anthropicAccountId).toBe('anthropic-1');
    expect(listDecisions()[0].detail.trace).toContainEqual({ action: 'pick_account', tier: 4, accountId: 'anthropic-1' });
  });
  it('repair-c3: legacy diagnostic no-op cannot lose classification on exhausted next turn', async () => {
    const diagnostic = vi.spyOn(diagnostics, 'recordDecision').mockImplementation(() => undefined);
    try {
      const s = session(); const first = await run(s.id);
      expect(first.applied).toBe(true); const stored = repo.findById(s.id)!;
      const initial = await new RouterGridAttemptsRepository().readState(s.id);
      expect(initial?.classification).toMatchObject({ tier: 4, category: 'knowledge' });
      expect(listDecisions()).toEqual([]);
      new RouterGridExhaustionStore().markExhausted('anthropic', stored.anthropicAccountId!, Date.now() + 3600000);
      boundary.fetch.mockClear();
      const second = await run(s.id);
      expect(second.applied).toBe(true); expect(repo.findById(s.id)?.anthropicAccountId).toBe('anthropic-1');
      expect(boundary.fetch).not.toHaveBeenCalled();
      expect((await new RouterGridAttemptsRepository().readState(s.id))?.classification).toEqual(initial?.classification);
    } finally { diagnostic.mockRestore(); }
  });
  it('repair-c1: explicit pin invalidates exhaustion reselection authorization', async () => {
    const s = session(); await run(s.id); const stored = repo.findById(s.id)!;
    unmarkAutoAccountSession(s.id, 'anthropic');
    repo.setAnthropicAccountSource(s.id, 'pinned');
    await new RouterGridAttemptsRepository().markPinned(s.id, 'anthropic', stored.anthropicAccountId!);
    new RouterGridExhaustionStore().markExhausted('anthropic', stored.anthropicAccountId!, Date.now() + 3600000);
    boundary.fetch.mockClear();
    expect(await run(s.id)).toMatchObject({ applied: false, variant: 'low' });
    expect(repo.findById(s.id)?.anthropicAccountId).toBe(stored.anthropicAccountId);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it('application failure leaves only pending receipt, held error, and no durable auto authorization', async () => {
    const s = session(); boundary.routing.mockRejectedValueOnce(new Error('synthetic account application failure'));
    expect(await run(s.id)).toMatchObject({ applied: false, held: { reason: 'router_state_unavailable' } });
    const rows = db.prepare('SELECT result_json FROM agent_router_grid_attempts WHERE session_id=? ORDER BY id').all(s.id) as { result_json: string }[];
    expect(rows.map(r => JSON.parse(r.result_json).applied)).toEqual([false]);
    expect(await new RouterGridAttemptsRepository().readState(s.id)).toBeNull();
    expect(repo.findById(s.id)?.routerDecidedAt).toBeNull();
    expect(listDecisions().some(d => d.applied)).toBe(false);
    expect(listDecisions().at(-1)).toMatchObject({ status: 'error', applied: false, detail: { kind: 'router_state_unavailable' } });
  });
  it('successful application journals pending then applied=true after account/session success', async () => {
    const s = session(); expect(await run(s.id)).toMatchObject({ applied: true });
    const rows = db.prepare('SELECT result_json FROM agent_router_grid_attempts WHERE session_id=? ORDER BY id').all(s.id) as { result_json: string }[];
    expect(rows.map(r => JSON.parse(r.result_json).applied)).toEqual([false, true]);
    expect(await new RouterGridAttemptsRepository().readState(s.id)).toMatchObject({ accountSource: 'router', accountId: expect.any(String) });
    expect(repo.findById(s.id)?.routerDecidedAt).toBeTruthy();
  });
  it('W2/W8: first prompt persists model, variant and account; ledger is body-free', async () => {
    const s = session(); const r = await run(s.id);
    expect(r).toMatchObject({ source: 'router', applied: true, route: { providerID: 'anthropic', modelID: 'claude-haiku-5-5' }, variant: 'low' });
    expect(repo.findById(s.id)).toMatchObject({ providerId: 'anthropic', modelId: 'claude-haiku-5-5', routerVariant: 'low', anthropicAccountId: 'anthropic-2', routerDecidedAt: expect.any(String) });
    // Automatic grid choice is never a pin (pin-fix contract: setRouting third argument).
    expect(boundary.routing).toHaveBeenCalledWith(s.sdkSessionId, 'anthropic-2', { pinned: false });
    const logs = listDecisions(); expect(logs).toHaveLength(1);
    expect(logs[0].detail).toMatchObject({ engine: 'grid', category: 'knowledge', tier: 4, tierUsed: 4, effortRequested: 'low', effortApplied: 'low', accountId: 'anthropic-2', accountSource: 'router', kind: 'route' });
    expect(JSON.stringify(logs[0].detail)).not.toContain('extract the names');
  });
  it('W3/W5: follow-up repeats variant without classification or capacity replacement', async () => {
    const s = session(); await run(s.id); boundary.snapshot.providers.forEach((p: any) => { p.items[0].remainingFraction = 0; });
    expect(await run(s.id)).toMatchObject({ route: { providerID: 'anthropic', modelID: 'claude-haiku-5-5' }, variant: 'low' });
    expect(boundary.fetch).toHaveBeenCalledTimes(1); expect(listDecisions()).toHaveLength(1);
  });
  it('W2: pinned account restricts selection even when another has more quota', async () => {
    const s = session(); repo.setAnthropicAccountId(s.id, 'anthropic-1'); await run(s.id);
    expect(repo.findById(s.id)?.anthropicAccountId).toBe('anthropic-1');
    expect(listDecisions()[0].detail).toMatchObject({ accountId: 'anthropic-1', accountSource: 'pinned' });
  });
  it('W2: pinned model and fixed session are untouched', async () => {
    const s = session('fixed'); expect((await run(s.id)).applied).toBe(false);
    await run(session().id, { requestedSource: 'turn_override' });
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
  it('W3: changing the stored model drops the grid variant', async () => {
    const s = session(); await run(s.id); repo.updateFields(s.id, { providerId: 'openai', modelId: 'gpt-6.1-sol' });
    expect(await run(s.id)).not.toHaveProperty('variant');
  });
  it('W6: exhausted auto account reselects on next message without reclassification', async () => {
    const s = session(); await run(s.id); expect(isAutoAccountSession(s.id, 'anthropic')).toBe(true);
    const layer = opencodeSpilloverRouter.stack.find((l: any) => l.route?.path === '/') as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await layer.route.stack[0].handle({ body: { sdkSessionId: s.sdkSessionId, fromAccountId: 'anthropic-2', providerID: 'anthropic', exhausted: true, status: 429 } }, res);
    expect(res.json).toHaveBeenCalledWith({ accepted: true, handoff: false });
    expect(new RouterGridExhaustionStore().isExhausted('anthropic', 'anthropic-2')).toBe(true);
    await run(s.id); expect(repo.findById(s.id)?.anthropicAccountId).toBe('anthropic-1');
    expect(boundary.fetch).toHaveBeenCalledTimes(1); expect(listDecisions()).toHaveLength(2);
    expect(listDecisions()[0].detail.reason).toBe('account_exhausted');
  });
  it('W4: max effort clamps to high; no variants sends none', async () => {
    boundary.inventory.anthropic = []; // OpenAI-only fixture, not merely missing Anthropic usage.
    boundary.snapshot.providers = boundary.snapshot.providers.filter((p: any) => p.provider === 'openai');
    expect(await run(session().id)).toMatchObject({ variant: 'high' });
    expect(listDecisions()[0].detail).toMatchObject({ effortRequested: 'max', effortApplied: 'high' });
    boundary.models.forEach(m => { m.variants = []; }); resetModelCatalogCache();
    expect(await run(session().id)).not.toHaveProperty('variant');
  });
  it('W1: shadow never waits for classification, applies nothing and logs once', async () => {
    configure('shadow'); const s = session(); let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; }); const fetch = boundary.fetch.getMockImplementation()!;
    boundary.fetch.mockImplementation(async (...args: any[]) => { await blocked; return fetch(...args); });
    try {
      const r = await Promise.race([run(s.id), new Promise(resolve => setTimeout(() => resolve('blocked'), 100))]);
      expect(r).toMatchObject({ applied: false, route: base }); await run(s.id);
      expect(repo.findById(s.id)?.routerDecidedAt).toBeNull();
    } finally { release(); }
    await waitForGridShadowForTests();
    expect(listDecisions()).toHaveLength(1); expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(boundary.routing).not.toHaveBeenCalled();
  });
  it('W3: mobile adds persisted variant only when the phone omitted it', async () => {
    const s = session(); await run(s.id);
    const input = { sdkSessionId: s.sdkSessionId!, userId: owner, body: { parts: [{ type: 'text', text: 'next' }] } };
    expect(await routeMobilePromptBody(input)).toMatchObject({ variant: 'low', model: { providerID: 'anthropic', modelID: 'claude-haiku-5-5' } });
    expect(await routeMobilePromptBody({ ...input, body: { ...input.body, variant: 'high' } })).toMatchObject({ variant: 'high' });
  });
  it('W10: migration is additive and idempotent', () => {
    runMigrations(db); runMigrations(db);
    expect((db.prepare('PRAGMA table_info(agent_sessions)').all() as any[]).filter(c => c.name === 'router_variant')).toHaveLength(1);
    expect(repo.findById(session().id)).toHaveProperty('routerVariant', null);
  });
  it('W7: listed runner profile routes model, variant and account; an unlisted pin stays intact', async () => {
    writeFileSync(join(dir, 'router-grid.json'), JSON.stringify({ agent_auto_profiles: ['grid-profile'] }));
    const configs = new AgentConfigsRepository();
    for (const id of ['grid-profile', 'pinned-profile']) configs.insert({ id, label: id, icon: 'code', enabled: true, isAgent: true,
      modelProvider: 'openai', modelId: 'gpt-6.1-sol', ocAgent: 'build', allowedMcpsJson: '{}', allowedSkillsJson: '[]' });
    const settings = defaultDecisionSettings(); Object.assign(settings.routing, { engine: 'grid' }); settings.features.model_routing = 'on';
    settings.backend = 'openai_decisions'; settings.remoteDataConsent = true; settings.openaiDecisions = { baseUrl: 'http://127.0.0.1:9999', model: 'fake', apiKey: 'fake' }; saveDecisionSettings(settings);
    const first = await runAgent({ prompt: 'extract names', agentConfigId: 'grid-profile', ownerUserId: owner });
    expect(first.status, first.error).toBe('done');
    expect(boundary.prompt.mock.calls[0][2]).toEqual({ providerID: 'anthropic', modelID: 'claude-haiku-5-5' });
    expect(boundary.prompt.mock.calls[0][4]).toHaveProperty('variant', 'low');
    expect(boundary.routing).toHaveBeenCalledWith('runner-sdk', 'anthropic-2', { pinned: false });
    const calls = boundary.fetch.mock.calls.length;
    const second = await runAgent({ prompt: 'extract names', agentConfigId: 'pinned-profile', ownerUserId: owner });
    expect(second.status).toBe('done'); expect(boundary.fetch).toHaveBeenCalledTimes(calls);
    expect(boundary.prompt.mock.calls[1][2]).toEqual(base); expect(boundary.prompt.mock.calls[1][4]).not.toHaveProperty('variant');
  });
  it('W9: security with closed accounts exhausted never falls back to OpenRouter', async () => {
    const impl = boundary.fetch.getMockImplementation()!;
    boundary.fetch.mockImplementation(async (...args: any[]) => { const response = await impl(...args); const body = await response.json(); body.answers[3].probability = 1; return new Response(JSON.stringify(body)); });
    const store = new RouterGridExhaustionStore();
    for (const provider of ['anthropic', 'openai'] as const) for (const n of [1, 2]) store.markExhausted(provider, `${provider}-${n}`, Date.now() + 3600000);
    const s = session(); expect(await run(s.id)).toMatchObject({ applied: false, route: base });
    expect(repo.findById(s.id)?.routerDecidedAt).toBeNull(); expect(listDecisions()[0].detail).toMatchObject({ kind: 'none', securitySensitive: true });
  });
  it('W2: stale or missing usage is unknown and starts only a detached refresh', async () => {
    boundary.snapshot.fetchedAt = new Date(Date.now() - 16 * 60000).toISOString();
    expect(await run(session().id)).toMatchObject({ applied: true, gridAccountId: 'anthropic-1' });
    expect(vi.mocked(getUsageBudget).mock.calls.some(([opts]) => opts === undefined)).toBe(true);
    boundary.snapshot = { providers: [], fetchedAt: new Date().toISOString() };
    expect(await run(session().id)).toMatchObject({ applied: true, gridAccountId: 'anthropic-1' });
  });
  it('W4: xhigh/max clamp at high, smallest supported when none is below, empty variants omit effort', () => {
    for (const effort of ['xhigh', 'max']) expect(gridEffortVariant(effort, ['low', 'medium', 'high'])).toBe('high');
    expect(gridEffortVariant('low', ['medium', 'high'])).toBe('medium');
    expect(gridEffortVariant('max', [])).toBeUndefined();
  });
  it('W9: degraded fallback records the flag and broadcasts the existing spillover event', async () => {
    const impl = boundary.fetch.getMockImplementation()!;
    boundary.fetch.mockImplementation(async (...args: any[]) => { const response = await impl(...args); const body = await response.json(); body.answers[0].score = 3; return new Response(JSON.stringify(body)); });
    const store = new RouterGridExhaustionStore();
    for (const provider of ['anthropic', 'openai'] as const) for (const n of [1, 2]) store.markExhausted(provider, `${provider}-${n}`, Date.now() + 3600000);
    const s = session(); const result = await run(s.id);
    expect(result).toMatchObject({ applied: true, route: { providerID: 'openrouter', modelID: 'xiaomi/mimo-v2.6-pro' } });
    expect(listDecisions()[0].detail).toMatchObject({ degraded: true, tier: 1 });
    expect(boundary.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.spillover', sessionId: s.id, reason: 'degraded_fallback' }));
  });
  it('W3: unchanged model writes retain variant; switching off routing retains carryover', async () => {
    const s = session(); await run(s.id); const row = repo.findById(s.id)!;
    repo.updateFields(s.id, { providerId: row.providerId, modelId: row.modelId });
    const settings = defaultDecisionSettings(); settings.features.model_routing = 'off'; saveDecisionSettings(settings);
    expect(await run(s.id)).toMatchObject({ variant: 'low', route: { providerID: row.providerId, modelID: row.modelId } });
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('G2 fail-closed routing errors (no model/SDK dispatch)', () => {
  it('inventory failure holds before classifier/provider/account routing', async () => {
    boundary.usageError = new Error('synthetic inventory failure'); const s = session();
    expect(await run(s.id)).toMatchObject({ applied: false, route: base, held: { reason: 'router_state_unavailable', durable: false } });
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.routing).not.toHaveBeenCalled(); expect(boundary.prompt).not.toHaveBeenCalled();
    expect(listDecisions().at(-1)).toMatchObject({ status: 'error', applied: false, chosen: null,
      detail: { engine: 'grid', kind: 'router_state_unavailable', errorName: 'Error' } });
    expect(listDecisions().at(-1)?.queryPreview).toBeNull();
  });
  it('corrupt Free state holds before classifier/provider/account routing', async () => {
    freeOnForFailure(); writeFileSync(routerFreeStatePath(), '{corrupt'); const s = session();
    expect(await run(s.id)).toMatchObject({ held: { reason: 'router_state_unavailable' } });
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.routing).not.toHaveBeenCalled(); expect(boundary.prompt).not.toHaveBeenCalled();
  });
  it('ledger append failure holds and never applies an account or prompts SDK', async () => {
    const spy = vi.spyOn(RouterGridAttemptsRepository.prototype, 'append').mockRejectedValueOnce(new Error('synthetic ledger failure')); const s = session();
    expect(await run(s.id)).toMatchObject({ held: { reason: 'router_state_unavailable' }, applied: false });
    expect(boundary.routing).not.toHaveBeenCalled(); expect(boundary.prompt).not.toHaveBeenCalled(); spy.mockRestore();
  });
});
function freeOnForFailure() { writeFileSync(join(dir, 'router-grid.json'), JSON.stringify({ agent_auto_profiles: ['grid-profile'], free_mode: { ...defaultRouterGridConfig().free_mode, enabled: true } })); }

describe('durable automatic-account provenance after process-memory loss', () => {
  it('reconstructs router-owned account and reroutes an exhausted account after restart', async () => {
    const s = session(); const first = await run(s.id); expect(first.applied).toBe(true);
    const row = repo.findById(s.id)!; const old = row.providerId === 'anthropic' ? row.anthropicAccountId : row.openaiAccountId;
    expect(old).toBeTruthy(); clearAutoAccountSessionsForTests();
    new RouterGridExhaustionStore().markExhausted(row.providerId as 'anthropic'|'openai', old!, Date.now() + 3600000);
    const second = await run(s.id); expect(second.applied).toBe(true); expect(second.gridAccountId).not.toBe(old);
  });
  it.each(['pinned','missing','stale-account'])('%s durable evidence never converts an explicit account to auto', async kind => {
    const s = session(); repo.updateFields(s.id, { providerId: 'anthropic', modelId: 'claude-haiku-5-5' }); db.prepare("UPDATE agent_sessions SET anthropic_account_id=?, anthropic_account_source='router' WHERE id=?").run('anthropic-1', s.id);
    repo.setRouterDecision(s.id, { providerId: 'anthropic', modelId: 'claude-haiku-5-5', decidedAt: new Date().toISOString() });
    if (kind !== 'missing') await new RouterGridAttemptsRepository().append(s.id,
      { tier: 4, category: 'knowledge', canQueue: false, securitySensitive: false, estInputTokens: 2, source: 'rules', reason: 'ok' },
      { kind: 'route', model: 'anthropic/claude-haiku-5-5', provider: 'anthropic', effortRequested: 'low', effortApplied: 'low',
        accountId: kind === 'stale-account' ? 'anthropic-2' : 'anthropic-1', accountSource: kind === 'pinned' ? 'pinned' : 'router', tierUsed: 4, reason: 'ok', degraded: false, trace: [] });
    clearAutoAccountSessionsForTests(); new RouterGridExhaustionStore().markExhausted('anthropic', 'anthropic-1', Date.now() + 3600000);
    const result = await run(s.id); expect(result.applied).toBe(false); expect(repo.findById(s.id)?.anthropicAccountId).toBe('anthropic-1');
  });
});

describe('applyGridAccount respects authoritative provenance over stale memory', () => {
  it('NULL current account stays explicit/unknown even when stale auto marker exists', async () => {
    const s = session(); db.prepare("UPDATE agent_sessions SET provider_id='anthropic', model_id='claude-haiku-5-5', anthropic_account_id='anthropic-1', anthropic_account_source=NULL WHERE id=?").run(s.id);
    markAutoAccountSession(s.id, 'anthropic');
    await expect(applyGridAccount(s.id, 'anthropic', 'anthropic-2')).rejects.toThrow('grid_account_pinned');
    expect(repo.findById(s.id)).toMatchObject({ anthropicAccountId: 'anthropic-1', anthropicAccountSource: null });
    expect(isAutoAccountSession(s.id, 'anthropic')).toBe(false);
  });
});

describe('authoritative NULL account source remains unknown', () => {
  it('does not reconstruct auto from an older applied router receipt after ambiguous pin history', async () => {
    const s = session();
    repo.updateFields(s.id, { providerId: 'anthropic', modelId: 'claude-haiku-5-5' });
    db.prepare('UPDATE agent_sessions SET anthropic_account_id=?, anthropic_account_source=NULL WHERE id=?').run('anthropic-1', s.id);
    repo.setRouterDecision(s.id, { providerId: 'anthropic', modelId: 'claude-haiku-5-5', decidedAt: new Date().toISOString() });
    await new RouterGridAttemptsRepository().append(s.id,
      { tier: 4, category: 'knowledge', canQueue: false, securitySensitive: false, estInputTokens: 2, source: 'rules', reason: 'ok' },
      { kind: 'route', model: 'anthropic/claude-haiku-5-5', provider: 'anthropic', effortRequested: 'low', effortApplied: 'low',
        accountId: 'anthropic-1', accountSource: 'router', tierUsed: 4, reason: 'ok', degraded: false, applied: true, trace: [] });
    clearAutoAccountSessionsForTests(); new RouterGridExhaustionStore().markExhausted('anthropic', 'anthropic-1', Date.now() + 3600000);
    const result = await run(s.id); expect(result.applied).toBe(false);
    expect(repo.findById(s.id)).toMatchObject({ anthropicAccountId: 'anthropic-1', anthropicAccountSource: null });
  });
});

describe('Free Mode F1/F2 through the real turn router, runner and mobile path (synthetic boundaries)', () => {
  const freeOn = () => {
    writeFileSync(join(dir, 'router-grid.json'), JSON.stringify({ agent_auto_profiles: ['grid-profile'],
      free_mode: { ...defaultRouterGridConfig().free_mode, enabled: true } }));
    const settings = defaultDecisionSettings(); Object.assign(settings.routing, { engine: 'grid' }); settings.features.model_routing = 'on';
    settings.backend = 'openai_decisions'; settings.remoteDataConsent = true;
    settings.openaiDecisions = { baseUrl: 'http://127.0.0.1:9999', model: 'fake', apiKey: 'fake' }; saveDecisionSettings(settings);
  };
  const exhaustAll = (fraction = 0) => { for (const p of boundary.snapshot.providers) p.items = [{ label: '5h', remainingFraction: fraction }]; };
  const queue = () => existsSync(routerFreeStatePath()) ? JSON.parse(readFileSync(routerFreeStatePath(), 'utf8')).queue : [];

  it('disabled (default) never holds, even with every account exhausted', async () => {
    exhaustAll(); const s = session();
    expect((await run(s.id)).held).toBeUndefined();
    expect(existsSync(routerFreeStatePath())).toBe(false);
  });
  it('F1: interactive turn and mobile follow-up are held; no Free call, body-free descriptor, no paid OpenRouter at budget 0', async () => {
    freeOn(); exhaustAll(); const s = session();
    expect(await run(s.id)).toMatchObject({ applied: false, route: base, held: { reason: 'free_mode_queued', durable: true } });
    expect(boundary.fetch).toHaveBeenCalledTimes(1); // only the existing paid classifier; OpenRouter is authed but never chosen
    expect(queue()).toEqual([{ taskId: `session:${s.id}`, ownerUserId: String(owner), reference: `session:${s.id}`, enqueuedAt: expect.any(Number),
      classification: { tier: 4, category: 'knowledge', canQueue: false, containsPrivateData: 'unknown' } }]);
    expect(readFileSync(routerFreeStatePath(), 'utf8')).not.toContain('extract the names');
    expect(JSON.parse(readFileSync(routerFreeStatePath(), 'utf8')).dailyCount).toBe(0);
    expect(listDecisions()[0].detail).toMatchObject({ kind: 'free_queued', reason: 'free_mode_queued' });
    expect(repo.findById(s.id)?.routerDecidedAt).toBeNull();
    const mobile = await routeMobilePromptBody({ sdkSessionId: s.sdkSessionId!, userId: owner, body: { parts: [{ type: 'text', text: 'next' }] } });
    expect(mobile).toBeInstanceOf(FreeModeHeld);
    expect(boundary.fetch).toHaveBeenCalledTimes(1); // stored classification reused, still no new call
    expect(queue()).toHaveLength(1);
  });
  it('F2 idle recovery: fresh usage event drains without a new routed turn, single-flight', async () => {
    freeOn(); exhaustAll(); const held = session(); await run(held.id);
    expect(JSON.parse(readFileSync(routerFreeStatePath(), 'utf8')).queue).toHaveLength(1);
    exhaustAll(0.8); boundary.snapshot.fetchedAt = new Date().toISOString(); const calls = boundary.fetch.mock.calls.length;
    expect(boundary.usageListener).toBeTypeOf('function');
    await Promise.all([boundary.usageListener!(boundary.snapshot), boundary.usageListener!(boundary.snapshot)]);
    await waitForFreeReleaseForTests();
    expect(JSON.parse(readFileSync(routerFreeStatePath(), 'utf8')).queue).toEqual([]);
    expect(boundary.broadcast).toHaveBeenCalledTimes(1);
    expect(boundary.broadcast).toHaveBeenCalledWith({ v: 1, type: 'session.free_mode_released', sessionId: held.id });
    expect(boundary.fetch).toHaveBeenCalledTimes(calls); // no classifier/provider call during release
  });
  it('F1: scheduled runner is deferred for capacity (15 min) and never prompts the engine', async () => {
    freeOn(); exhaustAll();
    new AgentConfigsRepository().insert({ id: 'grid-profile', label: 'grid-profile', icon: 'code', enabled: true, isAgent: true,
      modelProvider: 'openai', modelId: 'gpt-6.1-sol', ocAgent: 'build', allowedMcpsJson: '{}', allowedSkillsJson: '[]' });
    const result = await runAgent({ prompt: 'extract names', agentConfigId: 'grid-profile', ownerUserId: owner });
    expect(result).toMatchObject({ status: 'error', errorCode: 'capacity', retryAfterMs: 15 * 60_000 });
    expect(result.error).toContain('Paid model capacity is exhausted');
    expect(boundary.prompt).not.toHaveBeenCalled();
    expect(repo.findById(result.sessionId)?.status).toBe('error');
  });
  it('F2: stale positive usage keeps the hold; fresh positive capacity releases and the resend reuses the stored classification', async () => {
    freeOn(); exhaustAll(); const held = session(); await run(held.id);
    exhaustAll(0.9); boundary.snapshot.fetchedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    await run(session().id); await waitForFreeReleaseForTests();
    expect(queue()).toHaveLength(1);
    expect(boundary.broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.free_mode_released' }));
    boundary.snapshot.fetchedAt = new Date().toISOString();
    expect(await run(session().id)).toMatchObject({ applied: true });
    await waitForFreeReleaseForTests();
    expect(queue()).toEqual([]);
    expect(boundary.broadcast).toHaveBeenCalledWith({ v: 1, type: 'session.free_mode_released', sessionId: held.id });
    expect(repo.findById(held.id)?.lastPreview).toContain('Paid model capacity is back');
    const calls = boundary.fetch.mock.calls.length;
    const resent = await run(held.id);
    expect(resent).toMatchObject({ applied: true }); expect(resent.held).toBeUndefined();
    expect(boundary.fetch).toHaveBeenCalledTimes(calls);
  });
});
