import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// This suite needs its own intercepted live-gateway webServer (issue-1580-playwright.config.ts),
// not default fixture discovery — same convention as issue-1559.spec.ts.
test.skip(process.env.RHYTHM_ISSUE_1580_CONTRACT !== '1', 'Run with the issue-1580 live-gateway Playwright config');

type CatalogRow = { provider: string; modelId: string; displayName: string; authorized: boolean; available: boolean | 'unknown'; visible: boolean; availabilityReason: string; connectUrl?: string };

function seedCatalog(): CatalogRow[] {
  return [
    { provider: 'openai', modelId: 'gpt-6', displayName: 'GPT-6', authorized: false, available: false, visible: true, availabilityReason: 'not_connected', connectUrl: '/connect/openai' },
    { provider: 'openai', modelId: 'gpt-6-mini', displayName: 'GPT-6 Mini', authorized: false, available: false, visible: true, availabilityReason: 'not_connected', connectUrl: '/connect/openai' },
    { provider: 'openrouter', modelId: 'anthropic/claude-terra', displayName: 'Claude Terra', authorized: true, available: true, visible: true, availabilityReason: 'available' },
    { provider: 'openrouter', modelId: 'meta/llama-4', displayName: 'Llama 4', authorized: true, available: true, visible: false, availabilityReason: 'hidden' },
    // Not in providerCatalog (no in-app connect flow) and not authorized — exercises the
    // "configured through opencode.json" reduced-form branch.
    { provider: 'ollama', modelId: 'llama3-local', displayName: 'Llama 3 (local)', authorized: false, available: false, visible: true, availabilityReason: 'not_connected' },
    // Single-login OAuth provider still connected from Models (method 0: re-check).
    { provider: 'google', modelId: 'gemini-3', displayName: 'Gemini 3', authorized: false, available: false, visible: true, availabilityReason: 'not_connected' },
    // Account-managed (Accounts owns sign-in); its models are still curated here.
    { provider: 'anthropic', modelId: 'claude-opus-5', displayName: 'Claude Opus 5', authorized: true, available: true, visible: true, availabilityReason: 'available' },
    { provider: 'anthropic', modelId: 'claude-haiku-5', displayName: 'Claude Haiku 5', authorized: true, available: true, visible: false, availabilityReason: 'hidden' },
  ];
}

type ServerState = { authProviders: string[]; catalog: CatalogRow[]; patches: { provider: string; modelId: string; visible: boolean }[][]; catalogFullRequests: number; catalogRequests: number; providerTests: number; providerSaves: number; providerModelCount: number; failProviderTest: boolean; pendingProviderSave: boolean; fullCatalogFailures: number; pickerCatalogFailures: number; providerTestDelayMs: number; providerSaveDelayMs: number };

