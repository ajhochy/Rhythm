import { test, expect, reloadJsonFor } from './parity-fixture';
import { aiSurfaces, openAiSurface, readAiCollection, assertAiRows } from './parity-ai-surfaces';

for (const [index, surface] of aiSurfaces.entries()) {
  test(`#${9 + index}: [AI catalog:${surface.slug}] real collection renders and survives reload`, async ({ page, parity }) => {
    // Catches fixture/demo rows replacing the real collection, or a reload losing persisted data.
    const response = await openAiSurface(page, surface);
    await assertAiRows(page, surface, await readAiCollection(response, surface), response, parity);
    const { response: reloaded, body } = await reloadJsonFor<unknown>(page, surface.endpoint, parity.origin);
    expect(reloaded.request().method()).toBe('GET');
    expect(new URL(reloaded.url()).pathname).toBe(surface.endpoint);
    expect(reloaded.status(), `${surface.slug} collection failed after reload`).toBe(200);
    const rows = surface.collection ? (body as Record<string, unknown>)[surface.collection] : body;
    expect(Array.isArray(rows), `${surface.slug} response schema drift after reload`).toBe(true);
    await assertAiRows(page, surface, rows as import('./parity-ai-surfaces').AiRow[], reloaded, parity);
  });

  test(`#${18 + index}: [AI catalog:${surface.slug}] unavailable backend is visible and a real reload recovers`, async ({ page, parity }) => {
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
    await assertAiRows(page, surface, await readAiCollection(recovered, surface), recovered, parity);
  });
}
