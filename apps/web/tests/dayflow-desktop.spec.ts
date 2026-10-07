import { expect, test } from '@playwright/test';

test('Dayflow companion panels request only readiness on mount and launch only on user action', async ({ page }) => {
  await page.goto('/tests/dayflow-desktop-harness.html');
  await expect(page.getByTestId('dayflow-native-readiness')).toContainText('Native app ready');
  expect(await page.evaluate(() => (window as typeof window & { __dayflowDesktop: string[] }).__dayflowDesktop)).toEqual(['status']);
  await page.getByTestId('dayflow-open-native').click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __dayflowDesktop: string[] }).__dayflowDesktop)).toEqual(['status', 'open']);
  await expect(page.getByText(/Timeline, capture, providers, and privacy stay in Dayflow/)).toBeVisible();
  await expect(page.getByText('The original Dayflow screens appear below.', { exact: true })).toBeVisible();
});

test('unmounted Dayflow companion status does not update stale UI', async ({ page }) => {
  await page.goto('/tests/dayflow-desktop-harness.html?delayed=1');
  await page.waitForTimeout(75);
  await expect(page.locator('#root')).toBeEmpty();
  expect(await page.evaluate(() => (window as typeof window & { __dayflowDesktop: string[] }).__dayflowDesktop)).toEqual(['status']);
});
