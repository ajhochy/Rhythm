import { test, expect, responseFor, assertResponse } from './parity-fixture';

// #56 replaces the native currentSession/token boundary with the configured browser owner.
test('#56: configured synthetic owner appears consistently in the shell account and Agents rail', async ({ page, parity }) => {
  const pending = responseFor(page, 'GET', '/web/bootstrap');
  await page.goto('/#/agents');
  const response = await pending;
  await assertResponse(response, 'GET', '/web/bootstrap', 200);
  const bootstrap = await response.json();
  expect(bootstrap).toMatchObject({ mode: 'web', owner: { id: 1, displayName: 'Synthetic Admin', role: 'admin' } });
  expect(await parity.api.json('/web/bootstrap')).toEqual(bootstrap);
  expect(parity.rows('SELECT id,name,email FROM users WHERE id=?', bootstrap.owner.id)).toEqual([
    { id: 1, name: 'Synthetic Admin', email: 'admin@example.invalid' },
  ]);
  const trigger = page.getByTestId('account-button');
  await expect(trigger).toContainText(bootstrap.owner.displayName);
  const initials = (await trigger.locator('.avatar').textContent())?.trim();
  expect(initials).toMatch(/^[A-Z0-9]{1,2}$/);
  expect(initials).not.toBe('AJ');
  await trigger.click();
  await expect(page.locator('.account-card strong')).toHaveText(bootstrap.owner.displayName);
  await expect(page.locator('.account-card .avatar')).toHaveText(initials!);
  await expect(page.getByTestId('rail-agent-settings')).toContainText(bootstrap.owner.displayName);
  await expect(page.getByTestId('rail-agent-settings').locator('.avatar')).toHaveText(initials!);
  await expect(trigger).not.toContainText('AJ Hochhalter');
  await expect(page.getByTestId('rail-agent-settings')).not.toContainText('AJ Hochhalter');
  await expect(page.getByText(/Sign in with Google/)).toHaveCount(0);
});
