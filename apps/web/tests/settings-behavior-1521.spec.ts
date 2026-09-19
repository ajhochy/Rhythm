import { expect, test } from '@playwright/test';
import { selectRow } from './helpers/list-inspector';

test('issue-1521 review: saved send key controls Composer and survives reload', async ({ page }) => {
  // Regression caught: Settings persists Meta+Enter while Composer still submits on plain Enter
  // and continues to advertise the fixed Enter shortcut.
  await page.goto('/tests/electron-e40-harness.html?user=4189');
  await selectRow(page, 'Keyboard & safety');
  await page.getByLabel('Send message key').selectOption('Meta+Enter');
  await page.getByRole('button', { name: 'Save keyboard preference' }).click();

  await page.reload();
  await expect(page.getByLabel('Send message key')).toHaveValue('Meta+Enter');
  await expect(page.getByLabel('Require confirmation for destructive tools')).toHaveCount(0);

  await page.goto('/tests/electron-e22-harness.html');
  const input = page.getByTestId('composer-input');
  await expect(page.getByText('Cmd/Ctrl+Enter to send · Enter for newline')).toBeVisible();
  await input.fill('Keep this draft');
  await input.press('Enter');
  await expect(input).toHaveValue(/Keep this draft/);
  await input.press('Meta+Enter');
  await expect(input).toHaveValue('');

  await page.reload();
  await expect(page.getByText('Cmd/Ctrl+Enter to send · Enter for newline')).toBeVisible();
  await input.fill('Send after reload');
  await input.press('Control+Enter');
  await expect(input).toHaveValue('');
});
