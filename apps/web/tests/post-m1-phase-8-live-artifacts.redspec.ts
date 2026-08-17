import { expect, test, type Page, type Route } from '@playwright/test';

const firstId = '00000000-0000-4000-8000-000000000801';
const secondId = '00000000-0000-4000-8000-000000000802';
const longId = '00000000-0000-4000-8000-000000000803';
const artifacts = [
  { id: firstId, type: 'html', title: 'Sunday Service Dashboard', ownerUserId: 81, workspaceId: 8, visibility: 'private', currentBundleRevision: 2, currentBundleHash: 'bundle-2', currentStateRevision: 4, currentStateHash: 'state-4', declaredCapabilities: [], createdAt: '2026-08-14T18:00:00.000Z', updatedAt: '2026-08-15T18:30:00.000Z', updatedByDisplayName: 'Avery Owner', deletedAt: null },
  { id: secondId, type: 'html', title: 'Volunteer Handoff', ownerUserId: 81, workspaceId: 8, visibility: 'shared', currentBundleRevision: 1, currentBundleHash: 'bundle-1', currentStateRevision: 1, currentStateHash: 'state-1', declaredCapabilities: [], createdAt: '2026-08-14T18:00:00.000Z', updatedAt: '2026-08-15T18:00:00.000Z', updatedByDisplayName: 'Avery Owner', deletedAt: null },
  { id: longId, type: 'html', title: 'An intentionally very long live artifact title that must be visually ellipsized while retaining its complete accessible name', ownerUserId: 81, workspaceId: 8, visibility: 'organization', currentBundleRevision: 1, currentBundleHash: 'bundle-long', currentStateRevision: 1, currentStateHash: 'state-long', declaredCapabilities: [], createdAt: '2026-08-14T18:00:00.000Z', updatedAt: '2026-08-15T17:30:00.000Z', updatedByDisplayName: null, deletedAt: null },
];

const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4378',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

async function json(route: Route, status: number, value: unknown) {
  await route.fulfill({ status, headers: cors, json: value });
}

async function installAuthenticatedHost(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', {
      configurable: true,
      value: Object.freeze({
        version: 8,
        gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097' }),
        auth: Object.freeze({
          signInWithGoogle: async () => ({
            sessionToken: 'phase-8-owner-token',
            user: { id: 81, name: 'Avery Owner', email: 'avery@example.test', role: 'admin', artifactTabIds: [] },
          }),
        }),
      }),
    });
  });
}

async function openDashboard(page: Page, onApi?: (route: Route) => Promise<boolean> | boolean) {
  await installAuthenticatedHost(page);
  await page.route('http://127.0.0.1:4097/**', (route) => json(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (onApi && await onApi(route)) return;
    const url = new URL(route.request().url());
    if (url.pathname === '/health') return json(route, 200, { healthy: true });
    if (url.pathname === '/live-artifacts' && route.request().method() === 'GET') return json(route, 200, artifacts);
    const artifact = artifacts.find(({ id }) => url.pathname === `/live-artifacts/${id}`);
    if (artifact && route.request().method() === 'GET') return json(route, 200, { ...artifact, state: { ready: true } });
    if (url.pathname.endsWith('/render')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/html' }, body: '<!doctype html><main>Rendered artifact</main>' });
    if (url.pathname === '/users/me/preferences' && route.request().method() === 'PATCH') return json(route, 200, { id: 81, artifactTabIds: [] });
    return json(route, 404, { error: { code: 'NOT_FOUND' } });
  });
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('page-dashboard')).toBeVisible();
}

