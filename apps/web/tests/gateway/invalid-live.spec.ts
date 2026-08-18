import { expect, test } from '@playwright/test';

test('slice-2-c5-ui: invalid requested-live startup renders a fatal error instead of fixtures', async ({ page }) => {
  // Regression caught: main catches invalid live config by silently mounting the fixture application.
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Live gateway could not start');
  await expect(page.getByRole('alert')).toContainText('Live configuration');
  await expect(page.getByText('Environment: Fixture')).toHaveCount(0);
});
