import { expect, test, type Page, type Route } from '@playwright/test';

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

async function json(route: Route, status: number, value: unknown) {
  await route.fulfill({ status, headers: cors, json: value });
}

async function openDashboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', { configurable: true, value: Object.freeze({
      version: 8,
      gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097' }),
      auth: Object.freeze({ signInWithGoogle: async () => ({ sessionToken: 'phase-8-import-token', user: { id: 81, name: 'Avery Owner', email: 'avery@example.test', role: 'admin', artifactTabIds: [] } }) }),
    }) });
  });
  await page.route('http://127.0.0.1:4097/**', (route) => json(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(route.request().url());
    if (url.pathname === '/health') return json(route, 200, { healthy: true });
    if (url.pathname === '/live-artifacts' && route.request().method() === 'GET') return json(route, 200, [existingArtifact]);
    return json(route, 404, { error: { code: 'NOT_FOUND' } });
  });
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('page-dashboard')).toBeVisible();
}

test('post-m1-p8-c5a: local HTML import validates format, bytes, UTF-8, title preview, source preservation, and warnings', async ({ page }) => {
  // Regression caught: import accepts the wrong extension/encoding/size, rewrites source, or skips
  // the security warning; the corresponding alert, title, source, or warning assertion fails.
  await openDashboard(page);
  await page.getByRole('button', { name: /import html/i }).click();
  const input = page.locator('input[type="file"][accept*=".html"]');
  const source = '<!doctype html><html><head><title>Imported Service Plan</title></head><body><img src="https://example.invalid/a.png"><iframe src="https://example.invalid"></iframe><video src="media.mp4"></video><main>Keep every byte</main></body></html>';
  await input.setInputFiles({ name: 'fallback-name.html', mimeType: 'text/html', buffer: Buffer.from(source, 'utf8') });
  const preview = page.getByRole('dialog', { name: /import html/i });
  await expect(preview.getByLabel(/title/i)).toHaveValue('Imported Service Plan');
  await expect(preview.getByTestId('html-import-source')).toHaveText(source);
  await expect(preview.getByRole('alert')).toContainText(/external resources/i);
  await expect(preview.getByRole('alert')).toContainText(/network/i);
  await expect(preview.getByRole('alert')).toContainText(/frames/i);
  await expect(preview.getByRole('alert')).toContainText(/media/i);
  await preview.getByRole('button', { name: /cancel/i }).click();

  for (const probe of [
    { name: 'not-html.txt', mimeType: 'text/plain', buffer: Buffer.from('<title>Wrong extension</title>'), error: /html or htm/i },
    { name: 'too-large.html', mimeType: 'text/html', buffer: Buffer.alloc(900 * 1024 + 1, 0x61), error: /900\s*KiB/i },
    { name: 'invalid-utf8.htm', mimeType: 'text/html', buffer: Buffer.from([0xc3, 0x28]), error: /UTF-8/i },
  ]) {
    await page.getByRole('button', { name: /import html/i }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: probe.name, mimeType: probe.mimeType, buffer: probe.buffer });
    await expect(page.getByRole('alert')).toContainText(probe.error);
    await expect(page.getByRole('button', { name: /confirm import/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});
