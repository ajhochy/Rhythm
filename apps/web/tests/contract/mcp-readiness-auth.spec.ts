import { expect, test, type Page, type Route } from '@playwright/test';

test.skip(process.env.RHYTHM_MCP_READINESS_CONTRACT !== '1', 'Run with mcp-readiness-auth.config.ts');

const API = 'http://127.0.0.1:7594';
const ENGINE = 'http://127.0.0.1:7595';
const token = 'mcp-readiness-disposable';
const tools = Array.from({ length: 114 }, (_, index) => `rhythm_tool_${index}`);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ API, ENGINE, token }) => {
    Object.defineProperty(window, 'rhythmShell', { value: Object.freeze({
      gateway: { apiBase: API, engineBase: ENGINE, productionApiBase: 'https://api.vcrcapps.com' },
      auth: { currentSession: async () => ({ sessionToken: token, user: {
        id: 1, name: 'Readiness Fixture', email: 'readiness@example.invalid', role: 'admin', artifactTabIds: [],
      } }) },
    }) });
  }, { API, ENGINE, token });
  await page.routeWebSocket(/.*/, socket => socket.close());
});

async function exerciseReadiness(page: Page, transient: 'configured' | '503', unmountBeforeEnsure = false) {
  let releaseEnsure!: () => void;
  const ensureCanFinish = new Promise<void>(resolve => { releaseEnsure = resolve; });
  let ensureStarted!: () => void;
  const ensureSeen = new Promise<void>(resolve => { ensureStarted = resolve; });
  let ready = false;
  let transientReads = 0;
  let settledReads = 0;
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (![API, ENGINE, 'https://api.vcrcapps.com'].includes(url.origin)) return route.continue();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.origin === API && url.pathname === '/opencode/mcp/rhythm/ensure' && request.method() === 'POST') {
      expect((await request.allHeaders()).authorization).toBe(`Bearer ${token}`);
      ensureStarted();
      await ensureCanFinish;
      ready = true;
      return route.fulfill({ status: 200, headers, json: { changed: false, registered: true } });
    }
    if (url.origin === API && url.pathname === '/opencode/mcp' && request.method() === 'GET') {
      // Ordinary local reads use AGENT_LOCAL; the authenticated ensure POST
      // above is the request carrying the signed-in bearer.
      expect((await request.allHeaders()).authorization).toBeUndefined();
      if (!ready) {
        transientReads++;
        return transient === '503'
          ? route.fulfill({ status: 503, headers, json: { error: { code: 'MCP_CATALOG_UNAVAILABLE', message: 'Rhythm MCP tool catalog is not ready' } } })
          : route.fulfill({ status: 200, headers, json: [{ name: 'rhythm', status: 'configured', error: null, source: 'rhythm', tools: [], requiredEnv: [], needsCredentials: false }] });
      }
      settledReads++;
      return route.fulfill({ status: 200, headers, json: [{ name: 'rhythm', status: 'connected', error: null, source: 'rhythm', tools, requiredEnv: [], needsCredentials: false }] });
    }
    const json: unknown = url.pathname === '/health' ? { healthy: true, status: 'ready' }
      : url.pathname === '/opencode/auth/accounts' ? { accounts: [] }
      : url.pathname === '/opencode/auth/openai/accounts' ? { accounts: [] }
      : url.pathname === '/opencode/auth' ? { providers: [] }
      : [];
    return route.fulfill({ status: 200, headers, json });
  });

  try {
    await page.goto('/#/tools/agent-settings?settingsSection=mcp');
    await ensureSeen;
    // A ready-gated implementation may avoid the transient GET entirely. The
    // current renderer issues it before ensure settles and then keeps its result.
    await page.waitForTimeout(250);
    if (unmountBeforeEnsure) {
      await page.getByRole('button', { name: 'Back to Agents' }).click();
      await expect(page.getByTestId('agent-settings-mcp-status-rhythm')).toHaveCount(0);
      const readsBefore = transientReads + settledReads;
      const settled = page.waitForResponse(response => response.url() === `${API}/opencode/mcp/rhythm/ensure`);
      releaseEnsure();
      await settled;
      await page.waitForTimeout(250);
      expect(transientReads + settledReads, 'unmounted inspector fetched MCP after ensure').toBe(readsBefore);
      return { transientReads, settledReads };
    }
    releaseEnsure();
    await expect(page.getByTestId('agent-settings-mcp-status-rhythm')).toHaveText('Connected', { timeout: 4_000 });
    await expect(page.getByTestId('agent-settings-mcp-rhythm')).toContainText('114 tools');
    expect(settledReads, 'inspector never read the catalog after authentication settled').toBeGreaterThan(0);
    return { transientReads, settledReads };
  } finally {
    releaseEnsure();
  }
}

