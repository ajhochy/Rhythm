import { expect, test, type Page, type Route } from '@playwright/test';

const artifactId = '00000000-0000-4000-8000-000000000811';
const secondArtifactId = '00000000-0000-4000-8000-000000000812';
const apiBase = 'http://127.0.0.1:4098';
const artifact = {
  id: artifactId,
  type: 'html',
  title: 'Phase 8 Operations Board',
  ownerUserId: 81,
  workspaceId: 8,
  visibility: 'shared',
  currentBundleRevision: 7,
  currentBundleHash: 'bundle-seven',
  currentStateRevision: 5,
  currentStateHash: 'state-five',
  declaredCapabilities: ['pco.services.read'],
  createdAt: '2026-08-14T18:00:00.000Z',
  updatedAt: '2026-08-15T18:30:00.000Z',
  updatedByDisplayName: 'Avery Owner',
  deletedAt: null,
};
// Owned by a different workspace member (82) but 'shared' visibility, so it belongs in the owner's
// (81) picker catalog alongside `artifact` — both are workspace 8. Only the by-id GET handler had
// this defined before; the general catalog GET never included it, so the picker's "Viewer artifact"
// option (asserted by post-m1-p8-c1d) could never appear no matter what the product code did.
const secondArtifact = { ...artifact, id: secondArtifactId, title: 'Viewer artifact', ownerUserId: 82, state: {} };
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4378',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

async function fulfillJson(route: Route, status: number, value: unknown) {
  await route.fulfill({ status, headers: cors, json: value });
}

async function installAuthBoundary(page: Page) {
  await page.addInitScript(({ first, second }) => {
    const identity = localStorage.getItem('phase8_identity') ?? 'owner';
    const key = identity === 'owner' ? 'phase8_server_tabs_owner' : 'phase8_server_tabs_viewer';
    const fallback = identity === 'owner' ? [first] : [second];
    const artifactTabIds = JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback));
    Object.defineProperty(window, 'rhythmShell', {
      configurable: true,
      value: Object.freeze({
        version: 8,
        gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097' }),
        auth: Object.freeze({
          signInWithGoogle: async () => identity === 'owner'
            ? { sessionToken: 'phase-8-owner-token', user: { id: 81, name: 'Avery Owner', email: 'avery@example.test', role: 'admin', artifactTabIds } }
            : { sessionToken: 'phase-8-viewer-token', user: { id: 82, name: 'Blake Viewer', email: 'blake@example.test', role: 'member', artifactTabIds } },
        }),
      }),
    });
  }, { first: artifactId, second: secondArtifactId });
}

async function openLiveDashboard(page: Page, handler?: (route: Route) => Promise<boolean> | boolean) {
  await installAuthBoundary(page);
  await page.route('http://127.0.0.1:4097/**', (route) => fulfillJson(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (handler && await handler(route)) return;
    const url = new URL(route.request().url());
    if (url.pathname === '/health') return fulfillJson(route, 200, { healthy: true });
    if (url.pathname === '/live-artifacts' && route.request().method() === 'GET') return fulfillJson(route, 200, [artifact, secondArtifact]);
    if (url.pathname === `/live-artifacts/${artifactId}` && route.request().method() === 'GET') return fulfillJson(route, 200, { ...artifact, state: { selectedPlanId: 'plan-5' } });
    if (url.pathname === `/live-artifacts/${secondArtifactId}` && route.request().method() === 'GET') return fulfillJson(route, 200, secondArtifact);
    if (url.pathname.endsWith('/render')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/html' }, body: '<!doctype html><main id="artifact-content">Phase 8 current bundle</main>' });
    if (url.pathname === '/users/me/preferences' && route.request().method() === 'PATCH') return fulfillJson(route, 200, { artifactTabIds: route.request().postDataJSON().artifactTabIds });
    return fulfillJson(route, 404, { error: { code: 'NOT_FOUND' } });
  });
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('page-dashboard')).toBeVisible();
}

