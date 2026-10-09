import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// Only external engine/quota boundaries are faked; routing/catalog/settings/logging are real.
vi.mock('../opencode_engine', () => ({ opencodeClient: {
  providerSnapshot: vi.fn().mockResolvedValue({ providers: [] }),
  listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']), isProviderInAuthStore: () => true,
} }));
vi.mock('../usage_budget_service', () => ({ getUsageBudget: vi.fn().mockResolvedValue({ providers: [] }) }));
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { logger } from '../../utils/logger';
import { buildConfigView, mergeConfig, testConfig, updateConfig } from './decision_config_service';
import { defaultDecisionSettings, loadDecisionSettings, resetDecisionSettingsCacheForTests, saveDecisionSettings } from './decision_settings';
import { listDecisions, recordDecision, summarizeDecisions } from './decision_log';
import { routeTurnTier, waitForShadowRoutingForTests } from './model_router';
import { resetModelCatalogCache } from './model_catalog';
import { rankMcpAllowlist } from './tool_ranker';
import { rankCandidates } from './decision_engine';
import decisionsRouter from '../../routes/agent_decisions_routes';

const KEY = 'synthetic-slice-e-not-a-real-key';
const QUESTION = {
  type: 'score', name: 'effort',
  instructions: 'The input is a request a person sent to their AI assistant, which can use tools (files, email, calendar, web, code, other agents). How capable a model does this request need to be done well? Judge the work required, not the length of the message or its subject area.',
  levels: [
    { label: 'quick', description: 'A short factual answer, a quick lookup or status check, a yes/no capability question, or a tiny mechanical change. One step, little judgement.' },
    { label: 'everyday', description: 'Normal work: write or rewrite a document, email, report or plan; analyse some data; search and summarise a few sources; use several tools in sequence; fix a routine problem.' },
    { label: 'hard', description: 'Deep work: plan or build something large across many steps, design a system, debug a hard or unclear failure, synthesise or critique many sources, or set strategy or policy.' },
  ],
};
const answer = (score = 1, extra: Record<string, unknown> = {}) => ({
  answers: [{ type: 'score', name: 'effort', score, confidence: 0.01,
    probabilities: [{ value: 0, label: 'quick', probability: 0.1 }, { value: 1, label: 'everyday', probability: 0.2 }, { value: 2, label: 'hard', probability: 0.7 }], ...extra }],
  usage: { input_tokens: 123 },
});
const input = { prompt: 'What tasks are due today?', agentId: 'claude-code', requestedSource: 'auto', baselineTier: 'frontier' as const,
  baseRoute: { providerID: 'anthropic', modelID: 'claude-opus-4-7' }, modeOverride: 'on' as const };
let dir: string, db: Database.Database, prev: ReturnType<typeof setDb>, saved: Record<string, string | undefined>;
let fetchStub: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith('AGENT_DECISION_')) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'slice-e-'));
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'settings.json');
  resetDecisionSettingsCacheForTests(); resetModelCatalogCache();
  db = new Database(':memory:'); runMigrations(db); prev = setDb(db);
  // Initial RED uses tolerant settings so absence fails assertions, not setup.
  const settings = { ...defaultDecisionSettings(), backend: 'openai_decisions', remoteDataConsent: true,
    openaiDecisions: { baseUrl: 'http://127.0.0.1:1', model: 'gpt-6-luna', apiKey: KEY } };
  // Synthetic fixture only; never operator settings or key files.
  saveDecisionSettings(settings as ReturnType<typeof defaultDecisionSettings>);
  fetchStub = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(answer())); vi.stubGlobal('fetch', fetchStub);
  vi.spyOn(logger, 'info'); vi.spyOn(logger, 'warn');
});
afterEach(async () => {
  await waitForShadowRoutingForTests();
  expect(JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.warn).mock.calls])).not.toContain(KEY);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  setDb(prev); db.close(); rmSync(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved); resetDecisionSettingsCacheForTests(); resetModelCatalogCache();
});