async function openModels(page: Page): Promise<ServerState> {
  const state: ServerState = { authProviders: [], catalog: seedCatalog(), patches: [], catalogFullRequests: 0, catalogRequests: 0, providerTests: 0, providerSaves: 0, providerModelCount: 2, failProviderTest: false, pendingProviderSave: false, fullCatalogFailures: 0, pickerCatalogFailures: 0, providerTestDelayMs: 0, providerSaveDelayMs: 0 };
  const cors = (origin: string | undefined) => ({ 'access-control-allow-origin': origin ?? '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' });

  await page.route('https://api.vcrcapps.com/**', (route) => {
    const headers = cors(route.request().headers().origin);
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 200, headers, json: [] });
  });
  await page.route('http://127.0.0.1:7552/**', (route) => route.fulfill({ status: 200, json: { healthy: true, status: 'ready' } }));
  await page.route('http://127.0.0.1:7551/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = cors(request.headers()['origin']);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/health') return route.fulfill({ status: 200, headers, json: { healthy: true, status: 'ready' } });
    if (url.pathname === '/agent-configs') return route.fulfill({ status: 200, headers, json: [] });
    if (url.pathname === '/opencode/auth/accounts') return route.fulfill({ status: 200, headers, json: { accounts: [] } });
    if (url.pathname === '/opencode/mcp') return route.fulfill({ status: 200, headers, json: [] });
    if (url.pathname === '/opencode/auth') return route.fulfill({ status: 200, headers, json: { providers: state.authProviders } });
    if (url.pathname === '/opencode/auth/openai/authorize') return route.fulfill({ status: 200, headers, json: { authUrl: 'https://openai.example/authorize', instructions: 'Sign in with ChatGPT, then paste the code back here.' } });
    if (url.pathname === '/opencode/auth/google/authorize') return route.fulfill({ status: 200, headers, json: { authUrl: 'https://google.example/authorize', instructions: 'Sign in with Google, then check back here.' } });
    if (url.pathname === '/opencode/auth/openai/callback') { state.authProviders = [...new Set([...state.authProviders, 'openai'])]; return route.fulfill({ status: 200, headers, json: { ok: true } }); }
    if (url.pathname === '/opencode/providers/test' && request.method() === 'POST') {
      state.providerTests++;
      if (state.providerTestDelayMs) await new Promise((resolve) => setTimeout(resolve, state.providerTestDelayMs));
      if (state.failProviderTest) return route.fulfill({ status: 502, headers, json: { error: 'provider_auth_failed', message: 'The provider rejected the API key.' } });
      return route.fulfill({ status: 200, headers, json: { ok: true, providerId: 'studio-local', modelCount: state.providerModelCount, models: [{ id: 'canvas-pro', name: 'canvas-pro' }, { id: 'text-mini', name: 'text-mini' }].slice(0, state.providerModelCount) } });
    }
    if (url.pathname === '/opencode/providers' && request.method() === 'PUT') {
      state.providerSaves++;
      if (state.providerSaveDelayMs) await new Promise((resolve) => setTimeout(resolve, state.providerSaveDelayMs));
      if (state.pendingProviderSave) return route.fulfill({ status: 202, headers, json: { ok: true, pending: true, providerId: 'studio-local', modelCount: 2 } });
      state.catalog.push(
        { provider: 'studio-local', modelId: 'canvas-pro', displayName: 'canvas-pro', authorized: true, available: true, visible: true, availabilityReason: 'available' },
        { provider: 'studio-local', modelId: 'text-mini', displayName: 'text-mini', authorized: true, available: true, visible: true, availabilityReason: 'available' },
      );
      return route.fulfill({ status: 200, headers, json: { ok: true, providerId: 'studio-local', modelCount: 2 } });
    }
    if (url.pathname === '/agents/models/catalog/full') {
      state.catalogFullRequests++;
      if (state.fullCatalogFailures > 0) { state.fullCatalogFailures--; return route.fulfill({ status: 503, headers, json: { error: 'catalog_refresh_failed' } }); }
      const rows = state.catalog.map((row) => ['openai', 'google'].includes(row.provider) ? { ...row, authorized: state.authProviders.includes(row.provider), available: state.authProviders.includes(row.provider) } : row);
      return route.fulfill({ status: 200, headers, json: rows });
    }
    if (url.pathname === '/agents/models/catalog') {
      state.catalogRequests++;
      if (state.pickerCatalogFailures > 0) { state.pickerCatalogFailures--; return route.fulfill({ status: 503, headers, json: { error: 'picker_refresh_failed' } }); }
      const rows = state.catalog.filter((row) => row.visible && (row.authorized || false)).map((row) => ({ ...row }));
      return route.fulfill({ status: 200, headers, json: rows });
    }
    if (url.pathname === '/agent-models/visibility' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { updates: { provider: string; modelId: string; visible: boolean }[] };
      state.patches.push(body.updates);
      for (const update of body.updates) {
        const row = state.catalog.find((entry) => entry.provider === update.provider && entry.modelId === update.modelId);
        if (row) row.visible = update.visible;
      }
      return route.fulfill({ status: 200, headers, json: { updated: body.updates.length } });
    }
    return route.fulfill({ status: 200, headers, json: [] });
  });

  await page.goto('/#/tools/agent-settings?settingsSection=models');
  await expect.poll(() => state.catalogFullRequests > 0).toBe(true);
  await expect(page.getByTestId('model-curation-panel')).toBeVisible();
  return state;
}

async function prepareCustomProvider(page: Page) {
  await page.getByTestId('custom-provider-disclosure').click();
  await page.getByLabel('Provider name').fill('Studio Local');
  await page.getByLabel('Provider ID').fill('studio-local');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:8787/v1');
  await page.getByLabel('API key (optional)').fill('synthetic-ui-key');
  await page.getByTestId('custom-provider-test').click();
  await expect(page.getByTestId('custom-provider-status')).toHaveText('Connected · 2 models found');
}

function addStudioCatalog(state: ServerState) {
  if (state.catalog.some((row) => row.provider === 'studio-local')) return;
  state.catalog.push(
    { provider: 'studio-local', modelId: 'canvas-pro', displayName: 'canvas-pro', authorized: true, available: true, visible: true, availabilityReason: 'available' },
    { provider: 'studio-local', modelId: 'text-mini', displayName: 'text-mini', authorized: true, available: true, visible: true, availabilityReason: 'available' },
  );
}

