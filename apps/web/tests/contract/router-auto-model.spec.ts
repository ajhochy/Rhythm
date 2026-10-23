import { expect, test, type Page, type Route } from '@playwright/test';

// Own intercepted live-gateway webServer (router-auto-model-playwright.config.ts) — same
// convention as issue-1580-model-curation.spec.ts.
test.skip(process.env.RHYTHM_ROUTER_AUTO_CONTRACT !== '1', 'Run with the router-auto-model live-gateway Playwright config');

type Body = Record<string, any>;
type State = {
  session: Body; patches: Body[]; frames: Body[]; provenance: Body; routerConfig: Body; routerPuts: Body[]; routerTests: Body[];
  putError: { status: number; message: string } | null; testFails: boolean; visibilityPatches: Body[];
};

const catalog = [
  { provider: 'openai', modelId: 'gpt-6', displayName: 'GPT-6', authorized: true, available: true, visible: true },
  { provider: 'anthropic', modelId: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', authorized: true, available: true, visible: true },
];

type Tier = 'cheap' | 'standard' | 'frontier';
type TierBody = { mode?: 'auto' | 'manual'; cheapMaxOutputUsd: number; frontierMinOutputUsd: number; derivedFromModels?: number };
const CATALOG_THRESHOLDS: TierBody = { mode: 'auto', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25, derivedFromModels: 12 };
// Newest first, as the server returns it. qwen3 carries a saved override; haiku is excluded.
const catalogSeed: Body[] = [
  { providerID: 'openai', modelID: 'gpt-6', name: 'GPT-6', family: 'gpt', costOutputUsd: 40, costInputUsd: 10, releaseDate: '2026-08-01', contextLimit: 1000000, excluded: false },
  { providerID: 'anthropic', modelID: 'claude-opus-5', name: 'Claude Opus 5', family: 'claude', costOutputUsd: 75, costInputUsd: 15, releaseDate: '2026-07-10', contextLimit: 200000, excluded: false },
  { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', family: 'claude', costOutputUsd: 15, costInputUsd: 3, releaseDate: '2026-05-01', contextLimit: 200000, excluded: false },
  { providerID: 'openai', modelID: 'gpt-6-mini', name: 'GPT-6 Mini', family: 'gpt', costOutputUsd: 2, costInputUsd: 0.4, releaseDate: '2026-08-01', contextLimit: 400000, excluded: false },
  { providerID: 'google', modelID: 'gemini-3-flash', name: 'Gemini 3 Flash', family: 'gemini', costOutputUsd: null, costInputUsd: null, releaseDate: '2026-06-15', contextLimit: 1048576, excluded: false },
  { providerID: 'ollama', modelID: 'qwen3', name: 'Qwen3 (local)', family: 'qwen', costOutputUsd: 0, costInputUsd: 0, releaseDate: null, contextLimit: 32768, excluded: false },
  { providerID: 'anthropic', modelID: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', family: 'claude', costOutputUsd: 5, costInputUsd: 1, releaseDate: '2025-10-01', contextLimit: 200000, excluded: true },
];
const buildCatalog = (overrides: Record<string, Tier>, excluded: string[], thresholds: TierBody = CATALOG_THRESHOLDS): Body => ({
  fetchedAt: '2026-09-29T12:00:00.000Z',
  tiers: thresholds,
  models: catalogSeed.map((model) => {
    const key = `${model.providerID}/${model.modelID}`;
    const cost = model.costOutputUsd as number | null;
    const derived: Tier = cost === null ? 'cheap' : cost <= thresholds.cheapMaxOutputUsd ? 'cheap' : cost >= thresholds.frontierMinOutputUsd ? 'frontier' : 'standard';
    const override = overrides[key];
    return { ...model, excluded: excluded.includes(key), tier: override ?? derived, tierSource: override ? 'override' : cost === null ? 'heuristic' : 'cost' };
  }),
});

const baseRouterConfig = (): Body => ({
  backend: 'local',
  local: { baseUrl: 'http://127.0.0.1:8012', model: 'reranker-small', scoreScale: 'auto' },
  jev: { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', hasApiKey: false },
  custom: { baseUrl: '', model: '', scoreScale: 'auto', hasApiKey: false },
  systemone: { baseUrl: 'http://127.0.0.1:8009', model: 'kev-latest', hasApiKey: false },
  openaiDecisions: { baseUrl: 'https://api.openai.com', model: 'gpt-6-luna', hasApiKey: false },
  timeoutMs: 1500, remoteDataConsent: false,
  features: { model_routing: 'default', tool_ranking: 'default', memory_ranking: 'off', capacity_routing: 'default' },
  lockedByEnv: ['tool_ranking'],
  effective: { backend: 'local', baseUrl: 'http://127.0.0.1:8012', model: 'reranker-small', features: {} },
  catalog: buildCatalog({ 'ollama/qwen3': 'standard' }, ['anthropic/claude-haiku-4-5']),
});

async function setup(page: Page, opts: { modelMode?: 'auto' | 'fixed' | undefined; catalog?: 'live' | 'missing' | 'empty' | 'partial' | 'none-curated' } = {}): Promise<State> {
  const modelMode = 'modelMode' in opts ? opts.modelMode : 'auto';
  const state: State = {
    session: { id: 's1', name: 'Router session', profileId: 'p1', cwd: '/tmp/x', providerId: 'openai', modelId: 'gpt-6', status: 'idle', createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z', ...(modelMode ? { modelMode } : {}) },
    patches: [], frames: [], routerPuts: [], routerTests: [], putError: null, testFails: false, visibilityPatches: [],
    provenance: { available: true, requestedModelId: 'gpt-6', servedModels: [], multiModel: false, routed: true, steps: { unattributed: 0 }, dispatches: [{ requestedSource: 'auto', finalProviderId: 'anthropic', finalModelId: 'claude-sonnet-4-6' }] },
    routerConfig: baseRouterConfig(),
  };
  if (opts.catalog === 'missing') delete state.routerConfig.catalog;
  const markDisabled = (keys: string[], reason?: 'no_curated_models') => {
    const cat = state.routerConfig.catalog;
    cat.models = cat.models.map((m: Body) => ({ ...m, enabled: !keys.includes(`${m.providerID}/${m.modelID}`) }));
    cat.curatedCount = cat.models.filter((m: Body) => m.enabled).length;
    if (reason) cat.reason = reason;
  };
  if (opts.catalog === 'partial') markDisabled(['ollama/qwen3', 'anthropic/claude-haiku-4-5']);
  if (opts.catalog === 'none-curated') markDisabled(catalogSeed.map((m) => `${m.providerID}/${m.modelID}`), 'no_curated_models');
  if (opts.catalog === 'empty') state.routerConfig.catalog = { fetchedAt: null, models: [], tiers: CATALOG_THRESHOLDS };
  const cors = (origin: string | undefined) => ({ 'access-control-allow-origin': origin ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' });
  await page.route('https://api.vcrcapps.com/**', (route) => route.fulfill({ status: 200, headers: cors(route.request().headers().origin), json: [] }));
  await page.route('http://127.0.0.1:7562/**', (route) => route.fulfill({ status: 200, json: { healthy: true, status: 'ready' } }));
  await page.routeWebSocket(/\/ws\/agents$/, (ws) => {
    ws.onMessage((data) => {
      const frame = JSON.parse(String(data));
      if (frame.type === 'session.input') { state.frames.push(frame); ws.send(JSON.stringify({ type: 'session.status', id: frame.id, working: true })); ws.send(JSON.stringify({ type: 'session.status', id: frame.id, working: false })); }
    });
  });
  await page.route('http://127.0.0.1:7561/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = cors(request.headers()['origin']);
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body as any });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = url.pathname;
    if (path === '/health') return json({ healthy: true, status: 'ready' });
    if (path === '/agent-configs') return json([{ id: 'p1', label: 'Default agent', icon: 'DA', enabled: true, isAgent: true, sessionSelectable: true, isDefault: true, allowedMcpsJson: '{}', allowedSkillsJson: '[]', corePermissionsJson: '{}', allowedDelegatesJson: '[]' }]);
    if (path === '/agent-sessions' && request.method() === 'GET') return json({ sessions: [state.session], pageInfo: { nextCursor: null, hasMore: false } });
    if (path === '/agent-sessions/s1/model-provenance') return json(state.provenance);
    if (path === '/agent-sessions/s1' && request.method() === 'PATCH') {
      const patch = request.postDataJSON() as Body; state.patches.push(patch);
      Object.assign(state.session, patch);
      return json({ session: state.session });
    }
    if (path === '/agent-sessions/s1') return json({ session: state.session, messages: [] });
    if (path === '/agents/models/catalog') return json(catalog);
    if (path === '/agents/models/catalog/full') return json(catalog);
    if (path === '/agent-decisions/config' && request.method() === 'GET') return json(state.routerConfig);
    if (path === '/agent-decisions/config' && request.method() === 'PUT') {
      const body = request.postDataJSON() as Body; state.routerPuts.push(body);
      if (state.putError) return json({ error: 'consent_required', message: state.putError.message }, state.putError.status);
      const next = state.routerConfig;
      next.backend = body.backend ?? next.backend;
      for (const key of ['local', 'jev', 'custom', 'systemone', 'openaiDecisions']) if (body[key]) { const { apiKey, ...rest } = body[key]; Object.assign(next[key], rest); if (apiKey !== undefined) next[key].hasApiKey = apiKey !== ''; }
      if (body.remoteDataConsent !== undefined) next.remoteDataConsent = body.remoteDataConsent;
      if (body.features) Object.assign(next.features, body.features);
      if (next.catalog && next.catalog.models.length && (body.tiers || body.tierOverrides || body.excludedModels)) {
        // Partial merge, like the real server: absent fields keep their saved value.
        const cur = next.catalog;
        const curOverrides = Object.fromEntries(cur.models.filter((m: Body) => m.tierSource === 'override').map((m: Body) => [`${m.providerID}/${m.modelID}`, m.tier]));
        const curExcluded = cur.models.filter((m: Body) => m.excluded).map((m: Body) => `${m.providerID}/${m.modelID}`);
        const enabled = new Map(cur.models.map((m: Body) => [`${m.providerID}/${m.modelID}`, m.enabled]));
        const tiersBody = body.tiers ?? cur.tiers;
        next.catalog = buildCatalog(body.tierOverrides ?? curOverrides, body.excludedModels ?? curExcluded, tiersBody?.mode === 'manual' ? { mode: 'manual', cheapMaxOutputUsd: tiersBody.cheapMaxOutputUsd, frontierMinOutputUsd: tiersBody.frontierMinOutputUsd, derivedFromModels: 12 } : body.tiers?.mode === 'auto' ? CATALOG_THRESHOLDS : next.catalog.tiers);
        next.catalog.models = next.catalog.models.map((m: Body) => ({ ...m, ...(enabled.get(`${m.providerID}/${m.modelID}`) === undefined ? {} : { enabled: enabled.get(`${m.providerID}/${m.modelID}`) }) }));
        if (cur.curatedCount !== undefined) next.catalog.curatedCount = cur.curatedCount;
        if (cur.reason) next.catalog.reason = cur.reason;
      }
      return json(next);
    }
    if (path === '/agent-models/visibility' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as Body; state.visibilityPatches.push(body);
      const updates: Body[] = Array.isArray(body) ? body : body.updates ?? [body];
      const cat = state.routerConfig.catalog;
      for (const u of updates) for (const m of cat?.models ?? []) if (m.providerID === u.provider && m.modelID === u.modelId) m.enabled = u.visible;
      if (cat) { cat.curatedCount = cat.models.filter((m: Body) => m.enabled !== false).length; if (cat.curatedCount) delete cat.reason; }
      return json({ ok: true });
    }
    if (path === '/agent-decisions/config/test') {
      state.routerTests.push(request.postDataJSON() as Body);
      if (state.testFails) return json({ ok: false, message: 'connection refused' });
      if ((request.postDataJSON() as Body).backend === 'openai_decisions') {
        return json({ ok: true, backend: 'openai_decisions', model: 'gpt-6-luna', latencyMs: 330, tier: 'standard', score: 0.6, probabilities: { cheap: 0.2, standard: 0.6, frontier: 0.2 } });
      }
      if ((request.postDataJSON() as Body).backend === 'systemone') {
        return json({ ok: true, backend: 'systemone', model: 'kev-4b', latencyMs: 345, tier: 'cheap', probabilities: { cheap: 0.9, standard: 0.08, frontier: 0.02 }, ranked: [{ text: 'cheap', score: 0.9 }, { text: 'standard', score: 0.08 }, { text: 'frontier', score: 0.02 }] });
      }
      return json({ ok: true, backend: 'local', model: 'reranker-small', latencyMs: 42, ranked: [{ text: 'Refactor the parser', score: 0.91 }, { text: 'Order lunch', score: 0.07 }] });
    }
    return json([]);
  });
  return state;
}

async function openComposer(page: Page) {
  await page.goto('/#/agents');
  await expect(page.getByTestId('composer-model')).toBeEnabled();
  await expect(page.getByTestId('composer-model').locator('option').first()).toHaveText('Auto (router)');
}

test('router:A1 Auto is the first option and selected for an auto session; router pick is shown', async ({ page }) => {
  await setup(page);
  await openComposer(page);
  await expect(page.getByTestId('composer-model')).toHaveValue('__auto__');
  await expect(page.getByTestId('composer-router-pick')).toHaveText('Auto → claude-sonnet-4-6');
});

test('router:A2 a session without modelMode (old server) is treated as fixed', async ({ page }) => {
  await setup(page, { modelMode: undefined });
  await openComposer(page);
  await expect(page.getByTestId('composer-model')).toHaveValue('openai/gpt-6');
  await expect(page.getByTestId('composer-router-pick')).toHaveCount(0);
});

test('router:A3 choosing a model as session default PATCHes fixed; choosing Auto PATCHes auto', async ({ page }) => {
  const state = await setup(page);
  await openComposer(page);
  await page.getByTestId('composer-model').selectOption('anthropic/claude-sonnet-4-6');
  await page.getByTestId('model-session-default').click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ modelMode: 'fixed', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' });
  await expect(page.getByTestId('composer-model')).toHaveValue('anthropic/claude-sonnet-4-6');
  await expect(page.getByTestId('composer-router-pick')).toHaveCount(0);

  await page.getByTestId('composer-model').selectOption('__auto__');
  await expect(page.getByTestId('model-this-turn')).toHaveCount(0);
  await page.getByTestId('model-session-default').click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1]).toEqual({ modelMode: 'auto' });
  await expect(page.getByTestId('composer-model')).toHaveValue('__auto__');
});

test('router:A4 an auto turn sends no modelOverride; a staged turn-only model is sent once', async ({ page }) => {
  const state = await setup(page);
  await openComposer(page);
  await page.locator('#composer-input').fill('first');
  await page.locator('#composer-input').press('Enter');
  await expect.poll(() => state.frames.length).toBe(1);
  expect(state.frames[0].modelOverride).toBeUndefined();

  await page.getByTestId('composer-model').selectOption('openai/gpt-6');
  await page.getByTestId('model-this-turn').click();
  await expect(page.getByTestId('composer-model')).toHaveValue('openai/gpt-6');
  await page.locator('#composer-input').fill('second');
  await page.locator('#composer-input').press('Enter');
  await expect.poll(() => state.frames.length).toBe(2);
  expect(state.frames[1].modelOverride).toEqual({ providerId: 'openai', modelId: 'gpt-6' });
  expect(state.patches).toHaveLength(0);

  await page.locator('#composer-input').fill('third');
  await page.locator('#composer-input').press('Enter');
  await expect.poll(() => state.frames.length).toBe(3);
  expect(state.frames[2].modelOverride).toBeUndefined();
});

test('router:A5 a fixed session still sends its stored model', async ({ page }) => {
  const state = await setup(page, { modelMode: 'fixed' });
  await openComposer(page);
  await page.locator('#composer-input').fill('pinned');
  await page.locator('#composer-input').press('Enter');
  await expect.poll(() => state.frames.length).toBe(1);
  expect(state.frames[0].modelOverride).toEqual({ providerId: 'openai', modelId: 'gpt-6' });
});

async function openRouterSettings(page: Page) {
  await page.goto('/#/tools/agent-settings?settingsSection=model-routing&settingsItem=backend');
  await expect(page.getByTestId('router-settings')).toBeVisible();
  await expect(page.getByTestId('router-local-url')).toHaveValue('http://127.0.0.1:8012');
}

test('router:B1 settings load, locked fields are read-only, backend switch shows per-backend fields', async ({ page }) => {
  await setup(page);
  await openRouterSettings(page);
  await expect(page.getByTestId('router-backend-local')).toBeChecked();
  await expect(page.getByTestId('router-feature-tool_ranking')).toBeDisabled();
  await expect(page.getByTestId('router-settings').getByText('set by environment').first()).toBeVisible();
  await expect(page.getByTestId('router-feature-memory_ranking')).toHaveValue('off');
  await page.getByTestId('router-backend-jev').check();
  await expect(page.getByTestId('router-jev-key')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('router-jev-model')).toHaveValue('jev-latest');
  await expect(page.getByTestId('router-local-url')).toHaveCount(0);
  await page.getByTestId('router-backend-custom').check();
  await expect(page.getByTestId('router-custom-url')).toHaveAttribute('placeholder', 'http://192.168.1.20:8012');
});

test('router:B2 remote backends need consent before Save; server 400 message is surfaced', async ({ page }) => {
  const state = await setup(page);
  await openRouterSettings(page);
  await expect(page.getByTestId('router-consent')).toHaveCount(0);
  await expect(page.getByTestId('router-save')).toBeEnabled();
  await page.getByTestId('router-backend-jev').check();
  await expect(page.getByTestId('router-save')).toBeDisabled();
  await page.getByTestId('router-jev-key').fill('sk-typed');
  await page.getByTestId('router-consent').check();
  await expect(page.getByTestId('router-save')).toBeEnabled();
  state.putError = { status: 400, message: 'Remote data consent is required.' };
  await page.getByTestId('router-save').click();
  await expect(page.getByTestId('router-save-error')).toHaveText('Remote data consent is required.');
});

test('router:B3 test connection posts the unsaved draft and renders latency, model and ranking; errors render inline', async ({ page }) => {
  const state = await setup(page);
  await openRouterSettings(page);
  await page.getByTestId('router-local-model').fill('draft-model');
  await page.getByTestId('router-test').click();
  const result = page.getByTestId('router-test-result');
  await expect(result).toContainText('Connected');
  await expect(result).toContainText('42 ms');
  await expect(result).toContainText('Refactor the parser');
  await expect(result).toContainText('0.910');
  expect(state.routerTests[0].local.model).toBe('draft-model');
  expect(state.routerTests[0].backend).toBe('local');
  state.testFails = true;
  await page.getByTestId('router-test').click();
  await expect(page.getByTestId('router-test-result')).toContainText('connection refused');
});

test('router:B4 save PUTs only what changed for secrets: apiKey only when typed; read-back shows Key saved; clear sends empty', async ({ page }) => {
  const state = await setup(page);
  await openRouterSettings(page);
  await page.getByTestId('router-feature-model_routing').selectOption('shadow');
  await page.getByTestId('router-save').click();
  await expect(page.getByTestId('router-notice')).toHaveText('Router settings saved');
  expect(state.routerPuts[0].features).toEqual({ model_routing: 'shadow', memory_ranking: 'off', capacity_routing: 'default' });
  expect(state.routerPuts[0].features.tool_ranking).toBeUndefined();
  expect(state.routerPuts[0].jev).not.toHaveProperty('apiKey');
  expect(state.routerPuts[0].custom).not.toHaveProperty('apiKey');

  await page.getByTestId('router-backend-jev').check();
  await page.getByTestId('router-jev-key').fill('sk-typed');
  await page.getByTestId('router-consent').check();
  await page.getByTestId('router-save').click();
  await expect(page.getByTestId('router-jev-key-saved')).toHaveText('Key saved');
  expect(state.routerPuts[1]).toMatchObject({ backend: 'jev', remoteDataConsent: true, jev: { apiKey: 'sk-typed', model: 'jev-latest' } });
  await expect(page.getByTestId('router-jev-key')).toHaveValue('');

  await page.getByTestId('router-timeout').fill('2500');
  await page.getByTestId('router-save').click();
  await expect(page.getByTestId('router-notice')).toBeVisible();
  expect(state.routerPuts[2].jev).not.toHaveProperty('apiKey');
  expect(state.routerPuts[2].timeoutMs).toBe(2500);

  await page.getByTestId('router-jev-key-clear').click();
  await page.getByTestId('router-save').click();
  await expect.poll(() => state.routerPuts.length).toBe(4);
  expect(state.routerPuts[3].jev.apiKey).toBe('');
  await expect(page.getByTestId('router-jev-key-saved')).toHaveCount(0);
});

const HAIKU = 'anthropic/claude-haiku-4-5';
const QWEN = 'ollama/qwen3';
const FLASH = 'google/gemini-3-flash';
const MINI = 'openai/gpt-6-mini';
const SONNET = 'anthropic/claude-sonnet-4-6';
const GPT6 = 'openai/gpt-6';
const row = (page: Page, key: string) => page.getByTestId(`router-model-row-${key}`);
const modelNames = (page: Page) => page.getByTestId('settings-column-models').locator('[role="option"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

async function openRouting(page: Page, group = 'all') {
  await page.goto(`/#/tools/agent-settings?settingsSection=model-routing&settingsItem=${encodeURIComponent(group)}`);
  await expect(page.getByTestId('settings-column-items')).toBeVisible();
}

test('router:C1 sections → groups → models → inspector; groups carry counts; the inspector shows tier source, prices, dates, context and exclusion', async ({ page }) => {
  await setup(page);
  await openRouting(page, 'tier:frontier');
  await expect(page.getByTestId('router-group-tier-frontier')).toContainText('2');
  await expect(page.getByTestId('router-group-tier-cheap')).toContainText('3');
  await expect(page.getByTestId('router-group-provider-anthropic')).toContainText('3');
  await expect(page.getByTestId('router-group-excluded')).toContainText('1');
  expect(await modelNames(page)).toEqual(['Claude Opus 5', 'GPT-6']);

  await row(page, GPT6).click();
  const inspector = page.getByTestId(`router-model-inspector-${GPT6}`);
  await expect(inspector).toContainText('openai/gpt-6');
  await expect(inspector).toContainText('$40/M');
  await expect(inspector).toContainText('$10/M');
  await expect(inspector).toContainText('2026-08-01');
  await expect(inspector).toContainText('1M');
  await expect(page.getByTestId(`router-model-source-${GPT6}`)).toHaveText('cost');
  await expect(page.getByTestId(`router-model-reset-${GPT6}`)).toHaveCount(0);
  await expect(page.getByTestId(`router-model-status-${GPT6}`)).toHaveText('Routable');

  await openRouting(page, 'all');
  await row(page, QWEN).click();
  await expect(page.getByTestId(`router-model-source-${QWEN}`)).toHaveText('override');
  await expect(page.getByTestId(`router-model-tier-${QWEN}`)).toHaveValue('standard');
  await expect(page.getByTestId(`router-model-reset-${QWEN}`)).toBeVisible();
  await row(page, HAIKU).click();
  await expect(page.getByRole('switch', { name: 'Exclude Claude Haiku 4.5' })).toBeChecked();
  await expect(page.getByTestId(`router-model-status-${HAIKU}`)).toHaveText('Excluded from routing');
  const box = await page.getByTestId(`router-model-tier-${HAIKU}`).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});

test('router:C2 model list is searchable and sortable', async ({ page }) => {
  await setup(page);
  await openRouting(page, 'all');
  expect(await modelNames(page)).toEqual(['Claude Haiku 4.5', 'Claude Opus 5', 'Claude Sonnet 4.6', 'Gemini 3 Flash', 'GPT-6', 'GPT-6 Mini', 'Qwen3 (local)']);
  await page.getByTestId('router-model-sort').selectOption('price-desc');
  expect(await modelNames(page)).toEqual(['Claude Opus 5', 'GPT-6', 'Claude Sonnet 4.6', 'Claude Haiku 4.5', 'GPT-6 Mini', 'Qwen3 (local)', 'Gemini 3 Flash']);
  await page.getByTestId('router-model-sort').selectOption('newest');
  expect((await modelNames(page)).slice(0, 2)).toEqual(['GPT-6', 'GPT-6 Mini']);
  await page.getByTestId('router-model-search').fill('claude');
  expect(await modelNames(page)).toEqual(['Claude Opus 5', 'Claude Sonnet 4.6', 'Claude Haiku 4.5']);
  await page.getByTestId('router-model-search').fill('ollama');
  expect(await modelNames(page)).toEqual(['Qwen3 (local)']);
  await page.getByTestId('router-model-search').fill('nothing-matches');
  await expect(page.getByTestId('settings-column-models')).toContainText('No matching models.');
});

test('router:C3 tier, reset and exclude save immediately with the full override/exclusion sets and nothing else', async ({ page }) => {
  const state = await setup(page);
  await openRouting(page, 'all');
  await row(page, FLASH).click();
  await page.getByTestId(`router-model-tier-${FLASH}`).selectOption('frontier');
  await expect.poll(() => state.routerPuts.length).toBe(1);
  expect(state.routerPuts[0]).toEqual({ tierOverrides: { [QWEN]: 'standard', [FLASH]: 'frontier' }, excludedModels: [HAIKU] });
  await expect(page.getByTestId(`router-model-source-${FLASH}`)).toHaveText('override');
  await expect(page.getByTestId('router-group-tier-frontier')).toContainText('3');

  await row(page, MINI).click();
  await page.getByTestId(`router-model-exclude-${MINI}`).click(); // saved immediately; reflects the server read-back
  await expect(page.getByTestId(`router-model-exclude-${MINI}`)).toBeChecked();
  await expect.poll(() => state.routerPuts.length).toBe(2);
  expect(state.routerPuts[1].excludedModels).toEqual([MINI, HAIKU]);

  await row(page, QWEN).click();
  await page.getByTestId(`router-model-reset-${QWEN}`).click();
  await expect.poll(() => state.routerPuts.length).toBe(3);
  expect(state.routerPuts[2].tierOverrides).toEqual({ [FLASH]: 'frontier' });
  await expect(page.getByTestId(`router-model-source-${QWEN}`)).toHaveText('cost');
  await expect(page.getByTestId(`router-model-reset-${QWEN}`)).toHaveCount(0);
});

test('router:C4 thresholds: auto is read-only and sends only {tiers:{mode:auto}}; manual validates, previews and saves', async ({ page }) => {
  const state = await setup(page);
  await openRouting(page, 'thresholds');
  const cheap = page.getByTestId('router-catalog-cheap-max');
  const frontier = page.getByTestId('router-catalog-frontier-min');
  const error = page.getByTestId('router-catalog-threshold-error');
  const save = page.getByTestId('router-thresholds-save');
  await expect(page.getByTestId('router-catalog-mode-auto')).toBeChecked();
  await expect(cheap).toHaveValue('6');
  await expect(cheap).toHaveAttribute('readonly', '');
  await expect(frontier).toHaveValue('25');
  await expect(page.getByTestId('router-catalog-mode-hint')).toHaveText('Derived from 12 catalog prices');
  await save.click();
  await expect(page.getByTestId('router-thresholds-notice')).toBeVisible();
  expect(state.routerPuts[0]).toEqual({ tiers: { mode: 'auto' } });

  await page.getByTestId('router-catalog-mode-manual').check();
  await cheap.fill('30');
  await expect(error).toContainText('lower than');
  await expect(save).toBeDisabled();
  await cheap.fill('0');
  await expect(error).toContainText('greater than 0');
  await cheap.fill('20');
  await frontier.fill('50');
  await expect(error).toBeHidden();
  await expect(page.getByTestId('router-catalog-preview')).toHaveText('Cheap 4 · Standard 2 · Frontier 1');
  await save.click();
  await expect.poll(() => state.routerPuts.length).toBe(2);
  expect(state.routerPuts[1]).toEqual({ tiers: { mode: 'manual', cheapMaxOutputUsd: 20, frontierMinOutputUsd: 50 } });
  await expect(page.getByTestId('router-group-thresholds')).toContainText('Manual');
  await openRouting(page, 'all');
  await row(page, SONNET).click();
  await expect(page.getByTestId(`router-model-tier-${SONNET}`)).toHaveValue('cheap');
});

test('router:C5 missing or empty catalog shows the static-fallback state; only backend and thresholds groups', async ({ page }) => {
  for (const mode of ['missing', 'empty'] as const) {
    await setup(page, { catalog: mode });
    await openRouting(page, 'all');
    await expect(page.getByTestId('router-catalog-empty').first()).toHaveText('Catalog unavailable — the engine is not running; the router will use the static fallback table');
    await expect(page.getByTestId('settings-column-items').getByRole('option')).toHaveCount(2);
    await expect(page.getByTestId('router-settings')).toBeVisible(); // falls back to the backend group
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('router:C6 models not enabled in curation are grouped, muted, locked, and can be enabled from the inspector', async ({ page }) => {
  const state = await setup(page, { catalog: 'partial' });
  await openRouting(page, 'disabled');
  await expect(page.getByTestId('router-catalog-count')).toHaveText('Routing among 5 enabled models');
  expect(await modelNames(page)).toEqual(['Claude Haiku 4.5', 'Qwen3 (local)']);
  await row(page, QWEN).click();
  await expect(page.getByTestId(`router-model-status-${QWEN}`)).toHaveText('Not enabled in Models curation');
  await expect(page.getByTestId(`router-model-tier-${QWEN}`)).toBeDisabled();
  await expect(page.getByTestId(`router-model-exclude-${QWEN}`)).toBeDisabled();
  await expect(page.getByTestId(`router-model-reset-${QWEN}`)).toHaveCount(0);
  await page.getByTestId(`router-model-enabled-${QWEN}`).click();
  // Enabled: it leaves the "Not enabled" group.
  await expect(row(page, QWEN)).toHaveCount(0);
  await expect(page.getByTestId('router-group-disabled')).toContainText('1');
  await expect.poll(() => state.visibilityPatches.length).toBe(1);
  expect(state.visibilityPatches[0]).toEqual({ updates: [{ provider: 'ollama', modelId: 'qwen3', visible: true }] });
  await expect(page.getByTestId('router-catalog-count')).toHaveText('Routing among 6 enabled models');
  expect(state.routerPuts).toHaveLength(0);
});

test('router:C7 no_curated_models shows the callout and jumps to Models curation', async ({ page }) => {
  await setup(page, { catalog: 'none-curated' });
  await openRouting(page, 'all');
  await expect(page.getByTestId('router-catalog-count')).toHaveText('Routing among 0 enabled models');
  await expect(page.getByTestId('router-catalog-no-curated')).toContainText('No models are enabled in Models curation');
  await expect(row(page, GPT6)).toHaveClass(/muted/);
  await page.getByTestId('router-catalog-open-curation').click();
  await expect(page).toHaveURL(/settingsSection=models/);
});

test('router:B5 System One: loopback needs no consent, remote does; key is write-only; test shows the tier', async ({ page }) => {
  const state = await setup(page);
  await openRouterSettings(page);
  await page.getByTestId('router-backend-systemone').check();
  await expect(page.getByTestId('router-systemone-url')).toHaveValue('http://127.0.0.1:8009');
  await expect(page.getByTestId('router-systemone-model')).toHaveValue('kev-latest');
  await expect(page.getByTestId('router-systemone-key')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('router-systemone-help')).toContainText('kev.serve');
  await expect(page.getByTestId('router-timeout')).toHaveValue('1000');
  await expect(page.getByTestId('router-consent')).toHaveCount(0);
  await page.getByTestId('router-test').click();
  await expect(page.getByTestId('router-test-tier')).toHaveText('cheap');
  await expect(page.getByTestId('router-test-result')).toContainText('345 ms');
  // Evidence capture only when asked (keeps routine runs from writing files).
  if (process.env.RHYTHM_CAPTURE_EVIDENCE) {
    await page.getByTestId('router-backend-systemone').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.RHYTHM_CAPTURE_EVIDENCE}-fields.png` });
    await page.getByTestId('router-test-result').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.RHYTHM_CAPTURE_EVIDENCE}-result.png` });
  }
  expect(state.routerTests[0]).toMatchObject({ backend: 'systemone', systemone: { baseUrl: 'http://127.0.0.1:8009', model: 'kev-latest' } });
  expect(state.routerTests[0].systemone.apiKey).toBeUndefined();

  await page.getByTestId('router-systemone-url').fill('https://api.typesafe.ai');
  await expect(page.getByTestId('router-save')).toBeDisabled();
  await page.getByTestId('router-consent').check();
  await page.getByTestId('router-systemone-key').fill('sk-kev');
  await page.getByTestId('router-save').click();
  await expect(page.getByTestId('router-notice')).toBeVisible();
  expect(state.routerPuts.at(-1)).toMatchObject({ backend: 'systemone', remoteDataConsent: true, timeoutMs: 1000, systemone: { baseUrl: 'https://api.typesafe.ai', apiKey: 'sk-kev' } });
  await expect(page.getByTestId('router-systemone-key-saved')).toHaveText('Key saved');
});

test('router:B7 OpenAI Decisions backend: keyboard select, write-only key, consent-gated save, read-back and test', async ({ page }) => {
  const state = await setup(page);
  await openRouterSettings(page);
  const radio = page.getByTestId('router-backend-openai_decisions');
  await expect(radio).toBeVisible();
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await expect(radio).toBeFocused();
  await expect(page.getByTestId('router-openaiDecisions-url')).toHaveValue('https://api.openai.com');
  await expect(page.getByTestId('router-openaiDecisions-model')).toHaveValue('gpt-6-luna');
  await expect(page.getByTestId('router-openaiDecisions-key')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('router-settings').getByText('never memories')).toBeVisible();
  await expect(page.getByTestId('router-save')).toBeDisabled();
  await expect(page.getByTestId('router-consent-hint')).toBeVisible();
  await page.getByTestId('router-openaiDecisions-key').fill('synthetic-decisions-key');
  await page.getByTestId('router-consent').check();
  await page.getByTestId('router-feature-model_routing').selectOption('shadow');
  await page.screenshot({ path: test.info().outputPath('router-openai-decisions.png'), fullPage: true });
  await page.getByTestId('router-save').click();
  await expect(page.getByTestId('router-notice')).toHaveText('Router settings saved');
  expect(state.routerPuts[0]).toMatchObject({
    backend: 'openai_decisions', remoteDataConsent: true,
    openaiDecisions: { baseUrl: 'https://api.openai.com', model: 'gpt-6-luna', apiKey: 'synthetic-decisions-key' },
  });
  expect(state.routerPuts[0].features.model_routing).toBe('shadow');
  await expect(page.getByTestId('router-openaiDecisions-key-saved')).toHaveText('Key saved');
  await expect(page.getByTestId('router-openaiDecisions-key')).toHaveValue('');
  await page.getByTestId('router-test').click();
  await expect(page.getByTestId('router-test-tier')).toHaveText('standard');
  expect(state.routerTests[0].backend).toBe('openai_decisions');
  expect(JSON.stringify(state.routerTests[0])).not.toContain('synthetic-decisions-key');
  await page.getByTestId('router-timeout').fill('1200');
  await page.getByTestId('router-save').click();
  await expect.poll(() => state.routerPuts.length).toBe(2);
  expect(state.routerPuts[1].openaiDecisions).not.toHaveProperty('apiKey');
});