for (const transient of ['configured', '503'] as const) {
  test(`authenticated MCP inspector converges automatically after transient ${transient}`, async ({ page }) => {
    await exerciseReadiness(page, transient);
  });
}

test('leaving MCP settings while ensure is pending cancels the later inspector read', async ({ page }) => {
  await exerciseReadiness(page, 'configured', true);
});

test('failed ensure exposes Retry and a fresh ensure precedes the connected catalog', async ({ page }) => {
  let releaseFirst!: () => void;
  const firstMayFinish = new Promise<void>(resolve => { releaseFirst = resolve; });
  let firstStarted!: () => void;
  const firstSeen = new Promise<void>(resolve => { firstStarted = resolve; });
  let attempts = 0;
  let catalogReads = 0;
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (![API, ENGINE, 'https://api.vcrcapps.com'].includes(url.origin)) return route.continue();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.origin === API && url.pathname === '/opencode/mcp/rhythm/ensure' && request.method() === 'POST') {
      expect((await request.allHeaders()).authorization).toBe(`Bearer ${token}`);
      attempts++;
      if (attempts === 1) {
        firstStarted();
        await firstMayFinish;
        return route.fulfill({ status: 502, headers, json: { error: 'fixture ensure failed' } });
      }
      return route.fulfill({ status: 200, headers, json: { changed: true, registered: true } });
    }
    if (url.origin === API && url.pathname === '/opencode/mcp' && request.method() === 'GET') {
      catalogReads++;
      if (attempts < 2) return route.fulfill({ status: 503, headers, json: { error: { code: 'MCP_CATALOG_UNAVAILABLE', message: 'Rhythm MCP tool catalog is not ready' } } });
      return route.fulfill({ status: 200, headers, json: [{ name: 'rhythm', status: 'connected', error: null, source: 'rhythm', tools, requiredEnv: [], needsCredentials: false }] });
    }
    return route.fulfill({ status: 200, headers, json: url.pathname === '/health' ? { healthy: true, status: 'ready' } : [] });
  });
  try {
    await page.goto('/#/tools/agent-settings?settingsSection=mcp');
    await firstSeen;
    expect(catalogReads, 'MCP catalog fetched while first ensure was pending').toBe(0);
    releaseFirst();
    const retry = page.getByRole('button', { name: 'Retry MCP servers' });
    await expect(retry).toBeVisible();
    expect(catalogReads, 'MCP catalog fetched after failed ensure before Retry').toBe(0);
    await retry.click();
    await expect(page.getByTestId('agent-settings-mcp-status-rhythm')).toHaveText('Connected');
    await expect(page.getByTestId('agent-settings-mcp-rhythm')).toContainText('114 tools');
    expect(attempts).toBe(2);
    expect(catalogReads).toBeGreaterThan(0);
  } finally {
    releaseFirst();
  }
});

test('leaving Profiles while ensure is pending cancels its later MCP catalog read', async ({ page }) => {
  let releaseEnsure!: () => void;
  const ensureCanFinish = new Promise<void>(resolve => { releaseEnsure = resolve; });
  let ensureStarted!: () => void;
  const ensureSeen = new Promise<void>(resolve => { ensureStarted = resolve; });
  let catalogReads = 0;
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (![API, ENGINE, 'https://api.vcrcapps.com'].includes(url.origin)) return route.continue();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.origin === API && url.pathname === '/opencode/mcp/rhythm/ensure' && request.method() === 'POST') {
      ensureStarted();
      await ensureCanFinish;
      return route.fulfill({ status: 200, headers, json: { changed: false, registered: true } });
    }
    if (url.origin === API && url.pathname === '/opencode/mcp' && request.method() === 'GET') {
      catalogReads++;
      return route.fulfill({ status: 200, headers, json: [{ name: 'rhythm', status: 'connected', error: null, source: 'rhythm', tools, requiredEnv: [], needsCredentials: false }] });
    }
    return route.fulfill({ status: 200, headers, json: url.pathname === '/health' ? { healthy: true, status: 'ready' } : [] });
  });
  try {
    await page.goto('/#/profiles');
    await ensureSeen;
    await expect(page.getByTestId('profiles-workspace')).toBeVisible();
    expect(catalogReads, 'Profiles fetched MCP before authenticated ensure settled').toBe(0);
    await page.getByTestId('profiles-back').click();
    await expect(page.getByTestId('profiles-workspace')).toHaveCount(0);
    const settled = page.waitForResponse(response => response.url() === `${API}/opencode/mcp/rhythm/ensure`);
    releaseEnsure();
    await settled;
    await page.waitForTimeout(250);
    expect(catalogReads, 'unmounted Profiles fetched MCP after ensure').toBe(0);
  } finally {
    releaseEnsure();
  }
});