describe('Slice E scored backend (fetch boundary only)', () => {
  it('E1/E6: write-only key survives fresh GET, omitted PUT, clears explicitly, and probe returns diagnostics', async () => {
    const view = updateConfig({ backend: 'openai_decisions', remoteDataConsent: true, openaiDecisions: { apiKey: KEY } });
    expect(view).toHaveProperty('openaiDecisions.hasApiKey', true);
    expect(JSON.stringify(view)).not.toContain(KEY);
    expect(statSync(process.env.RHYTHM_DECISION_ROUTER_FILE!).mode & 0o777).toBe(0o600);
    resetDecisionSettingsCacheForTests();
    expect(JSON.stringify(buildConfigView())).not.toContain(KEY);
    updateConfig({ openaiDecisions: { model: 'gpt-6-luna' } });
    expect(loadDecisionSettings()).toHaveProperty('openaiDecisions.apiKey', KEY);
    expect(await testConfig({})).toMatchObject({ ok: true, backend: 'openai_decisions', model: 'gpt-6-luna', tier: 'frontier', score: 1,
      levelProbabilities: { quick: 0.1, everyday: 0.2, hard: 0.7 }, latencyMs: expect.any(Number) });
    const cleared = updateConfig({ openaiDecisions: { apiKey: '' } });
    expect(cleared).toHaveProperty('openaiDecisions.hasApiKey', false);
    expect(await testConfig({})).toMatchObject({ ok: false, message: 'no_api_key' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
  it('E2/E3: exact one-question wire contract trims/bounds raw prompt and never publishes key', async () => {
    const info = vi.spyOn(logger, 'info'), warn = vi.spyOn(logger, 'warn');
    const prompt = `  ${'x'.repeat(8010)}  `;
    expect(await routeTurnTier({ ...input, prompt })).toMatchObject({ tier: 'frontier', applied: true, confidence: 0.01 });
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1/v1/decisions');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${KEY}` }, signal: expect.any(AbortSignal) });
    expect(JSON.parse(init!.body as string)).toEqual({ model: 'gpt-6-luna', input: 'x'.repeat(8000), questions: [QUESTION] });
    const [row] = listDecisions();
    expect(row).toMatchObject({ model: 'gpt-6-luna', chosen: 'frontier', confidence: 0.01, detail: { backend: 'openai_decisions', score: 1,
      levelProbabilities: { quick: 0.1, everyday: 0.2, hard: 0.7 }, thresholds: { cheapBelow: 0.15, frontierAbove: 0.95 }, inputTokens: 123, estimatedUsd: 123 * 0.10 / 1e6 } });
    expect(JSON.stringify([row, info.mock.calls, warn.mock.calls])).not.toContain(KEY);
  });
  it.each([[0.149, 'cheap'], [0.15, 'standard'], [0.95, 'standard'], [0.951, 'frontier']] as const)('E3/E8: score %s maps to %s despite low API confidence', async (score, tier) => {
    fetchStub.mockResolvedValue(Response.json(answer(score)));
    expect(await routeTurnTier(input)).toMatchObject({ tier, applied: true, reason: 'ok', confidence: 0.01 });
    expect(listDecisions()[0]).toMatchObject({ chosen: tier, confidence: 0.01 });
    expect(listDecisions()[0].detail.reason).toBeUndefined();
  });
  it.each([
    ['refusal', 'error', 'refusal'], ['429', 'error', 'http_429'], ['malformed', 'error', 'malformed_response'],
    ['timeout', 'timeout', 'timeout_1000ms'], ['no_key', 'disabled', 'no_api_key'], ['no_consent', 'disabled', 'remote_consent_required'],
  ])('E8: %s leaves route unchanged and records body-free status/reason', async (scenario, status, reason) => {
    if (scenario === 'refusal') fetchStub.mockImplementation(async () => Response.json({ answers: [{ type: 'refusal', name: 'effort' }] }));
    if (scenario === '429') fetchStub.mockImplementation(async () => new Response(KEY, { status: 429 }));
    if (scenario === 'malformed') fetchStub.mockImplementation(async () => Response.json(answer(3)));
    if (scenario === 'timeout') fetchStub.mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    if (scenario === 'no_key') updateConfig({ openaiDecisions: { apiKey: '' } });
    if (scenario === 'no_consent') {
      const { saveDecisionSettings } = await import('./decision_settings');
      saveDecisionSettings({ ...loadDecisionSettings(), remoteDataConsent: false });
    }
    for (const modeOverride of ['on', 'shadow'] as const) {
      db.exec('DELETE FROM agent_decision_log');
      const result = await routeTurnTier({ ...input, modeOverride });
      expect(result).toMatchObject({ tier: null, applied: false }); expect(result.route).toBeUndefined();
      await waitForShadowRoutingForTests();
      expect(listDecisions()[0]).toMatchObject({ status, applied: false, chosen: null, detail: { reason } });
      expect(JSON.stringify(listDecisions())).not.toContain(KEY);
    }
    if (scenario === 'no_key' || scenario === 'no_consent') expect(fetchStub).not.toHaveBeenCalled();
  });
  it.each(['turn_override', 'session', 'tier', 'agent_config'])('E3: pin %s never sends a prompt', async (requestedSource) => {
    for (const modeOverride of ['on', 'shadow'] as const) expect(await routeTurnTier({ ...input, requestedSource, modeOverride })).toMatchObject({ reason: 'pinned_source' });
    expect(fetchStub).not.toHaveBeenCalled(); expect(listDecisions()).toHaveLength(0);
  });
  it('E3: closed scope gate is respected even though API confidence is diagnostic', async () => {
    const gate = vi.fn(() => ({ apply: false, reason: 'closed' }));
    expect(await routeTurnTier({ ...input, scopeGate: gate })).toMatchObject({ tier: null, applied: false, reason: 'scope:closed' });
    expect(gate).toHaveBeenCalledWith('frontier', 1);
    expect(listDecisions()[0].detail).toMatchObject({ scope: 'closed', wouldApply: false });
  });
  it('E3/E8: detached shadow returns before fetch resolves, logs once and never applies', async () => {
    let release!: (response: Response) => void;
    fetchStub.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const request = { ...input, modeOverride: 'shadow' as const, sessionId: 'first' };
    try {
      expect(await Promise.race([routeTurnTier(request), new Promise(resolve => setTimeout(() => resolve('blocked'), 25))])).toMatchObject({ reason: 'shadow', tier: null });
      expect(listDecisions()).toHaveLength(0);
    } finally { release?.(Response.json(answer())); }
    await waitForShadowRoutingForTests();
    expect(listDecisions()[0]).toMatchObject({ chosen: 'frontier', applied: false, detail: { wouldApply: true, pickedModel: expect.any(String) } });
    expect(await routeTurnTier(request)).toMatchObject({ reason: 'shadow_continuation' }); expect(fetchStub).toHaveBeenCalledTimes(1);
  });
  it('E4: tool and memory candidate ranking use local reranker, including changed local settings', async () => {
    process.env.AGENT_DECISION_TOOL_RANKING = 'on';
    fetchStub.mockImplementation(async () => Response.json({ results: [{ index: 0, relevance_score: 0.1 }, { index: 1, relevance_score: 0.9 }] }));
    const tools = await rankMcpAllowlist({ servers: ['email', 'calendar'], tools: [] }, 'schedule meeting');
    expect(tools.servers).toEqual(['calendar', 'email']);
    // Same production entry point used by memory_retrieval, no injected client.
    expect(await rankCandidates('meeting', [{ id: 'a', text: 'memory A' }, { id: 'b', text: 'memory B' }])).toMatchObject({ status: 'ok', ranked: [{ id: 'b', score: 0.9 }, { id: 'a', score: 0.1 }] });
    updateConfig({ local: { baseUrl: 'http://127.0.0.1:3', model: 'updated-local' } });
    expect(await rankCandidates('meeting', [{ id: 'a', text: 'memory A' }, { id: 'b', text: 'memory B' }])).toMatchObject({ model: 'updated-local' });
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:8012/v1/rerank', 'http://127.0.0.1:8012/v1/rerank', 'http://127.0.0.1:3/v1/rerank']);
    expect(fetchStub.mock.calls.every(([, init]) => !JSON.stringify(init).includes(KEY))).toBe(true);
  });
  it('E5: status aggregates only OpenAI model-routing tiers/cost', async () => {
    for (const score of [0.01, 0.5, 1.5]) { fetchStub.mockResolvedValue(Response.json(answer(score))); await routeTurnTier(input); }
    recordDecision({ feature: 'model_routing', mode: 'on', status: 'ok', applied: true, chosen: 'cheap', detail: { estimatedUsd: 100 } });
    const summary = summarizeDecisions({ feature: 'model_routing' })[0] as unknown as { openaiDecisions: { tiers: unknown; estimatedUsd: number } };
    expect(summary).toHaveProperty('openaiDecisions.tiers', { cheap: 1, standard: 1, frontier: 1 });
    expect(summary.openaiDecisions.estimatedUsd).toBeCloseTo(3 * 123 * 0.1 / 1e6, 12);
  });
  it('E1: rejects unsafe remote HTTP and missing consent on config merge', () => {
    expect(() => mergeConfig(defaultDecisionSettings(), { backend: 'openai_decisions', remoteDataConsent: true, openaiDecisions: { baseUrl: 'http://example.com' } })).toThrow();
    expect(() => mergeConfig(defaultDecisionSettings(), { backend: 'openai_decisions' })).toThrow(/consent/i);
  });
  it.each([
    { score: -1 }, { score: '1' }, { confidence: '0.5' }, { confidence: 2 },
    { probabilities: [{ value: 0, label: 'quick', probability: '0.1' }] },
    { probabilities: [{ value: 0, label: 'quick', probability: -1 }, { value: 1, label: 'everyday', probability: 1 }, { value: 2, label: 'hard', probability: 1 }] },
    { name: 'other' }, { type: 'choice' },
  ])('E2: malformed score answer %j is rejected, not applied', async extra => {
    fetchStub.mockImplementation(async () => Response.json(answer(1, extra)));
    expect(await routeTurnTier(input)).toMatchObject({ tier: null, applied: false });
    expect(listDecisions()[0]).toMatchObject({ status: 'error', detail: { reason: 'malformed_response' } });
  });
  it('E6: actual /config/test route returns the scored diagnostics without a socket or key echo', async () => {
    const layer = decisionsRouter.stack.find((l: { route?: { path: string } }) => l.route?.path === '/config/test');
    expect(layer).toBeDefined();
    const handler = layer!.route!.stack.at(-1)!.handle;
    const json = vi.fn(); const res = { json, status: vi.fn().mockReturnThis() };
    await handler({ body: {} } as import('express').Request, res as unknown as import('express').Response, () => undefined);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, tier: 'frontier', score: 1, levelProbabilities: { quick: 0.1, everyday: 0.2, hard: 0.7 } }));
    expect(JSON.stringify(json.mock.calls)).not.toContain(KEY);
  });
});