test('1580:S2:1 provider badges reflect connected/needs-login/unavailable, and Connect re-fetches the catalog and provider status in place', async ({ page }) => {
  const state = await openModels(page);
  const googleGroup = page.getByTestId('model-curation-group-google');
  const openrouterGroup = page.getByTestId('model-curation-group-openrouter');
  const ollamaGroup = page.getByTestId('model-curation-group-ollama');
  await expect(googleGroup).toContainText('Needs login or key');
  await expect(openrouterGroup).toContainText('Connected');
  await expect(ollamaGroup).toContainText('Unavailable');
  await expect(ollamaGroup).toContainText('opencode.json');

  const beforeFull = state.catalogFullRequests;
  await googleGroup.getByTestId('agent-settings-provider-authorize-google').click();
  await expect(page.getByTestId('agent-settings-provider-flow-google')).toBeVisible();
  state.authProviders = ['google'];
  await page.getByTestId('agent-settings-provider-check').click();

  await expect(googleGroup).toContainText('Connected');
  await expect.poll(() => state.catalogFullRequests > beforeFull).toBe(true);
  await expect(page.getByTestId('agent-settings-provider-authorize-google')).toHaveCount(0);
});

test('account-managed providers: Anthropic and OpenAI models are curated here, sign-in is managed in Accounts', async ({ page }) => {
  const state = await openModels(page);
  for (const provider of ['anthropic', 'openai']) {
    const group = page.getByTestId(`model-curation-group-${provider}`);
    await expect(group).toBeVisible();
    // No connect or API-key flow for an account-managed provider.
    await expect(group.getByTestId(`agent-settings-provider-${provider}`)).toHaveCount(0);
    await expect(group.getByTestId(`agent-settings-provider-authorize-${provider}`)).toHaveCount(0);
    await expect(group.getByTestId(`model-curation-open-accounts-${provider}`)).toHaveText('Managed in Accounts');
  }
  await expect(page.getByTestId('model-curation-group-anthropic')).toContainText('Connected');
  await expect(page.getByTestId('model-curation-account-managed-anthropic')).toContainText('Signed in through Accounts');
  await expect(page.getByTestId('model-curation-account-managed-openai')).toContainText('Not signed in');

  // Anthropic's models are listed and toggleable like every other connected provider.
  const haiku = page.getByTestId('model-curation-model-anthropic-claude-haiku-5').locator('input[type="checkbox"]');
  await expect(page.getByTestId('model-curation-model-anthropic-claude-opus-5')).toBeVisible();
  await expect(haiku).not.toBeChecked();
  await haiku.click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual([{ provider: 'anthropic', modelId: 'claude-haiku-5', visible: true }]);
  await expect(haiku).toBeChecked();

  // The link goes to the Accounts category of the column layout.
  await page.getByTestId('model-curation-open-accounts-anthropic').click();
  await expect.poll(() => new URL(page.url()).hash).toContain('settingsSection=accounts');
  await expect(page.getByRole('option', { name: 'Accounts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('agent-settings-account-add')).toBeVisible();
});

test('1580:S2:2 search matches provider, raw model id, and display name, and the list never overflows its container', async ({ page }) => {
  await openModels(page);
  await page.getByTestId('model-curation-search').fill('terra');
  await expect(page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra')).toBeVisible();
  await expect(page.getByTestId('model-curation-group-openai')).toHaveCount(0);
  await expect(page.getByTestId('model-curation-group-ollama')).toHaveCount(0);

  await page.getByTestId('model-curation-search').fill('ollama');
  await expect(page.getByTestId('model-curation-group-ollama')).toBeVisible();

  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflowing).toBe(false);
});

test('1580:S2:3 group headers are keyboard-toggleable buttons with aria-expanded', async ({ page }) => {
  await openModels(page);
  const header = page.getByTestId('model-curation-group-toggle-openrouter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra')).toBeVisible();

  await header.focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra')).toHaveCount(0);

  await page.keyboard.press(' ');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra')).toBeVisible();
});

test('1580:S2:4 the provider all/none checkbox is tri-state and PATCHes only the changed rows; a disconnected provider cannot be toggled', async ({ page }) => {
  const state = await openModels(page);

  const allNone = page.getByTestId('model-curation-all-openrouter');
  await expect(allNone).toHaveAttribute('aria-checked', 'mixed');
  expect(await allNone.evaluate((element: HTMLInputElement) => element.indeterminate)).toBe(true);

  await allNone.click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual([{ provider: 'openrouter', modelId: 'meta/llama-4', visible: true }]);
  await expect(allNone).toHaveAttribute('aria-checked', 'true');

  // openai is not connected: its models are listed (so the user can see what's available)
  // but every switch and the group all/none stay disabled until it is connected.
  await expect(page.getByTestId('model-curation-all-openai')).toBeDisabled();
  await expect(page.getByTestId('model-curation-model-openai-gpt-6').locator('input[type="checkbox"]')).toBeDisabled();
  // OpenAI sign-in moved to Accounts (multi-account); Models points there instead of a Connect card.
  await expect(page.getByTestId('agent-settings-provider-openai')).toHaveCount(0);
  await expect(page.getByTestId('model-curation-open-accounts-openai')).toBeVisible();
});

test('1580:S2:5 a per-model switch PATCHes exactly one row and immediately refreshes the shared model catalog (picker source)', async ({ page }) => {
  const state = await openModels(page);
  const beforeCatalogRequests = state.catalogRequests;

  const claudeTerraSwitch = page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra').locator('input[type="checkbox"]');
  await expect(claudeTerraSwitch).toBeChecked();
  await claudeTerraSwitch.click();

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual([{ provider: 'openrouter', modelId: 'anthropic/claude-terra', visible: false }]);
  await expect(claudeTerraSwitch).not.toBeChecked();
  // refreshModels() re-fetches /agents/models/catalog — the exact endpoint every picker
  // (Composer, Profiles, AgentsWorkspace) reads from — proving the change reaches them
  // without a reload or session switch.
  await expect.poll(() => state.catalogRequests > beforeCatalogRequests).toBe(true);
});

test('1580:S2:7 hiding then re-enabling a model round-trips through PATCH and the row stays findable in the panel', async ({ page }) => {
  // Regression test for the #1580 blocker: the real /agents/models/catalog/full route used to
  // share listAgentModelCatalog()'s visible-only filter with /catalog, so a model hidden via
  // this panel could never be found again to re-enable. This stub mirrors the corrected server
  // contract (full stays full; only the picker-facing /catalog filters), so this test also
  // guards the panel's own logic against regressing back to dropping hidden rows client-side.
  const state = await openModels(page);
  const claudeTerraSwitch = page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra').locator('input[type="checkbox"]');
  await expect(claudeTerraSwitch).toBeChecked();

  await claudeTerraSwitch.click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual([{ provider: 'openrouter', modelId: 'anthropic/claude-terra', visible: false }]);
  await expect(claudeTerraSwitch).not.toBeChecked();
  // The row must remain visible in the panel after being hidden, so it can be re-enabled.
  await expect(page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra')).toBeVisible();

  await claudeTerraSwitch.click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1]).toEqual([{ provider: 'openrouter', modelId: 'anthropic/claude-terra', visible: true }]);
  await expect(claudeTerraSwitch).toBeChecked();
});

test('1580 review-fix (minor): checking provider status again with an unchanged authorized set does not refetch the full catalog', async ({ page }) => {
  // Regression: the panel's load-catalog effect depended on the `authProviders` array
  // reference. Every successful providers reload creates a new array even when its content
  // is unchanged (e.g. re-checking an OAuth flow that hasn't completed yet), which used to
  // trigger a redundant /agents/models/catalog/full fetch on every retry.
  const state = await openModels(page);
  const beforeFull = state.catalogFullRequests;

  await page.getByTestId('model-curation-group-google').getByTestId('agent-settings-provider-authorize-google').click();
  await expect(page.getByTestId('agent-settings-provider-flow-google')).toBeVisible();

  // Google is still unauthorized in server state — "check connection" re-fetches
  // /opencode/auth (a fresh array, same empty content) without anything actually changing.
  await page.getByTestId('agent-settings-provider-check').click();
  await expect(page.getByTestId('model-curation-panel').getByText(/is not connected yet/i)).toBeVisible();
  // Give a (buggy) extra fetch a moment to land before asserting its absence.
  await page.waitForTimeout(500);

  expect(state.catalogFullRequests).toBe(beforeFull);
});

test('1580 review-fix (minor): Models panel has no serious/critical axe violations', async ({ page }) => {
  // Coverage gap called out in review: unlike issue-1559.spec.ts, the original S2 suite ran
  // no accessibility scan against the new curation panel.
  await openModels(page);
  const results = await new AxeBuilder({ page }).include('[data-testid="model-curation-panel"]').analyze();
  const seriousOrCritical = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(seriousOrCritical).toEqual([]);
});

test('1580:S2:6 at 390px width every control has a label and the panel does not scroll horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openModels(page);

  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflowing).toBe(false);

  for (const testId of ['model-curation-all-openrouter', 'model-curation-search']) {
    const accessibleName = await page.getByTestId(testId).evaluate((element) => element.getAttribute('aria-label') ?? element.closest('label')?.textContent ?? '');
    expect(accessibleName?.trim().length).toBeGreaterThan(0);
  }
  const modelSwitch = page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra').locator('input[type="checkbox"]');
  await expect(modelSwitch).toHaveAttribute('aria-label', /Claude Terra/);
});

