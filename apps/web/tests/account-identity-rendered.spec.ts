import { expect, test } from '@playwright/test';

test('authenticated name and initials appear in the shell account and Agents rail', async ({ page }) => {
  await page.goto('/tests/account-identity-harness.html');
  const trigger = page.getByTestId('account-button');
  await expect(trigger).toContainText('Morgan Fixture');
  await expect(trigger.locator('.avatar')).toHaveText('MF');
  await trigger.click();
  await expect(page.locator('.account-card strong')).toHaveText('Morgan Fixture');
  await expect(page.locator('.account-card .avatar')).toHaveText('MF');
  const rail = page.getByTestId('rail-agent-settings');
  await expect(rail).toContainText('Morgan Fixture');
  await expect(rail.locator('.avatar')).toHaveText('MF');
  await expect(page.getByText('AJ Hochhalter')).toHaveCount(0);
});
