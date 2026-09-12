import { expect, test } from '@playwright/test';
test('E40/E44: rendered Settings performs admin/preference actions and shows version/update', async ({ page }) => {
  await page.goto('/tests/electron-e40-harness.html'); await expect(page.getByTestId('page-settings')).toBeVisible(); await expect(page.getByText('Version: 9.9.9-test')).toBeVisible();
  await page.getByRole('button', { name: 'Regenerate join code' }).click(); await expect(page.getByText(/Join code: NEW/)).toBeVisible();
  await page.getByLabel('Role for Casey').selectOption('admin'); await expect.poll(() => page.evaluate(() => (window as any).__e40.some((call: any[]) => call[0] === 'role'))).toBe(true);
  await page.getByLabel('Facilities manager').nth(1).click(); await expect.poll(() => page.evaluate(() => (window as any).__e40.some((call: any[]) => call[0] === 'user'))).toBe(true);
  await page.getByRole('button', { name: 'Remove' }).click(); await expect.poll(() => page.evaluate(() => (window as any).__e40.some((call: any[]) => call[0] === 'remove'))).toBe(true);
  await page.getByLabel('Email notifications').uncheck(); await page.getByRole('button', { name: 'Check Rhythm releases' }).click();
  const calls = await page.evaluate(() => (window as any).__e40);
  expect(calls).toEqual(expect.arrayContaining([['role', 2, 'admin'], ['user', 2, { isFacilitiesManager: true }], ['remove', 2], ['preferences', { emailNotificationsEnabled: false }], ['update']]));
  await page.getByLabel('Send message key').fill('Meta+Enter'); await page.getByRole('button', { name: 'Reset keyboard and safety preferences' }).click(); await expect(page.getByLabel('Send message key')).toHaveValue('Enter');
});