test('provider-search-c1: each populated provider has a compact named search outside its toggle', async ({ page }) => {
  // Regression: placing a search inside the provider button creates nested interactive controls;
  // the button-ancestor and accessible-name assertions fail if that structure returns.
  await openModels(page);
  for (const provider of ['openai', 'openrouter', 'ollama']) {
    const search = page.getByTestId(`model-curation-provider-search-${provider}`);
    await expect(search).toHaveAccessibleName(new RegExp(provider, 'i'));
    expect(await search.evaluate((element) => Boolean(element.closest('button')))).toBe(false);
  }
});

test('provider-search-c2: local name/id matching is case-insensitive and isolated to one provider', async ({ page }) => {
  // Regression: a provider-local query accidentally filtered every provider; the OpenAI row
  // visibility assertion fails, while name and raw-ID assertions guard both match fields.
  await openModels(page);
  const search = page.getByTestId('model-curation-provider-search-openrouter');
  await search.fill('CLAUDE TERRA');
  await expect(page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra')).toBeVisible();
  await expect(page.getByTestId('model-curation-model-openrouter-meta/llama-4')).toHaveCount(0);
  await expect(page.getByTestId('model-curation-model-openai-gpt-6')).toBeVisible();
  await search.fill('META/LLAMA-4');
  await expect(page.getByTestId('model-curation-model-openrouter-meta/llama-4')).toBeVisible();
});

test('provider-search-c3: no local matches keeps the provider and explains the empty result', async ({ page }) => {
  // Regression: local filtering removed the whole provider card; both visibility assertions fail.
  await openModels(page);
  await page.getByTestId('model-curation-provider-search-openrouter').fill('no-such-model');
  const group = page.getByTestId('model-curation-group-openrouter');
  await expect(group).toBeVisible();
  const noResults = group.getByText('No matching models for this provider.', { exact: true });
  await expect(noResults).toHaveAttribute('role', 'status');
  await mkdir('../../docs/ai/runs/artifacts/composer-drop-provider-model-search', { recursive: true });
  await group.screenshot({ path: '../../docs/ai/runs/artifacts/composer-drop-provider-model-search/provider-search-no-results.png' });
});

test('provider-search-c4: keyboard collapse preserves provider-local search state', async ({ page }) => {
  // Regression: putting search state in the collapsible body reset it on unmount; the value
  // assertion after Enter/Space catches that loss while aria-expanded guards keyboard toggling.
  await openModels(page);
  const search = page.getByTestId('model-curation-provider-search-openrouter');
  const toggle = page.getByTestId('model-curation-group-toggle-openrouter');
  await search.fill('terra');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press(' ');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toHaveValue('terra');
});

test('provider-search-c5: All / none reflects and patches only displayed rows during search', async ({ page }) => {
  // Regression: bulk selection mutated hidden models; exact PATCH payloads fail if either the
  // provider-local or global search is ignored by tri-state/bulk behavior.
  const state = await openModels(page);
  const localSearch = page.getByTestId('model-curation-provider-search-openrouter');
  const allNone = page.getByTestId('model-curation-all-openrouter');
  const allNoneLabel = allNone.locator('..');
  await expect(allNone).toHaveAccessibleName('Show all OpenRouter models');
  await expect(allNoneLabel).toHaveText('All / none');
  await localSearch.fill('terra');
  await expect(allNone).toHaveAccessibleName('Show all displayed OpenRouter models');
  await expect(allNoneLabel).toHaveText('All / none shown');
  await expect(allNone).toHaveAttribute('aria-checked', 'true');
  await allNone.click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual([{ provider: 'openrouter', modelId: 'anthropic/claude-terra', visible: false }]);

  await localSearch.fill('');
  await expect(allNone).toHaveAccessibleName('Show all OpenRouter models');
  await expect(allNoneLabel).toHaveText('All / none');
  await page.getByTestId('model-curation-search').fill('llama-4');
  await expect(allNone).toHaveAccessibleName('Show all displayed OpenRouter models');
  await expect(allNoneLabel).toHaveText('All / none shown');
  await expect(allNone).toHaveAttribute('aria-checked', 'false');
  await allNone.click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1]).toEqual([{ provider: 'openrouter', modelId: 'meta/llama-4', visible: true }]);
});

