import { expect, test, type Page } from '@playwright/test';

/**
 * #1576 S4 — Inspector "Served by" panel.
 *
 * Mounts the real `LiveModelProvenance` component (exported from
 * Inspector.tsx) directly against a `mode: 'live'` gateway whose loopback
 * bases are mocked with `page.route` — the same hermetic-test technique
 * `issue-1582-lifecycle.spec.ts` uses. No real api_server/engine is started;
 * ports 7600/7601 are placeholders Playwright intercepts before any real
 * network call, matching this lane's assigned 7600-7609 block.
 */

const API_ORIGIN = 'http://127.0.0.1:7600';
const ENGINE_ORIGIN = 'http://127.0.0.1:7601';
const PROD_ORIGIN = 'https://provenance-1576-fixture.invalid';

interface ModelProvenanceFixture {
  available: boolean;
  reason?: 'local_only';
  requestedModelId: string | null;
  servedModels: string[];
  multiModel: boolean;
  routed: boolean;
  steps: { unattributed: number };
}

async function open(page: Page, initial: ModelProvenanceFixture) {
  let requestCount = 0;
  let current = initial;
  await page.route(
    (url) => [API_ORIGIN, ENGINE_ORIGIN, PROD_ORIGIN].includes(new URL(url).origin),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/agent-sessions/sess-1576/model-provenance') {
        requestCount += 1;
        return route.fulfill({ status: 200, json: current });
      }
      return route.fulfill({ status: 404, json: {} });
    },
  );
  await page.route('**/tests/issue-1576-inspector-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {mountLive} = await import('/tests/contract/helpers/live-mount-1576.ts');
    const {LiveModelProvenance} = await import('/src/components/Inspector.tsx');
    mountLive(LiveModelProvenance, {sessionId:'sess-1576'}, {mode:'live',apiBase:'${API_ORIGIN}',expectedApiBase:'${API_ORIGIN}',engineBase:'${ENGINE_ORIGIN}',expectedEngineBase:'${ENGINE_ORIGIN}',productionApiBase:'${PROD_ORIGIN}',taskToken:'fixture'});
  </script></body></html>`,
    }),
  );
  await page.goto('/tests/issue-1576-inspector-fixture.html');
  await expect(page.getByTestId('model-provenance')).toBeVisible();
  return {
    requestCount: () => requestCount,
    setResponse: (next: ModelProvenanceFixture) => { current = next; },
  };
}

test('1576:S4:1 two served models show Served by, a Spanned models warning and a Routed chip', async ({ page }) => {
  await open(page, { available: true, requestedModelId: 'openrouter/free', servedModels: ['meta-llama/x:free', 'mistralai/y:free'], multiModel: true, routed: true, steps: { unattributed: 0 } });
  const panel = page.getByTestId('model-provenance');
  await expect(panel.getByRole('heading', { name: 'Served by' })).toBeVisible();
  await expect(panel.locator('li')).toHaveText(['meta-llama/x:free', 'mistralai/y:free']);
  await expect(panel).toContainText('Spanned 2 models');
  await expect(page.getByTestId('model-provenance-routed')).toHaveText('Routed');
});

test('1576:S4:2 zero served models with unattributed steps shows Not recorded, the requested alias as unverified, and invents no served model', async ({ page }) => {
  await open(page, { available: true, requestedModelId: 'openrouter/free', servedModels: [], multiModel: false, routed: false, steps: { unattributed: 3 } });
  const panel = page.getByTestId('model-provenance');
  await expect(panel).toContainText('Not recorded (3 steps before provenance capture)');
  await expect(panel.getByTestId('model-provenance-requested')).toHaveText('Requested openrouter/free — unverified');
  await expect(panel.locator('li')).toHaveCount(0);
});

test('1576:S4:3 zero served models with no unattributed steps and no requested alias never fabricates anything', async ({ page }) => {
  await open(page, { available: true, requestedModelId: null, servedModels: [], multiModel: false, routed: false, steps: { unattributed: 0 } });
  const panel = page.getByTestId('model-provenance');
  await expect(panel.locator('li')).toHaveCount(0);
  await expect(panel.getByTestId('model-provenance-requested')).toHaveCount(0);
  await expect(panel).not.toContainText('Not recorded');
});

test('1576:S4:4 refresh re-fetches model-provenance and renders model ids as inert text, not markup', async ({ page }) => {
  const injected = '<img src=x onerror=alert(1)>';
  const harness = await open(page, { available: true, requestedModelId: null, servedModels: [injected], multiModel: false, routed: false, steps: { unattributed: 0 } });
  const panel = page.getByTestId('model-provenance');
  await expect(panel.locator('li')).toHaveText([injected]);
  expect(await panel.locator('img').count()).toBe(0);
  expect(harness.requestCount()).toBe(1);
  await panel.getByRole('button', { name: 'Refresh served models' }).click();
  await expect.poll(() => harness.requestCount()).toBe(2);
});

test('1576:S4:5 (review follow-up) a Postgres/cloud-role available:false response renders as unavailable, not an error', async ({ page }) => {
  await open(page, { available: false, reason: 'local_only', requestedModelId: 'openrouter/free', servedModels: [], multiModel: false, routed: false, steps: { unattributed: 0 } });
  const panel = page.getByTestId('model-provenance');
  await expect(panel).toContainText('Provenance unavailable on this server.');
  await expect(panel.locator('[role="alert"]')).toHaveCount(0);
});
