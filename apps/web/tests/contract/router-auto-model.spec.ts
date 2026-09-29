import { expect, test, type Page, type Route } from '@playwright/test';

// Own intercepted live-gateway webServer (router-auto-model-playwright.config.ts) — same
// convention as issue-1580-model-curation.spec.ts.
test.skip(process.env.RHYTHM_ROUTER_AUTO_CONTRACT !== '1', 'Run with the router-auto-model live-gateway Playwright config');

type Body = Record<string, any>;
type State = {
  session: Body; patches: Body[]; frames: Body[]; provenance: Body; routerConfig: Body; routerPuts: Body[]; routerTests: Body[];
  putError: { status: number; message: string } | null; testFails: boolean;
};

const catalog = [
  { provider: 'openai', modelId: 'gpt-6', displayName: 'GPT-6', authorized: true, available: true, visible: true },
  { provider: 'anthropic', modelId: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', authorized: true, available: true, visible: true },
];

const baseRouterConfig = (): Body => ({
  backend: 'local',
  local: { baseUrl: 'http://127.0.0.1:8012', model: 'reranker-small', scoreScale: 'auto' },
  jev: { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', hasApiKey: false },
  custom: { baseUrl: '', model: '', scoreScale: 'auto', hasApiKey: false },
  timeoutMs: 1500, remoteDataConsent: false,
  features: { model_routing: 'default', tool_ranking: 'default', memory_ranking: 'off', capacity_routing: 'default' },
  lockedByEnv: ['tool_ranking'],
  effective: { backend: 'local', baseUrl: 'http://127.0.0.1:8012', model: 'reranker-small', features: {} },
});

async function setup(page: Page, opts: { modelMode?: 'auto' | 'fixed' | undefined } = { modelMode: 'auto' }): Promise<State> {
  const state: State = {
    session: { id: 's1', name: 'Router session', profileId: 'p1', cwd: '/tmp/x', providerId: 'openai', modelId: 'gpt-6', status: 'idle', createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z', ...(opts.modelMode ? { modelMode: opts.modelMode } : {}) },
    patches: [], frames: [], routerPuts: [], routerTests: [], putError: null, testFails: false,
    provenance: { available: true, requestedModelId: 'gpt-6', servedModels: [], multiModel: false, routed: true, steps: { unattributed: 0 }, dispatches: [{ requestedSource: 'auto', finalProviderId: 'anthropic', finalModelId: 'claude-sonnet-4-6' }] },
    routerConfig: baseRouterConfig(),
  };
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
      for (const key of ['local', 'jev', 'custom']) if (body[key]) { const { apiKey, ...rest } = body[key]; Object.assign(next[key], rest); if (apiKey !== undefined) next[key].hasApiKey = apiKey !== ''; }
      if (body.remoteDataConsent !== undefined) next.remoteDataConsent = body.remoteDataConsent;
      if (body.features) Object.assign(next.features, body.features);
      return json(next);
    }
    if (path === '/agent-decisions/config/test') {
      state.routerTests.push(request.postDataJSON() as Body);
      if (state.testFails) return json({ ok: false, message: 'connection refused' });
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
  await page.goto('/#/tools/agent-settings?settingsSection=models');
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