test('1580 layout: model rows are readable text and the settings pane fits between header and footer', async ({ page }) => {
  // Regressions a rendered look would have caught (the no-overflow checks above passed on both):
  // the global `.switch-label > span` track rule clamped each row's name/id to 34x20px, and the
  // pane was capped at 720px (half-empty on tall windows) with its bottom tucked under the footer.
  await openModels(page);
  const label = page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra').locator('.model-curation-row-label');
  expect((await label.boundingBox())!.width).toBeGreaterThan(60);
  expect((await label.locator('strong').boundingBox())!.height).toBeLessThan(24);

  const pane = page.locator('.agent-settings-browser .column-browser-track');
  const footer = page.getByTestId('tool-trace');
  for (const height of [900, 1400]) {
    await page.setViewportSize({ width: 1440, height });
    await expect.poll(async () => {
      const [p, f] = [await pane.boundingBox(), await footer.boundingBox()];
      const gap = f!.y - (p!.y + p!.height);
      return gap >= 0 && gap < 80;
    }).toBe(true);
  }
  // Header: the back link sits on its own line above the eyebrow; badges keep their sentence case.
  const [back, eyebrow] = [await page.getByTestId('tool-back').boundingBox(), await page.locator('.tool-heading-copy .eyebrow').boundingBox()];
  expect(eyebrow!.y).toBeGreaterThanOrEqual(back!.y + back!.height - 1);
  await expect(page.getByTestId('model-curation-group-openai').locator('.kind-badge').first()).toHaveCSS('text-transform', 'none');
  await page.screenshot({ path: 'test-results/issue-1580-page.png' });
});

