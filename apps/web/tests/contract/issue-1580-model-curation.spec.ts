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
  ];
}

type ServerState = { authProviders: string[]; catalog: CatalogRow[]; patches: { provider: string; modelId: string; visible: boolean }[][]; catalogFullRequests: number; catalogRequests: number };

async function openModels(page: Page): Promise<ServerState> {
  const state: ServerState = { authProviders: [], catalog: seedCatalog(), patches: [], catalogFullRequests: 0, catalogRequests: 0 };
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
    if (url.pathname === '/agents/models/catalog/full') {
      state.catalogFullRequests++;
      const rows = state.catalog.map((row) => row.provider === 'openai' ? { ...row, authorized: state.authProviders.includes('openai'), available: state.authProviders.includes('openai') } : row);
      return route.fulfill({ status: 200, headers, json: rows });
    }
    if (url.pathname === '/agents/models/catalog') {
      state.catalogRequests++;
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

test('1580:S2:1 provider badges reflect connected/needs-login/unavailable, and Connect re-fetches the catalog and provider status in place', async ({ page }) => {
  const state = await openModels(page);
  const openaiGroup = page.getByTestId('model-curation-group-openai');
  const openrouterGroup = page.getByTestId('model-curation-group-openrouter');
  const ollamaGroup = page.getByTestId('model-curation-group-ollama');
  await expect(openaiGroup).toContainText('Needs login or key');
  await expect(openrouterGroup).toContainText('Connected');
  await expect(ollamaGroup).toContainText('Unavailable');
  await expect(ollamaGroup).toContainText('opencode.json');

  const beforeFull = state.catalogFullRequests;
  await openaiGroup.getByTestId('agent-settings-provider-authorize-openai').click();
  await expect(page.getByTestId('agent-settings-provider-flow-openai')).toBeVisible();
  await page.getByTestId('agent-settings-provider-code').fill('disposable-code');
  await page.getByTestId('agent-settings-provider-complete').click();

  await expect(openaiGroup).toContainText('Connected');
  await expect.poll(() => state.catalogFullRequests > beforeFull).toBe(true);
  await expect(page.getByTestId('agent-settings-provider-authorize-openai')).toHaveCount(0);
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
  const openaiCard = page.getByTestId('agent-settings-provider-openai');
  await expect(openaiCard).toBeVisible();
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

test('1580 layout: model rows are readable text and the settings pane fits between header and footer', async ({ page }) => {
  // Regressions a rendered look would have caught (the no-overflow checks above passed on both):
  // the global `.switch-label > span` track rule clamped each row's name/id to 34x20px, and the
  // pane was capped at 720px (half-empty on tall windows) with its bottom tucked under the footer.
  await openModels(page);
  const label = page.getByTestId('model-curation-model-openrouter-anthropic/claude-terra').locator('.model-curation-row-label');
  expect((await label.boundingBox())!.width).toBeGreaterThan(60);
  expect((await label.locator('strong').boundingBox())!.height).toBeLessThan(24);

  const pane = page.locator('.agent-settings-list-inspector');
  const footer = page.getByTestId('tool-trace');
  for (const height of [900, 1400]) {
    await page.setViewportSize({ width: 1440, height });
    await expect.poll(async () => {
      const [p, f] = [await pane.boundingBox(), await footer.boundingBox()];
      const gap = f!.y - (p!.y + p!.height);
      return gap >= 0 && gap < 80;
    }).toBe(true);
  }
  await page.screenshot({ path: 'test-results/issue-1580-page.png' });
});