async function selectArtifactTab(page: Page, title = artifact.title) {
  const tab = page.getByRole('tab', { name: title, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test('post-m1-p8-c1a: typed live-artifact gateway uses authenticated canonical catalog, detail, and render routes', async () => {
  // Regression caught: live mode lacks the artifacts domain, omits type=html, guesses a route, or
  // places the bearer in render content; the module/function/request assertions fail.
  const modulePath = '../../src/gateway/live-artifacts.ts';
  const gatewayModule = await import(modulePath).catch(() => null) as null | Record<string, unknown>;
  expect(gatewayModule, 'React must define a typed live-artifacts gateway domain').not.toBeNull();
  if (!gatewayModule) return;
  expect(typeof gatewayModule.createLiveArtifactsGateway).toBe('function');
  const seen: Array<{ url: string; method: string; authorization: string | null }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('authorization') });
    if (String(input).endsWith('/render')) return new Response('<main>rendered</main>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify(String(input).includes(`/${artifactId}`) ? { ...artifact, state: {} } : [artifact]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const create = gatewayModule.createLiveArtifactsGateway as (base: string, token: string, fetcher: typeof fetch) => { list(): Promise<unknown>; get(id: string): Promise<unknown>; render(id: string): Promise<string> };
  const gateway = create(apiBase, 'phase-8-gateway-secret', fetcher);
  await gateway.list();
  await gateway.get(artifactId);
  const rendered = await gateway.render(artifactId);
  expect(seen).toEqual([
    { url: `${apiBase}/live-artifacts?type=html`, method: 'GET', authorization: 'Bearer phase-8-gateway-secret' },
    { url: `${apiBase}/live-artifacts/${artifactId}`, method: 'GET', authorization: 'Bearer phase-8-gateway-secret' },
    { url: `${apiBase}/live-artifacts/${artifactId}/render`, method: 'GET', authorization: 'Bearer phase-8-gateway-secret' },
  ]);
  expect(rendered).not.toContain('phase-8-gateway-secret');
});

test('post-m1-p8-c1d: ordered artifactTabIds restore per identity while Dashboard stays initially selected', async ({ page }) => {
  // Regression caught: tabs use component memory/global storage, select an artifact at startup, or
  // survive an auth-frame change; PATCH order, reload, Dashboard, and identity assertions fail.
  const patches: string[][] = [];
  await openLiveDashboard(page, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/users/me/preferences' && route.request().method() === 'PATCH') {
      const value = route.request().postDataJSON() as { artifactTabIds?: string[] };
      patches.push(value.artifactTabIds ?? []);
      await fulfillJson(route, 200, { id: 81, artifactTabIds: value.artifactTabIds });
      return true;
    }
    return false;
  });
  await expect(page.getByRole('tab', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: artifact.title, exact: true })).toHaveAttribute('data-artifact-id', artifactId);
  await page.getByRole('button', { name: /add live artifact/i }).click();
  await page.getByRole('dialog', { name: /live artifact/i }).getByRole('option', { name: 'Viewer artifact' }).click();
  await expect.poll(() => patches.at(-1)).toEqual([artifactId, secondArtifactId]);

  await page.evaluate(({ first, second }) => localStorage.setItem('phase8_server_tabs_owner', JSON.stringify([first, second])), { first: artifactId, second: secondArtifactId });
  await page.reload();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('tab', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: artifact.title })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Viewer artifact' })).toBeVisible();

  await page.evaluate(() => localStorage.setItem('phase8_identity', 'viewer'));
  await page.reload();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('tab', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: artifact.title })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Viewer artifact' })).toBeVisible();
});

test('post-m1-p8-c1f: current bundle metadata and bounded reload recovery remain bound to one stable id', async ({ page }) => {
  // Regression caught: stale cross-tab content survives reload, provenance/revisions disappear, or
  // 404/410/409/503 collapse into raw errors; metadata and state-specific assertions fail.
  let outcome: 'ready' | 'missing' | 'deleted' | 'conflict' | 'retryable' = 'ready';
  await openLiveDashboard(page, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== `/live-artifacts/${artifactId}` || route.request().method() !== 'GET') return false;
    if (outcome === 'missing') await fulfillJson(route, 404, { error: { code: 'NOT_FOUND' } });
    else if (outcome === 'deleted') await fulfillJson(route, 410, { error: { code: 'artifact_deleted' } });
    else if (outcome === 'conflict') await fulfillJson(route, 409, { error: { code: 'CONFLICT' }, currentStateRevision: 6 });
    else if (outcome === 'retryable') await fulfillJson(route, 503, { error: { code: 'UNAVAILABLE' } });
    else await fulfillJson(route, 200, { ...artifact, state: { selectedPlanId: 'plan-5' } });
    return true;
  });
  await selectArtifactTab(page);
  const surface = page.getByTestId('live-artifact-surface');
  await expect(surface).toContainText(artifact.title);
  await expect(surface).toContainText('Avery Owner');
  await expect(surface).toContainText(/Aug(?:ust)? 15, 2026/i);
  await expect(surface).toContainText(/bundle revision\s*7/i);
  await expect(surface).toContainText(/state revision\s*5/i);
  await expect(surface).toContainText('shared');
  // `sandbox="allow-scripts"` makes the artifact iframe a distinct document — plain
  // `locator('iframe').toContainText(...)` reads the PARENT document's light DOM (always empty for
  // a frame-owner element) and can never see across the frame boundary, regardless of product code.
  // `.contentFrame()` (same API the sibling post-m1-p8-c4g test already uses on this exact testid)
  // is the only way to assert on the rendered document inside.
  const artifactFrame = await surface.locator('iframe').contentFrame();
  await expect(artifactFrame.locator('#artifact-content')).toContainText('Phase 8 current bundle');

  for (const [next, expected] of [
    ['missing', /unavailable/i],
    ['deleted', /deleted/i],
    ['conflict', /conflict/i],
    ['retryable', /try again|retry/i],
  ] as const) {
    outcome = next;
    await surface.getByRole('button', { name: /reload/i }).click();
    await expect(surface.getByRole(next === 'retryable' ? 'alert' : 'status')).toContainText(expected);
    await expect(surface).toHaveAttribute('data-artifact-id', artifactId);
  }
});