test('custom-provider-c9/c10: disclosure is accessible, test success enables save, and editing invalidates the exact tested values', async ({ page }) => {
  const state = await openModels(page);
  const disclosure = page.getByTestId('custom-provider-disclosure');
  await expect(disclosure).toHaveAccessibleName('Add custom provider');
  await disclosure.click();
  await expect(page.getByLabel('Provider name')).toBeVisible();
  await expect(page.getByLabel('Provider ID')).toBeVisible();
  await expect(page.getByLabel('Base URL')).toBeVisible();
  await expect(page.getByLabel('API key (optional)')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('custom-provider-help')).toContainText('OpenAI-compatible');

  await page.getByLabel('Provider name').fill('Studio Local');
  await page.getByLabel('Provider ID').fill('studio-local');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:8787/v1');
  await page.getByLabel('API key (optional)').fill('synthetic-ui-key');
  await expect(page.getByTestId('custom-provider-save')).toBeDisabled();
  await page.getByTestId('custom-provider-test').click();
  await expect(page.getByTestId('custom-provider-status')).toHaveText('Connected · 2 models found');
  await mkdir('../../docs/ai/runs/artifacts/custom-provider-endpoint', { recursive: true });
  await page.locator('.custom-provider').screenshot({ path: '../../docs/ai/runs/artifacts/custom-provider-endpoint/test-success.png' });
  await expect(page.getByTestId('custom-provider-save')).toBeEnabled();
  expect(state.providerTests).toBe(1);

  await page.getByLabel('Provider name').fill('Studio Local Edited');
  await expect(page.getByTestId('custom-provider-status')).toBeEmpty();
  await expect(page.getByTestId('custom-provider-save')).toBeDisabled();
});

test('custom-provider-c10: singular model count uses exact grammar', async ({ page }) => {
  const state = await openModels(page);
  state.providerModelCount = 1;
  await page.getByTestId('custom-provider-disclosure').click();
  await page.getByLabel('Provider name').fill('Studio Local');
  await page.getByLabel('Provider ID').fill('studio-local');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:8787/v1');
  await page.getByTestId('custom-provider-test').click();
  await expect(page.getByTestId('custom-provider-status')).toHaveText('Connected · 1 model found');
});

test('custom-provider-c10: sanitized actionable failures use an alert live region', async ({ page }) => {
  const state = await openModels(page);
  await page.getByTestId('custom-provider-disclosure').click();
  await page.getByLabel('Provider name').fill('Studio Local');
  await page.getByLabel('Provider ID').fill('studio-local');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:8787/v1');
  state.failProviderTest = true;
  await page.getByTestId('custom-provider-test').click();
  const status = page.getByTestId('custom-provider-status');
  await expect(status).toHaveAttribute('role', 'alert');
  await expect(status).toContainText('The provider rejected the API key.');
  await expect(status).not.toContainText('synthetic-ui-key');
  await expect(page.getByTestId('custom-provider-save')).toBeDisabled();
});

