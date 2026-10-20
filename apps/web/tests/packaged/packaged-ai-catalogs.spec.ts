import { test, expect } from './feature-test';
import { aiSurfaces, openAiSurface, readAiCollection, assertAiRows } from './ai-surfaces';

for (const surface of aiSurfaces) {
  test(`[AI catalog:${surface.slug}] real collection renders and survives reload`, async ({ page }) => {
    // Catches fixture/demo rows replacing the real collection, or a reload losing persisted data.
    const response = await openAiSurface(page, surface);
    await assertAiRows(page, surface, await readAiCollection(response, surface), response);
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === surface.endpoint && r.request().method() === 'GET', { timeout: 60_000 });
    await page.reload();
    const reloaded = await pending;
    await assertAiRows(page, surface, await readAiCollection(reloaded, surface), reloaded);
  });

  test(`[AI catalog:${surface.slug}] unavailable backend is visible and a real reload recovers`, async ({ page }) => {
    // Catches outages represented as healthy empty lists, and errors that survive a successful retry.
    const pattern = new RegExp(surface.endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\?.*)?$');
    let injected = false;
    const handler = async (route: import('@playwright/test').Route) => {
      if (!injected && route.request().method() === 'GET') {
        injected = true;
        await route.fulfill({ status: 503, json: { error: { code: 'SMOKE_UNAVAILABLE', message: '[smoke] catalog unavailable' } } });
      } else await route.fallback();
    };
    await page.route(pattern, handler);
    try {
      const failed = await openAiSurface(page, surface);
      expect(failed.status()).toBe(503);
      const workspace = page.getByTestId(`tool-page-${surface.slug}`);
      await expect(workspace.getByTestId(surface.error)).toBeVisible();
      await expect(workspace.getByRole('heading', { name: surface.empty, exact: true })).toHaveCount(0);
    } finally { await page.unroute(pattern, handler); }
    const recovered = await openAiSurface(page, surface);
    await assertAiRows(page, surface, await readAiCollection(recovered, surface), recovered);
  });
}
