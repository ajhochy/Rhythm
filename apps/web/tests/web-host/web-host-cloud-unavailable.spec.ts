import { test, expect } from './fixture';

const cloudPages = ['dashboard', 'planner', 'tasks', 'rhythms', 'projects', 'messages', 'facilities', 'automations', 'integrations'];
test('U4: Advanced local sessions stay editable when the cloud task catalog is absent', async ({ page, api }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  expect((await api('/web/bootstrap')).capabilities).toMatchObject({ localAgents: true, cloud: false });
  await page.goto('/#/agents');
  await page.getByTestId('new-session-advanced').click();
  const dialog = page.getByTestId('advanced-session-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('advanced-profile')).toBeEnabled();
  await expect(page.getByTestId('advanced-name')).toBeEditable();
  await expect(page.getByTestId('advanced-task')).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveText('Task catalog unavailable');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const destination of [...cloudPages, 'settings']) {
  test(`U3: ${destination} is honest when cloud capability is absent`, async ({ page, api, apiBase }, info) => {
    const foreign: string[] = [];
    const errors: string[] = [];
    page.on('request', request => { if (new URL(request.url()).origin !== apiBase) foreign.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    expect((await api('/web/bootstrap')).capabilities.cloud).toBe(false);
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto('/#/agents');
    if (destination !== 'dashboard') await page.getByTestId('nav-more').click();
    await page.getByTestId(`nav-${destination}${destination === 'dashboard' ? '' : '-overflow'}`).click();
    if (destination === 'settings') {
      await expect(page.getByTestId('page-settings')).toBeVisible();
      await page.getByRole('option', { name: 'Workspace', exact: true }).click();
      await expect(page.getByText('Settings are unavailable in this environment.').first()).toBeVisible();
    } else await expect(page.getByTestId('page-state-unavailable')).toBeVisible();
    await expect(page.getByTestId('page-state-server-error')).toHaveCount(0);
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${destination}-unavailable.png`), fullPage: true });
  });
}

test('U3: approvals remain usable with cloud absent and no notification write control', async ({ page, api }, info) => {
  expect((await api('/web/bootstrap')).capabilities).toMatchObject({ cloud: false, approvals: true });
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/web/approvals' && response.request().method() === 'GET');
  await page.goto('/#/agents');
  expect((await pending).status()).toBe(200);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notifications-button').locator('.unread-badge')).toHaveCount(0);
  await expect(page.getByTestId('approval-queue-status')).toContainText('0 pending approvals');
  await expect(page.getByRole('menuitem', { name: 'Refresh approvals' })).toBeEnabled();
  await expect(page.getByTestId('approval-queue-error')).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Mark all read' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('local-approvals-cloud-unavailable.png'), fullPage: true });
});

test('U3: local Settings remain usable while workspace settings are unavailable', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/settings?settingsSection=appearance');
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toBeEnabled();
  await page.getByRole('option', { name: 'Runtime & updates', exact: true }).click();
  await expect(page.getByTestId('list-inspector-detail')).toContainText('healthy');
  await expect(page.getByTestId('page-state-unavailable')).toHaveCount(0);
  await page.getByRole('option', { name: 'Notifications', exact: true }).click();
  await expect(page.getByTestId('settings-workspace-error')).toContainText('Settings are unavailable in this environment.');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('settings-cloud-section-unavailable.png'), fullPage: true });
});