test('custom-provider-c11/c12: save clears the secret, refreshes catalogs, expands the searchable group, and preserves narrow a11y', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openModels(page);
  const disclosure = page.getByTestId('custom-provider-disclosure');
  await disclosure.click();
  await page.getByLabel('Provider name').fill('Studio Local');
  await page.getByLabel('Provider ID').fill('studio-local');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:8787/v1');
  await page.getByLabel('API key (optional)').fill('synthetic-ui-key');
  await page.getByTestId('custom-provider-test').click();
  const beforeFull = state.catalogFullRequests;
  const beforePicker = state.catalogRequests;
  await page.getByTestId('custom-provider-save').click();
  await expect.poll(() => state.providerSaves).toBe(1);
  await expect.poll(() => state.catalogFullRequests).toBeGreaterThan(beforeFull);
  await expect.poll(() => state.catalogRequests).toBeGreaterThan(beforePicker);
  await expect(page.getByLabel('API key (optional)')).toHaveValue('');
  const group = page.getByTestId('model-curation-group-studio-local');
  await expect(group).toBeVisible();
  await expect(group.getByTestId('model-curation-model-studio-local-canvas-pro')).toBeVisible();
  await group.getByTestId('model-curation-provider-search-studio-local').fill('canvas');
  await expect(group.getByTestId('model-curation-model-studio-local-text-mini')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).include('[data-testid="model-curation-panel"]').analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  for (const testId of ['custom-provider-test', 'custom-provider-save']) {
    expect((await page.getByTestId(testId).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await disclosure.evaluate((element) => Boolean(element.querySelector('button,input,select,textarea,a')))).toBe(false);
  await mkdir('../../docs/ai/runs/artifacts/custom-provider-endpoint', { recursive: true });
  await group.screenshot({ path: '../../docs/ai/runs/artifacts/custom-provider-endpoint/post-save-provider.png' });
});

test('custom-provider pending commit clears the key, avoids a connected claim, and offers Refresh models', async ({ page }) => {
  const state = await openModels(page);
  state.pendingProviderSave = true;
  await page.getByTestId('custom-provider-disclosure').click();
  await page.getByLabel('Provider name').fill('Studio Local');
  await page.getByLabel('Provider ID').fill('studio-local');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:8787/v1');
  await page.getByLabel('API key (optional)').fill('synthetic-ui-key');
  await page.getByTestId('custom-provider-test').click();
  await page.getByTestId('custom-provider-save').click();
  await expect(page.getByLabel('API key (optional)')).toHaveValue('');
  await expect(page.getByTestId('custom-provider-status')).toContainText('safely saved');
  await expect(page.getByTestId('custom-provider-status')).not.toContainText('Connected');
  const refresh = page.getByTestId('custom-provider-refresh');
  await expect(refresh).toBeVisible();
  const before = state.catalogFullRequests;
  await refresh.click();
  await expect.poll(() => state.catalogFullRequests).toBeGreaterThan(before);
});

test('custom-provider review: PUT 200 plus full-catalog refresh failure stays saved and retry refreshes both catalogs', async ({ page }) => {
  const state = await openModels(page);
  await prepareCustomProvider(page);
  state.fullCatalogFailures = 1;
  const beforePicker = state.catalogRequests;
  await page.getByTestId('custom-provider-save').click();
  await expect(page.getByTestId('custom-provider-status')).toContainText('Provider saved, but models could not be refreshed.');
  await expect(page.getByTestId('custom-provider-status')).not.toContainText('could not be saved');
  const refresh = page.getByTestId('custom-provider-refresh');
  const beforeFull = state.catalogFullRequests;
  await refresh.click();
  await expect.poll(() => state.catalogFullRequests).toBeGreaterThan(beforeFull);
  await expect.poll(() => state.catalogRequests).toBeGreaterThan(beforePicker);
  await expect(page.getByTestId('custom-provider-group-studio-local')).toHaveCount(0);
  await expect(page.getByTestId('model-curation-group-studio-local')).toBeVisible();
  await expect(refresh).toHaveCount(0);
});

test('custom-provider review: PUT 200 plus picker refresh failure is truthful and retry runs both', async ({ page }) => {
  const state = await openModels(page);
  await prepareCustomProvider(page);
  state.pickerCatalogFailures = 1;
  await page.getByTestId('custom-provider-save').click();
  await expect(page.getByTestId('custom-provider-status')).toContainText('Provider saved, but models could not be refreshed.');
  await expect(page.getByTestId('custom-provider-status')).not.toContainText('Provider could not be saved');
  const beforeFull = state.catalogFullRequests;
  const beforePicker = state.catalogRequests;
  await page.getByTestId('custom-provider-refresh').click();
  await expect.poll(() => state.catalogFullRequests).toBeGreaterThan(beforeFull);
  await expect.poll(() => state.catalogRequests).toBeGreaterThan(beforePicker);
  await expect(page.getByTestId('custom-provider-refresh')).toHaveCount(0);
});

test('custom-provider review: 202 refresh success resolves, expands provider, and removes retry', async ({ page }) => {
  const state = await openModels(page);
  state.pendingProviderSave = true;
  await prepareCustomProvider(page);
  await page.getByTestId('custom-provider-save').click();
  addStudioCatalog(state);
  await page.getByTestId('custom-provider-refresh').click();
  const group = page.getByTestId('model-curation-group-studio-local');
  await expect(group).toBeVisible();
  await expect(group.getByTestId('model-curation-model-studio-local-canvas-pro')).toBeVisible();
  await expect(group.getByTestId('model-curation-group-toggle-studio-local')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('custom-provider-status')).toContainText('available');
  await expect(page.getByTestId('custom-provider-refresh')).toHaveCount(0);
});

test('custom-provider review: 202 refresh with provider still absent retains pending retry', async ({ page }) => {
  const state = await openModels(page);
  state.pendingProviderSave = true;
  await prepareCustomProvider(page);
  await page.getByTestId('custom-provider-save').click();
  await page.getByTestId('custom-provider-refresh').click();
  await expect(page.getByTestId('custom-provider-status')).toContainText('still refreshing');
  await expect(page.getByTestId('custom-provider-refresh')).toBeVisible();
});

test('custom-provider review: 202 refresh failure retains committed pending truth and retry', async ({ page }) => {
  const state = await openModels(page);
  state.pendingProviderSave = true;
  await prepareCustomProvider(page);
  await page.getByTestId('custom-provider-save').click();
  state.fullCatalogFailures = 1;
  await page.getByTestId('custom-provider-refresh').click();
  await expect(page.getByTestId('custom-provider-status')).toContainText('safely saved');
  await expect(page.getByTestId('custom-provider-status')).toContainText('Refresh failed');
  await expect(page.getByTestId('custom-provider-status')).not.toContainText('could not be saved');
  await expect(page.getByTestId('custom-provider-refresh')).toBeVisible();
});

test('custom-provider review: stale test result is ignored after fields change', async ({ page }) => {
  const state = await openModels(page);
  state.providerTestDelayMs = 300;
  await page.getByTestId('custom-provider-disclosure').click();
  await page.getByLabel('Provider name').fill('Studio Local');
  await page.getByLabel('Provider ID').fill('studio-local');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:8787/v1');
  await page.getByTestId('custom-provider-test').click();
  await page.getByLabel('Provider name').fill('Edited During Test');
  await expect.poll(() => state.providerTests).toBe(1);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('custom-provider-status')).toBeEmpty();
  await expect(page.getByTestId('custom-provider-save')).toBeDisabled();
});

test('custom-provider review: all four fields are disabled for the in-flight committed save', async ({ page }) => {
  const state = await openModels(page);
  await prepareCustomProvider(page);
  state.providerSaveDelayMs = 400;
  await page.getByTestId('custom-provider-save').click();
  for (const label of ['Provider name', 'Provider ID', 'Base URL', 'API key (optional)']) await expect(page.getByLabel(label)).toBeDisabled();
  await expect(page.getByTestId('custom-provider-save')).toHaveText('Saving…');
});

test('custom-provider review: refresh and disclosure are 44px and narrow provider search reaches 44px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openModels(page);
  state.pendingProviderSave = true;
  await prepareCustomProvider(page);
  await page.getByTestId('custom-provider-save').click();
  for (const testId of ['custom-provider-disclosure', 'custom-provider-refresh', 'model-curation-provider-search-openrouter']) {
    expect((await page.getByTestId(testId).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await mkdir('../../docs/ai/runs/artifacts/custom-provider-endpoint', { recursive: true });
  await page.locator('.custom-provider').screenshot({ path: '../../docs/ai/runs/artifacts/custom-provider-endpoint/pending-refresh.png' });
});
