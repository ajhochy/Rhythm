/** SAFE LIVE G2 only. Manager launches fixtures; no subprocesses, cleanup, or remote APIs here. */
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { readFileSync, realpathSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { resetGridCaseState } from './fixtures/grid_case_state';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_GRID_ACCOUNTS === '1';
const ROOT = ['/private/tmp/sdmr-grid-sandbox', '/private/tmp/sdmr-grid-sandbox-r6u'].find(r => r === process.env.RHYTHM_SANDBOX_DIR) ?? '/private/tmp/sdmr-grid-sandbox';
const BASE = 'http://127.0.0.1:4398';
const ENGINE = 'http://127.0.0.1:4397';
const PROVIDER = 'http://127.0.0.1:7482';
const headers = { authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
type Capture = { model: string | null; effort: string | null; accountLabel: string; turnTag: string; HTTPstatus: number };
type Evidence = { guards: { api?: boolean; engine?: boolean }; captures: Capture[] };
type Row = { applied: boolean; detail: { model: string; effortRequested: string; effortApplied: string | null; accountId: string; accountSource: string; reason: string; classifierSource: string; tier: number; category: string; securitySensitive: boolean; trace: Array<Record<string, unknown>> } };
type Session = { status: string; modelId: string; providerId: string; routerVariant: string | null; openaiAccountId: string; anthropicAccountId: string; sdkSessionId: string; routerDecidedAt: string | null };
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
// Requests from the exercised grid routes, independent of the applied ledger values.
const effortRequests: Record<string, string> = { 'openai/gpt-6-luna': 'max', 'openai/gpt-6-sol': 'medium', 'openai/gpt-6.1-sol': 'max', 'openai/gpt-6-astra': 'max', 'anthropic/claude-sonnet-5-5': 'high' };
const expectedEfforts = new Map<string, string | null>();
let ws: WebSocket;
let excludedModels: string[] = [];
let fixtureReady = false;
function fixtureJson(path: string) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('GRID_SYNTHETIC_FIXTURE_INVALID'); } // parser errors can quote credential values
}
const pause = () => new Promise(r => setTimeout(r, 250));
async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (![BASE, PROVIDER, ENGINE].includes(new URL(url).origin)) throw new Error('GRID_TEST_EGRESS_REFUSED');
  const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`GRID_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}
const api = <T>(path: string, init?: RequestInit) => request<T>(BASE + path, init);
const evidence = () => request<Evidence>(PROVIDER + '/_grid/evidence', { headers: { authorization: '' } });
const control = (body: object) => request(PROVIDER + '/_grid/control', { method: 'POST', headers: { authorization: '' }, body: JSON.stringify(body) });
async function poll<T>(read: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + 90000;
  while (Date.now() < end) { const result = await read(); if (result !== undefined) return result; await pause(); }
  throw new Error('GRID_OBSERVABLE_OUTCOME_TIMEOUT');
}
const rows = async (id: string) => (await api<{ recent: Array<Row & { sessionId: string }> }>('/agent-decisions?feature=model_routing&limit=200')).recent.filter(r => r.sessionId === id).reverse();
const snapshot = async (id: string) => (await api<{ session: Session }>(`/agent-sessions/${id}`)).session;
async function freshOpenAIUsage(a: number, b: number) {
  const started = Date.now();
  const usage = await api<{ fetchedAt: string; providers: Array<{ provider: string; accountId?: string; items: Array<{ remainingFraction: number | null }> }> }>('/agents/usage-budget?force=true');
  const fetched = Date.parse(usage.fetchedAt);
  expect(Number.isFinite(fetched) && fetched >= started - 1000 && fetched <= Date.now(), 'GRID_FRESH_USAGE_REQUIRED').toBe(true);
  for (const [suffix, expected] of [['a', a], ['b', b]] as const) {
    const items = usage.providers.find(p => p.provider === 'openai' && p.accountId === `syntheticgrid-openai-${suffix}`)?.items ?? [];
    expect(items.length > 0 && items.every(i => typeof i.remainingFraction === 'number' && Number.isFinite(i.remainingFraction)), 'GRID_KNOWN_OPENAI_USAGE_REQUIRED').toBe(true);
    expect(Math.min(...items.map(i => i.remainingFraction!))).toBeCloseTo(expected);
  }
}
async function configure(allExcluded = false, crossProvider = false) {
  await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({
    backend: 'openai_decisions', remoteDataConsent: true, timeoutMs: 2500,
    openaiDecisions: { baseUrl: PROVIDER, model: 'gpt-6-luna', apiKey: 'syntheticgrid-decisions' },
    features: { model_routing: 'on', capacity_routing: 'on', memory_ranking: 'off', tool_ranking: 'off' },
    routing: { engine: 'grid', scope: 'first_prompt' },
    excludedModels: allExcluded ? [...excludedModels, 'openai/gpt-6-luna', 'openai/gpt-6-sol', 'openai/gpt-6.1-sol', 'openai/gpt-6-astra'] : crossProvider ? excludedModels.filter(m => !['anthropic/claude-sonnet-5-5', 'anthropic/claude-haiku-5-5'].includes(m)) : excludedModels,
  }) });
}
async function session() {
  const profile = `syntheticgrid-${randomUUID()}`;
  await api('/agent-configs', { method: 'POST', body: JSON.stringify({ id: profile, label: profile, isAgent: true,
    enabled: true, sessionSelectable: true, ocAgent: profile, modelProvider: 'openai', modelId: 'gpt-6-luna',
    corePermissionsJson: JSON.stringify({ '*': 'deny' }), systemPrompt: 'Synthetic harmless fixture. No tools.' }) });
  await api('/system/refresh', { method: 'POST' });
  const created = await api<{ id: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({ agentId: profile,
    cwd: mkdtempSync(join(process.env.TMPDIR!, 'syntheticgrid-')), name: 'Synthetic grid proof', modelMode: 'auto' }) });
  return created.id;
}
async function turn(id: string, kind: string, tag = randomUUID()): Promise<{ capture: Capture; tag: string }> {
  ws.send(JSON.stringify({ v: 1, type: 'session.input', id, data: `Synthetic harmless code fixture GRID:${kind}:${tag}` }));
  await poll(async () => {
    const transcript = await api<{ messages: Array<{ role: string; rawText?: string; strippedText?: string }> }>(`/agent-sessions/${id}/messages?limit=100`);
    return transcript.messages.some(m => m.role === 'output' && (m.strippedText ?? m.rawText ?? '').includes(`SYNTHETICGRID_OK ${tag}`)) ? true : undefined;
  });
  const capture = (await evidence()).captures.find(c => c.turnTag === tag && c.accountLabel !== 'classifier' && c.HTTPstatus === 200);
  if (!capture) throw new Error('GRID_NATIVE_PROVIDER_CAPTURE_MISSING');
  return { capture, tag };
}
async function prove(id: string, capture: Capture, row?: Row) {
  const stored = await snapshot(id);
  const ledger = row ?? (await rows(id)).at(-1)!;
  expect(ledger.applied, 'GRID_REQUIRED_APPLIED_DECISION: baseline provider success is not grid routing proof').toBe(true);
  const provider = capture.accountLabel.startsWith('anthropic-') ? 'anthropic' : 'openai';
  const accountId = provider === 'anthropic' ? stored.anthropicAccountId : stored.openaiAccountId;
  const model = `${provider}/${capture.model}`;
  expect(expectedEfforts.has(model), 'GRID_ADVERTISED_MODEL_REQUIRED').toBe(true);
  const effort = expectedEfforts.get(model)!;
  expect(capture.effort).toBe(effort);
  expect(stored.routerVariant).toBe(effort);
  expect(ledger.detail.effortApplied).toBe(effort);
  expect(ledger.detail.effortRequested).toBe(effortRequests[model]);
  expect(capture).toMatchObject({ model: stored.modelId, effort: stored.routerVariant, accountLabel: accountId.replace('syntheticgrid-', '') });
  expect(ledger.detail).toMatchObject({ model: `${provider}/${capture.model}`, effortApplied: capture.effort, accountId });
  expect(ledger.detail.trace).toContainEqual(expect.objectContaining({ action: 'route', model: `${provider}/${capture.model}`, accountId }));
  expect(stored.providerId).toBe(provider);
  expect(stored.routerDecidedAt).toBeTruthy();
  console.info(JSON.stringify({ modelEffortAccountMatched: true, ledgerTraceMatched: true, accountLabel: capture.accountLabel }));
}

(LIVE ? describe : describe.skip)('SAFE LIVE native grid account proof (preserves all evidence)', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    expect(process.env.HOME).toBe(`${ROOT}/home`); expect(process.env.TMPDIR).toBe(`${ROOT}/tmp`);
    expect(process.env.DB_PATH).toBe(`${ROOT}/rhythm.db`); expect(process.env.RHYTHM_LIVE_URL).toBe(BASE);
    expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe(ENGINE);
    for (const path of [ROOT, process.env.HOME!, process.env.TMPDIR!, process.env.DB_PATH!]) expect(realpathSync(path)).toBe(path);
    expect(readFileSync(`${ROOT}/home/.syntheticgrid-approved`, 'utf8')).toBe('syntheticgrid-local-only-v1\n');
    // These are exclusively synthetic known sandbox paths; never resolve default live HOME or auth.
    for (const provider of ['openai', 'anthropic']) {
      const path = `${ROOT}/home/Library/Application Support/Rhythm/${provider}-accounts.json`;
      expect(realpathSync(path)).toBe(path);
      const store = fixtureJson(path);
      expect(store.version).toBe(1); expect(store.accounts).toHaveLength(2);
      expect(JSON.stringify(store.accounts.map((a: { id: string }) => a.id).sort()) === JSON.stringify([`syntheticgrid-${provider}-a`, `syntheticgrid-${provider}-b`])).toBe(true);
      for (const account of store.accounts) {
        expect([`syntheticgrid-${provider}-a`, `syntheticgrid-${provider}-b`].includes(account.id)).toBe(true);
        expect(account.access === `${account.id}-access` && account.refresh === `${account.id}-refresh` &&
          typeof account.expires === 'number' && Number.isFinite(account.expires) && account.expires > Date.now() &&
          (provider !== 'openai' || account.chatgptAccountId === `${account.id}-workspace`)).toBe(true);
      }
    }
    const authPath = `${ROOT}/home/.local/share/opencode/auth.json`;
    expect(realpathSync(authPath)).toBe(authPath);
    const auth = fixtureJson(authPath);
    // Provisioned cohort declares both synthetic providers; reject missing or extra auth entries.
    expect(JSON.stringify(Object.keys(auth).sort()) === '["anthropic","openai"]').toBe(true);
    for (const [provider, entry] of Object.entries(auth) as Array<[string, Record<string, unknown>]>) {
      // Boolean assertions only: a failed precondition must never render credential values.
      expect(entry !== null && typeof entry === 'object' && ['a', 'b'].some(suffix => {
        const id = `syntheticgrid-${provider}-${suffix}`;
        return entry.type === 'oauth' && entry.access === `${id}-access` && entry.refresh === `${id}-refresh` &&
          typeof entry.expires === 'number' && Number.isFinite(entry.expires) && entry.expires > Date.now() &&
          (provider === 'openai' ? entry.accountId === `${id}-workspace` : entry.accountId === undefined);
      })).toBe(true);
    }
    // Reject overrides: engine and API must use these same stores.
    expect(process.env.RHYTHM_OPENAI_ACCOUNTS_FILE ?? `${ROOT}/home/Library/Application Support/Rhythm/openai-accounts.json`).toBe(`${ROOT}/home/Library/Application Support/Rhythm/openai-accounts.json`);
    expect(process.env.RHYTHM_ACCOUNTS_FILE ?? `${ROOT}/home/Library/Application Support/Rhythm/anthropic-accounts.json`).toBe(`${ROOT}/home/Library/Application Support/Rhythm/anthropic-accounts.json`);
    expect(process.env.RHYTHM_DECISION_ROUTER_FILE ?? `${ROOT}/home/Library/Application Support/Rhythm/decision-router.json`).toBe(`${ROOT}/home/Library/Application Support/Rhythm/decision-router.json`);
    const e = await evidence(); expect(e.guards, 'BLOCKED: manager must initialize BOTH guards before any session').toEqual({ api: true, engine: true });
    const advertised = await request<{ providers: Array<{ id: string; models: Record<string, { variants?: Record<string, unknown> }> }> }>(ENGINE + '/config/providers', { headers: { authorization: '' } });
    for (const [model, requested] of Object.entries(effortRequests)) {
      const [provider, id] = model.split('/');
      const entry = advertised.providers.find(p => p.id === provider)?.models[id];
      expect(entry !== undefined, 'GRID_ADVERTISED_MODEL_REQUIRED').toBe(true);
      const variants = Object.keys(entry!.variants ?? {});
      expect(variants.every(v => effortOrder.includes(v)), 'GRID_UNKNOWN_ADVERTISED_EFFORT').toBe(true);
      const ordered = effortOrder.filter(v => variants.includes(v));
      // Nearest advertised effort at/below the request; otherwise lowest; no variants => null.
      expectedEfforts.set(model, ordered.filter(v => effortOrder.indexOf(v) <= effortOrder.indexOf(requested)).at(-1) ?? ordered[0] ?? null);
    }
    const catalog = await api<{ catalog: { models: Array<{ providerID: string; modelID: string; enabled?: boolean }> } }>('/agent-decisions/config');
    for (const model of ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra']) expect(catalog.catalog.models.some(m => m.providerID === 'openai' && m.modelID === model)).toBe(true);
    for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5']) expect(catalog.catalog.models.some(m => m.providerID === 'anthropic' && m.modelID === model && m.enabled !== false), 'BLOCKED: manager must reload native Anthropic plugin and local catalog').toBe(true);
    const wanted = new Set(['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra']);
    const hidden = catalog.catalog.models.filter(m => m.providerID === 'openai' && wanted.has(m.modelID) && m.enabled === false);
    if (hidden.length) await api('/agent-models/visibility', { method: 'PATCH', body: JSON.stringify({ updates: hidden.map(m => ({ provider: m.providerID, modelId: m.modelID, visible: true })) }) });
    excludedModels = catalog.catalog.models.filter(m => m.providerID !== 'openai' || !wanted.has(m.modelID)).map(m => `${m.providerID}/${m.modelID}`);
    await configure();
    ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket('ws://127.0.0.1:4398/ws/agents', { origin: 'rhythm://app', headers });
      socket.once('open', () => resolve(socket)); socket.once('error', () => reject(new Error('GRID_WS_REFUSED')));
    });
    fixtureReady = true;
  }, 60000);
  const resetCase = () => resetGridCaseState(control, () => configure(), () => api('/agents/usage-budget?force=true'));
  beforeEach(async () => {
    expect(fixtureReady, 'BLOCKED: isolation/auth/provenance setup must succeed before controls change').toBe(true);
    await resetCase();
  }, 60000);
  afterEach(async () => {
    // Runs on failed assertions too. Never erase captures, ledger, stores, or cooldowns.
    if (fixtureReady) await resetCase();
  }, 60000);
  afterAll(() => { ws?.close(); }); // close only our client; never stop servers or remove evidence

  it('explicit pin MUST survive an actual native provider 429 (not manual intake)', async () => {
    await configure();
    await control({ fail429: [], usage: { 'openai-a': { five: 0, week: 0 }, 'openai-b': { five: 60, week: 60 } } });
    await freshOpenAIUsage(1, 0.4);
    const id = await session();
    await api(`/agent-sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ openaiAccountId: 'syntheticgrid-openai-b' }) });
    const first = await turn(id, 'tier4'); expect(first.capture.accountLabel).toBe('openai-b'); await prove(id, first.capture);
    expect((await rows(id))[0].detail.accountSource).toBe('pinned');
    await control({ fail429: ['openai-b'], usage: { 'openai-b': { five: 100, week: 100 } } });
    await freshOpenAIUsage(1, 0);
    const tag = randomUUID();
    try { await turn(id, 'followup', tag); }
    catch (error) { if (!(error instanceof Error) || error.message !== 'GRID_OBSERVABLE_OUTCOME_TIMEOUT') throw error; }
    // A still-running retry is UNVERIFIED, never evidence that the pin survived.
    await poll(async () => ['idle', 'error'].includes((await snapshot(id)).status) ? true : undefined);
    const attempts = (await evidence()).captures.filter(c => c.turnTag === tag && c.accountLabel !== 'classifier');
    expect(attempts).toContainEqual(expect.objectContaining({ accountLabel: 'openai-b', HTTPstatus: 429 }));
    expect(attempts.every(c => c.accountLabel === 'openai-b'), 'DEFECT: native OAuth 429 fallback switched an explicitly pinned account').toBe(true);
    expect((await snapshot(id)).openaiAccountId).toBe('syntheticgrid-openai-b');
    expect(await rows(id)).toHaveLength(1);
    expect((await evidence()).captures.filter(c => c.accountLabel === 'classifier' && [first.tag, tag].includes(c.turnTag))).toHaveLength(1);
  }, 240000);
  it.each([['tier4', 'gpt-6-luna'], ['tier3', 'gpt-6-sol'], ['tier2', 'gpt-6.1-sol'], ['tier1', 'gpt-6-astra']])('native %s model/effort/account and follow-up; capacity cannot interfere', async (kind, model) => {
    const effort = expectedEfforts.get(`openai/${model}`)!;
    await control({ usage: { 'openai-a': { five: 40, week: 50 }, 'openai-b': { five: 5, week: 10 } } });
    await api('/agents/usage-budget?force=true');
    const id = await session(); const first = await turn(id, kind);
    expect(first.capture).toMatchObject({ model, effort, accountLabel: 'openai-b' }); await prove(id, first.capture);
    const follow = await turn(id, 'followup');
    expect(follow.capture).toMatchObject({ model, effort, accountLabel: first.capture.accountLabel, HTTPstatus: 200 });
    await prove(id, follow.capture); expect(await rows(id)).toHaveLength(1);
    expect((await evidence()).captures.filter(c => c.accountLabel === 'classifier' && [first.tag, follow.tag].includes(c.turnTag))).toHaveLength(1);
  }, 180000);
  it('explicit lower-quota account pin is respected on the first classified turn', async () => {
    await control({ usage: { 'openai-a': { five: 60, week: 60 }, 'openai-b': { five: 0, week: 0 } } });
    await api('/agents/usage-budget?force=true');
    const id = await session();
    await api(`/agent-sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ openaiAccountId: 'syntheticgrid-openai-a' }) });
    const first = await turn(id, 'tier4'); expect(first.capture.accountLabel).toBe('openai-a'); await prove(id, first.capture);
    expect((await rows(id))[0].detail.accountSource).toBe('pinned');
  }, 180000);

  it('malformed classifier uses rules default and provider-observable Sol/advertised effort', async () => {
    const id = await session(); const first = await turn(id, 'malformed');
    expect(first.capture).toMatchObject({ model: 'gpt-6.1-sol', effort: expectedEfforts.get('openai/gpt-6.1-sol') });
    expect((await rows(id))[0].detail).toMatchObject({ classifierSource: 'rules', tier: 2 }); await prove(id, first.capture);
  }, 180000);
  it('unknown quota remains eligible, not invented exhaustion', async () => {
    await control({ unknown: true }); await api('/agents/usage-budget?force=true');
    const id = await session(); const first = await turn(id, 'unknown'); await prove(id, first.capture);
    expect((await rows(id))[0].applied).toBe(true);
  }, 180000);
  it('no usable catalog route preserves baseline; security never enables OpenRouter', async () => {
    await configure(true);
    const id = await session(); await turn(id, 'security'); const [row] = await rows(id);
    expect(row.applied).toBe(false); expect(row.detail.reason).toBe('no_usable_route');
    expect(row.detail.securitySensitive).toBe(true);
    expect(row.detail.trace).toContainEqual(expect.objectContaining({ reason: 'openrouter_unusable' }));
    expect((await snapshot(id)).routerDecidedAt).toBeNull();
  }, 180000);
  it('known zero account headroom produces exhausted skips and no usable account/route', async () => {
    await control({ usage: { 'openai-a': { five: 100, week: 100 }, 'openai-b': { five: 100, week: 100 } } });
    await api('/agents/usage-budget?force=true');
    await configure();
    // Keep tier4 Luna available, hide step-up models so tier1 reserve exemption cannot hide the no-capacity case.
    await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({ excludedModels: [...excludedModels, 'openai/gpt-6-sol', 'openai/gpt-6.1-sol', 'openai/gpt-6-astra'] }) });
    const id = await session(); await turn(id, 'nocapacity'); const [row] = await rows(id);
    expect(row.applied).toBe(false); expect(row.detail.reason).toBe('no_usable_route');
    for (const suffix of ['a', 'b']) expect(row.detail.trace).toContainEqual(expect.objectContaining({ action: 'skip_account', accountId: `syntheticgrid-openai-${suffix}`, reason: 'exhausted' }));
    expect(row.detail.trace).toContainEqual(expect.objectContaining({ action: 'skip_account', model: 'openai/gpt-6-luna', reason: 'no_eligible_account' }));
  }, 180000);
  it('429 retry is native; known exhaustion reroutes next turn without reclassification', async () => {
    await control({ usage: { 'openai-a': { five: 5, week: 5 }, 'openai-b': { five: 60, week: 60 } } });
    await freshOpenAIUsage(0.95, 0.4);
    const id = await session(); const first = await turn(id, 'tier4');
    expect(first.capture).toMatchObject({ model: 'gpt-6-luna', effort: expectedEfforts.get('openai/gpt-6-luna'), accountLabel: 'openai-a', HTTPstatus: 200 });
    await prove(id, first.capture); // Require actual APPLIED grid decision before inducing native429.
    // Native Codex reports have no HTTP status; repair requires positive fresh exhausted quota.
    await control({ fail429: ['openai-a'], usage: { 'openai-a': { five: 100, week: 100 } } });
    await freshOpenAIUsage(0, 0.4);
    const retry = await turn(id, 'followup');
    const attempts = (await evidence()).captures.filter(c => c.turnTag === retry.tag && c.accountLabel !== 'classifier');
    expect(attempts).toEqual(expect.arrayContaining([expect.objectContaining({ accountLabel: 'openai-a', HTTPstatus: 429 }), expect.objectContaining({ accountLabel: 'openai-b', HTTPstatus: 200 })]));
    // Wait for native fire-and-forget exhaustion intake to reach durable local store.
    await poll(async () => {
      let entries;
      try { entries = JSON.parse(readFileSync(`${ROOT}/home/Library/Application Support/Rhythm/router-grid-exhaustion.json`, 'utf8')); } catch { return undefined; }
      return entries.some((e: { provider: string; accountId: string; exhaustedUntil: number }) =>
        e.provider === 'openai' && e.accountId === 'syntheticgrid-openai-a' && Number.isFinite(e.exhaustedUntil) && e.exhaustedUntil > Date.now()) ? true : undefined;
    });
    const next = await turn(id, 'followup'); expect(next.capture.accountLabel).toBe('openai-b'); await prove(id, next.capture);
    const ledger = await rows(id); expect(ledger).toHaveLength(2); expect(ledger[1].detail.reason).toBe('account_exhausted');
    expect(ledger[1].detail.tier).toBe(ledger[0].detail.tier); expect(ledger[1].detail.category).toBe(ledger[0].detail.category);
    expect((await evidence()).captures.filter(c => c.accountLabel === 'classifier' && [first.tag, retry.tag, next.tag].includes(c.turnTag))).toHaveLength(1);
  }, 240000);
  it('same-id PATCH pins automatic account even when known exhaustion would force re-selection', async () => {
    // B wins on fresh healthy usage, independent of preceding native429/cooldown state.
    await control({ fail429: [], usage: { 'openai-a': { five: 60, week: 60 }, 'openai-b': { five: 0, week: 0 } } });
    await api('/agents/usage-budget?force=true');
    const id = await session(); const first = await turn(id, 'tier4'); await prove(id, first.capture);
    const stored = await snapshot(id); const pinned = stored.openaiAccountId;
    expect(pinned).toBe('syntheticgrid-openai-b');
    await api(`/agent-sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ openaiAccountId: pinned }) });
    // Real HTTP intake, explicit status429; not a mocked chooser or direct exhaustion-file edit.
    await api('/opencode/spillover', { method: 'POST', body: JSON.stringify({ sdkSessionId: stored.sdkSessionId,
      providerID: 'openai', fromAccountId: pinned, toAccountId: 'syntheticgrid-openai-a', status: 429, retryAfter: 3600 }) });
    const next = await turn(id, 'followup'); expect(next.capture.accountLabel).toBe('openai-b'); await prove(id, next.capture);
    expect(await rows(id)).toHaveLength(1);
    expect((await evidence()).captures.filter(c => c.accountLabel === 'classifier' && [first.tag, next.tag].includes(c.turnTag))).toHaveLength(1);
  }, 180000);
  it('both OpenAI accounts positively exhausted -> native Sonnet/high on highest Anthropic headroom; follow-up persists without reclassification', async () => {
    await control({ fail429: [], unknown: false, usage: {
      'openai-a': { five: 100, week: 100 }, 'openai-b': { five: 100, week: 100 },
      'anthropic-a': { five: 60, week: 60 }, 'anthropic-b': { five: 5, week: 10 },
    } });
    await api('/agents/usage-budget?force=true'); await configure(false, true);
    const id = await session(); const first = await turn(id, 'tier2');
    expect(first.capture).toMatchObject({ model: 'claude-sonnet-5-5', effort: expectedEfforts.get('anthropic/claude-sonnet-5-5'), accountLabel: 'anthropic-b', HTTPstatus: 200 });
    await prove(id, first.capture);
    const [row] = await rows(id); expect(row.detail.tier).toBe(2);
    expect(row.detail.trace).toContainEqual(expect.objectContaining({ action: 'skip_account', model: 'openai/gpt-6.1-sol', reason: 'no_eligible_account' }));
    for (const suffix of ['a', 'b']) expect(row.detail.trace).toContainEqual(expect.objectContaining({ action: 'skip_account', tier: 2, accountId: `syntheticgrid-openai-${suffix}`, reason: 'exhausted' }));
    const follow = await turn(id, 'followup');
    expect(follow.capture).toMatchObject({ model: first.capture.model, effort: first.capture.effort, accountLabel: first.capture.accountLabel });
    await prove(id, follow.capture); expect(await rows(id)).toHaveLength(1);
    expect((await evidence()).captures.filter(c => c.accountLabel === 'classifier' && [first.tag, follow.tag].includes(c.turnTag))).toHaveLength(1);
  }, 180000);
});
