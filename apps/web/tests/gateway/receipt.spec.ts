import { expect, test } from '@playwright/test';

test('slice-2-c6: default composition renders an accessible Fixture receipt without live traffic', async ({ page }) => {
  // Regression caught: fixture pages render without disclosing their environment or probe live services.
  const liveRequests: string[] = [];
  page.on('request', (request) => {
    if (/127\.0\.0\.1:409[78]/.test(request.url())) liveRequests.push(request.url());
  });
  await page.goto('/#/agents');
  const receipt = page.getByRole('status', { name: 'Environment receipt' });
  await expect(receipt).toContainText('Fixture');
  expect(liveRequests).toEqual([]);
});