test('post-m1-p8-c2b: canonical sharing controls are owner-only and mutate visibility plus numeric collaborators', async ({ page }) => {
  // Regression caught: a non-owner receives controls or UI sends display IDs/guessed visibility;
  // exact PATCH/POST/DELETE bodies or owner-absence assertions fail.
  const mutations: Array<{ method: string; path: string; body: unknown }> = [];
  await openLiveDashboard(page, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/users' && request.method() === 'GET') { await fulfillJson(route, 200, [{ id: 83, name: 'Casey Member', email: 'casey@example.test' }]); return true; }
    if (url.pathname === `/live-artifacts/${artifactId}/collaborators` && request.method() === 'GET') { await fulfillJson(route, 200, []); return true; }
    if (request.method() === 'PATCH' || request.method() === 'POST' || request.method() === 'DELETE') {
      mutations.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
      await fulfillJson(route, request.method() === 'POST' ? 201 : 200, request.method() === 'POST' ? { userId: 83 } : { ...artifact, visibility: 'organization' });
      return true;
    }
    return false;
  });
  await selectArtifactTab(page);
  await page.getByRole('button', { name: /sharing/i }).click();
  const dialog = page.getByRole('dialog', { name: /sharing/i });
  await dialog.getByLabel(/visibility/i).selectOption('organization');
  await dialog.getByRole('searchbox', { name: /workspace user/i }).fill('Casey');
  await dialog.getByRole('option', { name: /Casey Member/ }).click();
  await expect.poll(() => mutations).toContainEqual({ method: 'PATCH', path: `/live-artifacts/${artifactId}`, body: { visibility: 'organization' } });
  await expect.poll(() => mutations).toContainEqual({ method: 'POST', path: `/live-artifacts/${artifactId}/collaborators`, body: { userId: 83 } });
  await dialog.getByRole('button', { name: /remove Casey Member/i }).click();
  await expect.poll(() => mutations.map(({ method, path }) => `${method} ${path}`)).toContain(`DELETE /live-artifacts/${artifactId}/collaborators/83`);

  await page.evaluate(() => {
    localStorage.setItem('phase8_identity', 'viewer');
    localStorage.setItem('phase8_server_tabs_viewer', JSON.stringify(['00000000-0000-4000-8000-000000000811']));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await selectArtifactTab(page);
  await expect(page.getByRole('button', { name: /sharing/i })).toHaveCount(0);
});

test('post-m1-p8-c4g: pco.services.read is declared, exact-shape, current-viewer bound, and bounded', async ({ page }) => {
  // Regression caught: the bridge dispatches undeclared or broad PCO payloads, uses the owner's
  // account, or leaks arbitrary errors; exact request and rejection-count assertions fail.
  const capabilityBodies: unknown[] = [];
  await openLiveDashboard(page, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== `/live-artifacts/${artifactId}/capabilities/pco.services.read`) return false;
    capabilityBodies.push(request.postDataJSON());
    await fulfillJson(route, 200, { operation: (request.postDataJSON() as { operation: string }).operation, data: [] });
    return true;
  });
  await selectArtifactTab(page);
  // `Locator.contentFrame()` returns a `FrameLocator`, which has no `.evaluate()` — only a real
  // `Frame` (obtained via `ElementHandle.contentFrame()`) supports running code inside the artifact
  // document, which this test needs to call `window.rhythm.request(...)` below.
  const frameHandle = await page.getByTestId('live-artifact-frame').elementHandle();
  const frame = await frameHandle?.contentFrame();
  expect(frame, 'selected artifact must render in an isolated child frame').not.toBeNull();
  if (!frame) return;
  await expect(frame.locator('#artifact-content')).toBeVisible();
  await frame.evaluate(async () => {
    const rhythm = (window as unknown as { rhythm: { request(method: string, params: unknown): Promise<unknown> } }).rhythm;
    await rhythm.request('pco.services.read', { operation: 'list_service_types' });
    await rhythm.request('pco.services.read', { operation: 'list_plans', serviceTypeId: 'service-1', filter: 'future' });
    await rhythm.request('pco.services.read', { operation: 'list_plan_items', serviceTypeId: 'service-1', planId: 'plan-1' });
  });
  expect(capabilityBodies).toEqual([
    { operation: 'list_service_types' },
    { operation: 'list_plans', serviceTypeId: 'service-1', filter: 'future' },
    { operation: 'list_plan_items', serviceTypeId: 'service-1', planId: 'plan-1' },
  ]);
  const before = capabilityBodies.length;
  await expect(frame.evaluate(async () => {
    const rhythm = (window as unknown as { rhythm: { request(method: string, params: unknown): Promise<unknown> } }).rhythm;
    await rhythm.request('pco.services.read', { operation: 'list_plans', serviceTypeId: 'service-1', filter: 'all', url: 'https://example.invalid' });
  })).rejects.toThrow();
  expect(capabilityBodies).toHaveLength(before);
});
