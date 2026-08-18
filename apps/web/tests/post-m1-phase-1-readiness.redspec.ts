import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

test('post-m1-p1-c1a: fixture cold launch declares readiness before exposing application routes', async ({ page }) => {
  // Regression caught: fixture startup can render a live/auth-looking shell or make a live request
  // before the deterministic fixture gate is truthful; the receipt/network assertions fail.
  const boundaryRequests: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) boundaryRequests.push(request.url());
  });

  await openFixture(page);

  await expect(page.getByTestId('environment-receipt')).toHaveText(
    'Environment: Fixture · deterministic local data · no network',
  );
  await expect(page.getByRole('navigation', { name: 'Product destinations' })).toBeVisible();
  await expect(page.locator('#main-content')).toBeVisible();
  expect(boundaryRequests).toEqual([]);
});
