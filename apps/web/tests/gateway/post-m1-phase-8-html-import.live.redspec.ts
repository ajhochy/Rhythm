import { expect, test, type Page, type Route } from '@playwright/test';

const importedId = '00000000-0000-4000-8000-000000000822';
const existingArtifact = {
  id: '00000000-0000-4000-8000-000000000821', type: 'html', title: 'Existing artifact', ownerUserId: 81,
  workspaceId: 8, visibility: 'private', currentBundleRevision: 1, currentBundleHash: 'bundle-1',
  currentStateRevision: 1, currentStateHash: 'state-1', declaredCapabilities: [], createdAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z', updatedByDisplayName: 'Avery Owner', deletedAt: null,
};
const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4378',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

test('post-m1-p8-c5b: confirmed import creates one canonical private artifact, then opens and persists its stable id', async ({ page }) => {
  // Regression caught: preview mutates before confirmation, create uses display vocabulary, or the
  // returned stable ID is not opened/persisted; no-mutation and exact-body assertions fail.
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  let artifactCount = 0;
  await page.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', { configurable: true, value: Object.freeze({
      version: 8,
      gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097' }),
      auth: Object.freeze({ signInWithGoogle: async () => ({ sessionToken: 'phase-8-import-token', user: { id: 81, name: 'Avery Owner', email: 'avery@example.test', role: 'admin', artifactTabIds: [] } }) }),
    }) });
  });
  await page.route('http://127.0.0.1:4097/**', (route) => route.fulfill({ status: 200, headers: cors, json: { healthy: true } }));
  await page.route('http://127.0.0.1:4098/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/health') return route.fulfill({ status: 200, headers: cors, json: { healthy: true } });
    if (url.pathname === '/live-artifacts' && request.method() === 'GET') return route.fulfill({ status: 200, headers: cors, json: [existingArtifact] });
    if (url.pathname === '/live-artifacts' && request.method() === 'POST') {
      artifactCount += 1;
      requests.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
      return route.fulfill({ status: 201, headers: cors, json: { ...existingArtifact, id: importedId, title: 'Imported board' } });
    }
    if (url.pathname === '/users/me/preferences' && request.method() === 'PATCH') {
      requests.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
      return route.fulfill({ status: 200, headers: cors, json: { id: 81, artifactTabIds: [importedId] } });
    }
    if (url.pathname === `/live-artifacts/${importedId}`) return route.fulfill({ status: 200, headers: cors, json: { ...existingArtifact, id: importedId, title: 'Imported board', state: {} } });
    if (url.pathname === `/live-artifacts/${importedId}/render`) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/html' }, body: '<main>Imported source</main>' });
    return route.fulfill({ status: 404, headers: cors, json: { error: { code: 'NOT_FOUND' } } });
  });
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('page-dashboard')).toBeVisible();

  const source = '<!doctype html><title>Imported board</title><main>Imported source</main>';
  await page.getByRole('button', { name: /import html/i }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'imported-board.html', mimeType: 'text/html', buffer: Buffer.from(source) });
  expect(artifactCount).toBe(0);
  await page.getByRole('dialog', { name: /import html/i }).getByRole('button', { name: /cancel/i }).click();
  expect(artifactCount).toBe(0);

  await page.getByRole('button', { name: /import html/i }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'imported-board.html', mimeType: 'text/html', buffer: Buffer.from(source) });
  await page.getByRole('dialog', { name: /import html/i }).getByRole('button', { name: /confirm import/i }).click();
  await expect.poll(() => requests).toContainEqual({
    method: 'POST',
    path: '/live-artifacts',
    body: { type: 'html', title: 'Imported board', workspaceId: 8, visibility: 'private', bundle: { html: source, css: '', js: '' }, state: {} },
  });
  await expect.poll(() => requests).toContainEqual({ method: 'PATCH', path: '/users/me/preferences', body: { artifactTabIds: [importedId] } });
  await expect(page.getByRole('tab', { name: 'Imported board' })).toHaveAttribute('data-artifact-id', importedId);
  await expect(page.getByRole('tab', { name: 'Imported board' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: /import html/i }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  expect(artifactCount).toBe(1);
  await page.keyboard.press('Escape');
});
