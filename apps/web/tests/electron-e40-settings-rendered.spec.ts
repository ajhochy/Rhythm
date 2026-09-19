import { expect, test } from '@playwright/test';
import { selectRow } from './helpers/list-inspector';
test('E40/E44: rendered Settings performs admin/preference actions and shows version/update', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/tests/electron-e40-harness.html'); await expect(page.getByTestId('page-settings')).toBeVisible();
  await selectRow(page, 'Runtime & updates'); await expect(page.getByText('Version: 9.9.9-test')).toBeVisible();
  await selectRow(page, 'Join code');
  await page.getByRole('button', { name: 'Regenerate join code' }).click(); await expect(page.getByText(/Join code: NEW/)).toBeVisible();
  await selectRow(page, 'Members & roles');
  await page.getByLabel('Role for Casey').selectOption('admin'); await expect.poll(() => page.evaluate(() => (window as any).__e40.some((call: any[]) => call[0] === 'role'))).toBe(true);
  await page.getByRole('button', { name: 'Remove Casey' }).click(); await expect.poll(() => page.evaluate(() => (window as any).__e40.some((call: any[]) => call[0] === 'remove'))).toBe(true);
  await selectRow(page, 'Facilities Manager access'); await page.getByLabel('Facilities manager for Casey').click(); await expect.poll(() => page.evaluate(() => (window as any).__e40.some((call: any[]) => call[0] === 'user'))).toBe(true);
  await selectRow(page, 'Notifications');
  await page.getByLabel('Email notifications').uncheck(); await selectRow(page, 'Runtime & updates'); await page.getByRole('button', { name: 'Check Rhythm releases' }).click();
  const calls = await page.evaluate(() => (window as any).__e40);
  expect(calls).toEqual(expect.arrayContaining([['role', 2, 'admin'], ['user', 2, { isFacilitiesManager: true }], ['remove', 2], ['preferences', { emailNotificationsEnabled: false }], ['update']]));
  await selectRow(page, 'Keyboard & safety'); await page.getByLabel('Send message key').selectOption('Meta+Enter'); await page.getByRole('button', { name: 'Reset keyboard preference' }).click(); await expect(page.getByLabel('Send message key')).toHaveValue('Enter');
});

test('E40: ordinary members cannot see or use workspace administration', async ({ page }) => {
  await page.goto('/tests/electron-e40-harness.html?role=staff&user=2');
  await selectRow(page, 'Join code');
  await expect(page.getByRole('button', { name: 'Regenerate join code' })).toHaveCount(0);
  await selectRow(page, 'Members & roles');
  await expect(page.getByLabel('Role for Admin')).toBeDisabled();
  await expect(page.getByLabel('Role for Casey')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await selectRow(page, 'Facilities Manager access');
  await expect(page.getByLabel('Facilities manager for Admin')).toBeDisabled();
});

test('E40: appearance and keyboard preferences survive reload and stay account-scoped', async ({ page }) => {
  await page.goto('/tests/electron-e40-harness.html?user=1');
  await page.getByLabel('Theme').selectOption('light'); await selectRow(page, 'Keyboard & safety'); await page.getByLabel('Send message key').selectOption('Meta+Enter'); await page.getByRole('button', { name: 'Save keyboard preference' }).click();
  await page.reload(); await expect(page.getByLabel('Send message key')).toHaveValue('Meta+Enter'); await expect(page.getByLabel('Require confirmation for destructive tools')).toHaveCount(0); await selectRow(page, 'Appearance'); await expect(page.getByLabel('Theme')).toHaveValue('light');
  await page.goto('/tests/electron-e40-harness.html?user=2#/settings?settingsSection=keyboard-safety'); await expect(page.getByLabel('Send message key')).toHaveValue('Enter'); await selectRow(page, 'Appearance'); await expect(page.getByLabel('Theme')).toHaveValue('dark');
  await page.goto('/tests/electron-e40-harness.html?user=1#/settings?settingsSection=keyboard-safety'); await page.getByRole('button', { name: 'Reset keyboard preference' }).click(); await expect(page.getByLabel('Send message key')).toHaveValue('Enter'); await selectRow(page, 'Appearance'); await expect(page.getByLabel('Theme')).toHaveValue('dark');
});
