import { expect, test } from '@playwright/test';
import {
  atNarrow,
  atZoom200,
  expectInspectorHeading,
  expectListInspectorAxeClean,
  expectSelected,
  keyboardSelect,
  selectRow,
} from '../helpers/list-inspector';

const harness = '/tests/electron-e40-harness.html';

async function openSettings(page: import('@playwright/test').Page, query = '', section = '') {
  await page.goto(`${harness}${query}#/settings${section ? `?settingsSection=${section}` : ''}`);
  await expect(page.getByTestId('page-settings')).toBeVisible();
}

test('issue-1521-c1: main Settings renders through the shared list-and-inspector primitive', async ({ page }) => {
  // Regression caught: Settings falls back to stacked sections or a page-specific split whose
  // width, selection treatment, and inspector hierarchy drift from Agents -> Tasks.
  await openSettings(page);
  const root = page.locator('.settings-page .list-inspector');
  await expect(root).toBeVisible();
  await expect(root.locator('.list-inspector-panes.tool-split')).toHaveCount(1);
  await expect(root.locator('.list-inspector-rail.tool-rail')).toHaveCount(1);
  await expect(root.locator('.list-inspector-detail.tool-detail')).toHaveCount(1);
  await expectSelected(page, 'Appearance');
  await expectInspectorHeading(page, 'Appearance');
});

test('issue-1521-c2: rows stay compact while two selections show their full inspectors', async ({ page }) => {
  // Regression caught: controls leak into rows, rows lose their status line, or changing selection
  // leaves the previous section's details visible.
  await openSettings(page);
  const expectedRows = [
    'Appearance', 'Keyboard & safety', 'Workspace', 'Members & roles', 'Join code',
    'Facilities Manager access', 'Notifications', 'Accounts & access', 'Runtime & updates',
    'Agent Settings', 'Integrations', 'Mobile Access', 'Memory',
  ];
  for (const title of expectedRows) {
    const option = page.getByRole('option', { name: title, exact: true });
    await expect(option).toBeVisible();
    await expect(option.locator('small')).toHaveText(/\S/);
    await expect(option.locator('button, a, input, select, textarea')).toHaveCount(0);
  }
  await selectRow(page, 'Keyboard & safety');
  await expectInspectorHeading(page, 'Keyboard & safety');
  await expect(page.getByLabel('Send message key')).toBeVisible();
  await selectRow(page, 'Runtime & updates');
  await expectInspectorHeading(page, 'Runtime & updates');
  await expect(page.getByText('Version: 9.9.9-test')).toBeVisible();
  await expect(page.getByLabel('Send message key')).toHaveCount(0);
});

test('issue-1521-c3: every existing Settings action is reachable from an inspector', async ({ page }) => {
  // Regression caught: moving controls into inspectors drops an existing mutation or desktop action.
  await openSettings(page);
  await page.on('dialog', (dialog) => dialog.accept());

  await selectRow(page, 'Appearance');
  await page.getByLabel('Theme').selectOption('light');

  await selectRow(page, 'Keyboard & safety');
  await page.getByLabel('Send message key').fill('Meta+Enter');
  await page.getByLabel('Require confirmation for destructive tools').uncheck();
  await page.getByRole('button', { name: 'Save keyboard and safety preferences' }).click();
  await page.getByRole('button', { name: 'Reset keyboard and safety preferences' }).click();

  await selectRow(page, 'Workspace');
  await expect(page.getByText('VCRC', { exact: true })).toBeVisible();

  await selectRow(page, 'Join code');
  await page.getByRole('button', { name: 'Regenerate join code' }).click();
  await expect(page.getByText(/Join code: NEW/)).toBeVisible();

  await selectRow(page, 'Members & roles');
  await page.getByLabel('Role for Casey').selectOption('admin');
  await page.getByRole('button', { name: 'Remove Casey' }).click();

  await selectRow(page, 'Facilities Manager access');
  await page.getByLabel('Facilities manager for Casey').check();

  await selectRow(page, 'Notifications');
  await page.getByLabel('Email notifications').uncheck();

  await selectRow(page, 'Accounts & access');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await selectRow(page, 'Runtime & updates');
  await page.getByRole('button', { name: 'Check Rhythm releases' }).click();

  const calls = await page.evaluate(() => (window as typeof window & { __e40: unknown[] }).__e40);
  expect(calls).toEqual(expect.arrayContaining([
    ['role', 2, 'admin'],
    ['user', 2, { isFacilitiesManager: true }],
    ['remove', 2],
    ['preferences', { emailNotificationsEnabled: false }],
    ['logout'],
    ['update'],
  ]));
});