async function openArtifact(page: Page, title: string) {
  await page.getByRole('button', { name: /add live artifact/i }).click();
  const picker = page.getByRole('dialog', { name: /live artifact/i });
  await picker.getByRole('option', { name: title, exact: true }).click();
  await expect(page.getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true');
}

test('post-m1-p8-c1b: Dashboard is fixed while stable artifact tabs open, select, and close without deletion', async ({ page }) => {
  // Regression caught: the planning Dashboard is replaced, tab identity uses titles, or closing a
  // tab deletes its artifact; fixed-tab, selected-ID, neighbor, or no-DELETE assertions fail.
  const requests: string[] = [];
  await openDashboard(page, (route) => { requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); return false; });
  const tablist = page.getByRole('tablist', { name: /dashboard artifacts/i });
  await expect(tablist.getByRole('tab', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-selected', 'true');
  await openArtifact(page, artifacts[0].title);
  await expect(page.getByRole('tab', { name: artifacts[0].title })).toHaveAttribute('data-artifact-id', firstId);
  await openArtifact(page, artifacts[1].title);
  await page.getByRole('tab', { name: artifacts[1].title }).getByRole('button', { name: /close/i }).click();
  await expect(page.getByRole('tab', { name: artifacts[0].title })).toHaveAttribute('aria-selected', 'true');
  expect(requests).not.toContain(`DELETE /live-artifacts/${secondId}`);
  await expect(page.getByTestId('page-dashboard')).toBeAttached();
});

test('post-m1-p8-c1c: the HTML picker exposes canonical search and the complete bounded state matrix', async ({ page }) => {
  // Regression caught: picker filtering is local guesswork or loading/empty/no-match/error/retry is
  // conflated; the corresponding role, clear-search, or retry assertion fails.
  let catalog: 'success' | 'empty' | 'error' | 'delayed' = 'success';
  await openDashboard(page, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/live-artifacts' || route.request().method() !== 'GET') return false;
    if (catalog === 'delayed') await new Promise((resolve) => setTimeout(resolve, 250));
    if (catalog === 'error') { await json(route, 503, { error: { code: 'UNAVAILABLE' } }); return true; }
    await json(route, 200, catalog === 'empty' ? [] : artifacts);
    return true;
  });
  const add = page.getByRole('button', { name: /add live artifact/i });
  await add.click();
  const picker = page.getByRole('dialog', { name: /live artifact/i });
  const search = picker.getByRole('searchbox', { name: /search/i });
  await search.fill('Volunteer');
  await expect(picker.getByRole('option', { name: artifacts[1].title })).toBeVisible();
  await expect(picker.getByRole('option', { name: artifacts[0].title })).toHaveCount(0);
  await search.fill('no canonical title matches this');
  await expect(picker.getByText(/no matching live artifacts/i)).toBeVisible();
  await picker.getByRole('button', { name: /clear search/i }).click();
  await expect(search).toHaveValue('');
  await page.keyboard.press('Escape');

  catalog = 'empty';
  await add.click();
  await expect(page.getByRole('dialog', { name: /live artifact/i }).getByText(/no html live artifacts/i)).toBeVisible();
  await page.keyboard.press('Escape');
  catalog = 'error';
  await add.click();
  const errorDialog = page.getByRole('dialog', { name: /live artifact/i });
  await expect(errorDialog.getByRole('alert')).toContainText(/could not load/i);
  catalog = 'success';
  await errorDialog.getByRole('button', { name: /retry/i }).click();
  await expect(errorDialog.getByRole('option', { name: artifacts[0].title })).toBeVisible();
});

test('post-m1-p8-c1e: artifact tabs preserve overflow reachability and complete keyboard/focus semantics', async ({ page }) => {
  // Regression caught: overflow hides Add, accessible names truncate with CSS, roving focus stops at
  // an edge, or close/Escape loses focus; one focus, name, or reachability assertion fails.
  await openDashboard(page);
  await openArtifact(page, artifacts[0].title);
  await openArtifact(page, artifacts[1].title);
  await openArtifact(page, artifacts[2].title);
  const tabs = page.getByRole('tablist', { name: /dashboard artifacts/i });
  const dashboard = tabs.getByRole('tab', { name: 'Dashboard', exact: true });
  const longTab = tabs.getByRole('tab', { name: artifacts[2].title, exact: true });
  await expect(longTab).toHaveAccessibleName(artifacts[2].title);
  expect(await longTab.evaluate((element) => getComputedStyle(element).textOverflow)).toBe('ellipsis');
  const add = page.getByRole('button', { name: /add live artifact/i });
  await expect(add).toBeVisible();
  await longTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dashboard).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(longTab).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(tabs.getByRole('tab', { name: artifacts[1].title })).toBeFocused();
  await add.click();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await tabs.getByRole('tab', { name: artifacts[1].title }).focus();
  await page.keyboard.press('Backspace');
  await expect(tabs.getByRole('tab', { name: artifacts[0].title })).toBeFocused();
});
