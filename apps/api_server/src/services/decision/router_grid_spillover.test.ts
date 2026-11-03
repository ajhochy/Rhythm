import Database from 'better-sqlite3';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ snapshot: {} as any, advance: vi.fn() }));
vi.mock('../usage_budget_service', () => ({ getUsageBudget: async () => boundary.snapshot }));
vi.mock('../turn_redispatch', () => ({ advanceFallbackCascade: boundary.advance, finalizeErrorStatus: vi.fn() }));
vi.mock('../ws_gateway', () => ({ broadcast: vi.fn(), broadcastSessionUpdated: vi.fn() }));
vi.mock('../anthropic_accounts_service', () => ({ anthropicAccountsService: { setRouting: vi.fn() } }));
vi.mock('../openai_accounts_service', () => ({ openaiAccountsService: { setRouting: vi.fn() } }));
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { opencodeSpilloverRouter } from '../../routes/opencode_spillover_routes';
import { RouterGridExhaustionStore } from './router_grid_exhaustion';
import { defaultDecisionSettings, saveDecisionSettings } from './decision_settings';
let db: Database.Database, prev: Database.Database | null, dir: string, id: string, saved: string | undefined;
beforeEach(() => {
  saved = process.env.RHYTHM_DECISION_ROUTER_FILE; dir = mkdtempSync(join(tmpdir(), 'grid-intake-'));
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'settings.json');
  const settings = defaultDecisionSettings(); Object.assign(settings.routing, { engine: 'grid' }); settings.features.model_routing = 'on'; saveDecisionSettings(settings);
  db = new Database(':memory:'); runMigrations(db); prev = setDb(db);
  const repo = new AgentSessionsRepository(); id = repo.insert({ agentKind: 'claude-code', cwd: '/tmp', name: 'fake', taskId: null, modelMode: 'auto' }).id;
  repo.setSdkSessionId(id, 'sdk'); repo.setAnthropicAccountId(id, 'a');
  repo.setRouterDecision(id, { providerId: 'anthropic', modelId: 'fake', decidedAt: new Date().toISOString(), variant: 'low' } as any);
  boundary.snapshot = { fetchedAt: new Date().toISOString(), providers: [{ provider: 'anthropic', accountId: 'a', kind: 'window', label: 'Fake', items: [{ label: '5h', remainingFraction: 0, resetAt: new Date(Date.now() + 7200000).toISOString() }] }] };
  boundary.advance.mockReset(); boundary.advance.mockResolvedValue({ outcome: 'terminal' });
});
afterEach(() => { setDb(prev); db.close(); if (saved === undefined) delete process.env.RHYTHM_DECISION_ROUTER_FILE; else process.env.RHYTHM_DECISION_ROUTER_FILE = saved; });
async function intake(extra: Record<string, unknown>) {
  // Drive the real Express handler directly: no listening socket or server.
  const layer = opencodeSpilloverRouter.stack.find((l: any) => l.route?.path === '/');
  const handler = (layer as any).route.stack[0].handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await handler({ body: { sdkSessionId: 'sdk', fromAccountId: 'a', providerID: 'anthropic', exhausted: true, ...extra } }, res);
  return res;
}
it('W6: explicit HTTP 429 marks the cached soonest reset, with no failed-message retry', async () => {
  const expected = Date.parse(boundary.snapshot.providers[0].items[0].resetAt);
  await intake({ status: 429 });
  expect(new RouterGridExhaustionStore().list()).toEqual([{ provider: 'anthropic', accountId: 'a', exhaustedUntil: expected }]);
  expect(boundary.advance).not.toHaveBeenCalled();
});
it('repair-c4: status-less callback needs positive fresh quota evidence', async () => {
  const expected = Date.parse(boundary.snapshot.providers[0].items[0].resetAt);
  await intake({ reason: 'rate_limited' });
  expect(new RouterGridExhaustionStore().list()).toEqual([{ provider: 'anthropic', accountId: 'a', exhaustedUntil: expected }]);
  expect(boundary.advance).not.toHaveBeenCalled();
});
it.each(['unknown', 'stale', 'future', 'other-account'])('repair-c4: status-less %s evidence cannot exhaust', async kind => {
  if (kind === 'unknown') boundary.snapshot.providers[0].items[0].remainingFraction = null;
  if (kind === 'stale') boundary.snapshot.fetchedAt = new Date(Date.now() - 16 * 60000).toISOString();
  if (kind === 'future') boundary.snapshot.fetchedAt = new Date(Date.now() + 60000).toISOString();
  if (kind === 'other-account') boundary.snapshot.providers[0].accountId = 'b';
  await intake({ reason: 'rate_limited' });
  expect(new RouterGridExhaustionStore().list()).toEqual([]);
  expect(boundary.advance).not.toHaveBeenCalled();
});
it('W6: 529 overload is not quota exhaustion and never retries the grid turn', async () => {
  await intake({ status: 529 }); expect(new RouterGridExhaustionStore().list()).toEqual([]);
  expect(boundary.advance).not.toHaveBeenCalled();
});
it('W6: explicit retry-after takes precedence over the cached reset', async () => {
  const now = Date.now(); await intake({ status: 429, retryAfter: 60 });
  expect(new RouterGridExhaustionStore().list()[0]?.exhaustedUntil).toBeGreaterThanOrEqual(now + 60000);
  expect(new RouterGridExhaustionStore().list()[0]?.exhaustedUntil).toBeLessThan(now + 61000);
});