test('issue-1521-c4: device preferences persist per account and workspace values come from the gateway', async ({ page }) => {
  // Regression caught: device settings become workspace-global, or gateway workspace/member values
  // are replaced by stale client-only copies during the layout migration.
  await openSettings(page, '?user=1');
  await selectRow(page, 'Appearance');
  await page.getByLabel('Theme').selectOption('light');
  await selectRow(page, 'Keyboard & safety');
  await page.getByLabel('Send message key').fill('Meta+Enter');
  await page.getByRole('button', { name: 'Save keyboard and safety preferences' }).click();
  await page.reload();
  await expect(page.getByLabel('Send message key')).toHaveValue('Meta+Enter');
  await selectRow(page, 'Workspace');
  await expect(page.getByText('VCRC', { exact: true })).toBeVisible();
  await expect(page.locator('.settings-scope').getByText('Workspace administration', { exact: true })).toBeVisible();

  await openSettings(page, '?user=2', 'keyboard-safety');
  await expect(page.getByLabel('Send message key')).toHaveValue('Enter');
  await selectRow(page, 'Appearance');
  await expect(page.getByLabel('Theme')).toHaveValue('dark');
});

test('issue-1521-c5: selection is inert and staff permissions remain read-only', async ({ page }) => {
  // Regression caught: opening an administrative row fires a request, or a staff member gains a
  // mutation that the former stacked Settings page disabled or hid.
  await openSettings(page, '?role=staff&user=2');
  await selectRow(page, 'Workspace');
  await selectRow(page, 'Members & roles');
  await expect(page.getByLabel('Role for Admin')).toBeDisabled();
  await expect(page.getByLabel('Role for Casey')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await selectRow(page, 'Join code');
  await expect(page.getByRole('button', { name: 'Regenerate join code' })).toHaveCount(0);
  await selectRow(page, 'Facilities Manager access');
  await expect(page.getByLabel('Facilities manager for Admin')).toBeDisabled();
  await expect(page.getByLabel('Facilities manager for Casey')).toBeDisabled();
  expect(await page.evaluate(() => (window as typeof window & { __e40: unknown[] }).__e40)).toEqual([]);
});

test('issue-1521-c6: related destination rows navigate without duplicating editors', async ({ page }) => {
  // Regression caught: destination rows become duplicate embedded editors or disappear from Settings.
  const destinations = [
    ['Agent Settings', '/tools/agent-settings'],
    ['Integrations', '/integrations'],
    ['Mobile Access', '/mobile-access'],
    ['Memory', '/tools/brain'],
  ] as const;
  for (const [title, path] of destinations) {
    await openSettings(page);
    await page.getByRole('option', { name: title, exact: true }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe(`#${path}`);
  }
});

test('issue-1521-c7: keyboard, narrow, zoom, focus, and axe behavior remain usable', async ({ page }) => {
  // Regression caught: keyboard focus moves without selection feedback, or a narrow/zoomed inspector
  // clips the actions required to recover and continue.
  await openSettings(page);
  await keyboardSelect(page, { fromTitle: 'Appearance', presses: ['ArrowDown'] });
  await expect(page.getByRole('option', { name: 'Keyboard & safety', exact: true })).toBeFocused();
  await expectSelected(page, 'Appearance');
  await page.keyboard.press('Enter');
  await expectSelected(page, 'Keyboard & safety');
  await expectInspectorHeading(page, 'Keyboard & safety');
  const longRow = page.getByRole('option', { name: 'Facilities Manager access', exact: true });
  await expect(longRow.locator('strong')).toHaveAttribute('title', 'Facilities Manager access');
  expect(await longRow.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await longRow.evaluate((element) => element.clientWidth));
  await expectListInspectorAxeClean(page);

  await atNarrow(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to list' }).click();
  await selectRow(page, 'Runtime & updates');
  await expect(page.getByRole('button', { name: 'Check Rhythm releases' })).toBeInViewport();

  await page.setViewportSize({ width: 1440, height: 900 });
  await atZoom200(page);
  const bounds = await page.locator('.settings-page .list-inspector').evaluate((element) => ({
    content: element.scrollWidth,
    available: element.clientWidth,
  }));
  expect(bounds.content).toBeLessThanOrEqual(bounds.available + 1);
  await expectListInspectorAxeClean(page);
});

test('issue-1521-c8: loading error empty missing and unsaved states are explicit', async ({ page }) => {
  // Regression caught: stale details survive a missing ID, loading/error states expose live controls,
  // or changing sections silently throws away an edited keyboard preference.
  await openSettings(page, '?state=loading');
  await expect(page.getByRole('status')).toContainText('Loading settings');
  await expect(page.getByLabel('Theme')).toHaveCount(0);

  await openSettings(page, '?state=error');
  await expect(page.getByRole('alert')).toContainText('Settings could not be loaded');
  await expect(page.getByLabel('Theme')).toHaveCount(0);

  await openSettings(page, '?state=empty', 'members');
  await expectInspectorHeading(page, 'Members & roles');
  await expect(page.getByText('No workspace members found.')).toBeVisible();

  await openSettings(page, '', 'deleted-setting');
  await expectInspectorHeading(page, 'Item not found');
  await expect(page.getByLabel('Theme')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check Rhythm releases' })).toHaveCount(0);

  await openSettings(page, '', 'keyboard-safety');
  await page.getByLabel('Send message key').fill('Shift+Enter');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('option', { name: 'Workspace', exact: true }).click();
  await expectInspectorHeading(page, 'Keyboard & safety');
  await expect(page.getByLabel('Send message key')).toHaveValue('Shift+Enter');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('option', { name: 'Workspace', exact: true }).click();
  await expectInspectorHeading(page, 'Workspace');
});
