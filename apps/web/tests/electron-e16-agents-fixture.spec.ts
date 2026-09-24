import { expect, test } from '@playwright/test';

test('E16 fixture separation: Cancel and attachments stay local; profile fixture controls still work', async ({ page }) => {
  const denied: string[] = [];
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4188') return route.continue();
    denied.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/#/agents');
  await page.getByTestId('session-session-sunday-handoff').click({ modifiers: ['Shift'] });
  await page.getByRole('toolbar').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('session-session-sunday-handoff')).toContainText('Working');
  await expect(page.getByTestId('session-session-sunday-handoff')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('composer-attach').click();
  await page.getByTestId('attachment-option-allowed').click();
  await page.getByTestId('group-project-project-rhythm-desktop').click();
  await page.getByTestId('session-session-permission').click();
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  await page.getByTestId('session-session-sunday-handoff').click();
  await expect(page.locator('.attachment-chip')).toHaveCount(1);
  await page.getByTestId('tool-profiles').click();
  await expect(page.getByTestId('profile-managed-skills')).toBeEnabled();
  await page.getByTestId('profile-account').selectOption('Research account');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-account')).toHaveValue('Research account');
  expect(denied).toEqual([]);
});
