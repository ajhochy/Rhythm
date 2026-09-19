import { expect, test } from '@playwright/test';
import { openFixture } from '../helpers';
import { atNarrow, atZoom200, expectInspectorHeading, expectListInspectorAxeClean, expectSelected, keyboardSelect, selectRow } from '../helpers/list-inspector';

const profiles = 'Profiles overview';
const autoPromotion = 'Auto-promotion';
const runtime = 'Runtime / OpenCode server';

test.describe('Agent Settings list and inspector', () => {
  test('selects different configuration sections and keeps scope visible', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await expectSelected(page, profiles);
    await expectInspectorHeading(page, profiles);
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Agent / profile');

    await selectRow(page, autoPromotion);
    await expectInspectorHeading(page, autoPromotion);
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Workspace');

    await selectRow(page, 'Accounts');
    await expectInspectorHeading(page, 'Accounts');
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Desktop local');
    await expectListInspectorAxeClean(page);
  });

  test('uses roving keyboard focus without changing selection until activation', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await keyboardSelect(page, { fromTitle: profiles, presses: ['ArrowDown'] });
    await expect(page.getByRole('option', { name: autoPromotion, exact: true })).toBeFocused();
    await expectSelected(page, profiles);
    await page.keyboard.press('Enter');
    await expectSelected(page, autoPromotion);
    await keyboardSelect(page, { fromTitle: autoPromotion, presses: ['End', 'Space'] });
    await expectSelected(page, 'MCP servers');
    await keyboardSelect(page, { fromTitle: 'MCP servers', presses: ['Home', 'Space'] });
    await expectInspectorHeading(page, profiles);
  });

  test('restores a valid deep link and shows a clear state for a deleted id', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings?settingsSection=runtime');
    await expectSelected(page, runtime);
    await expectInspectorHeading(page, runtime);
    await page.reload();
    await expectInspectorHeading(page, runtime);

    await page.goto('/#/tools/agent-settings?settingsSection=deleted-section');
    await expectInspectorHeading(page, 'Item not found');
    const detail = page.getByTestId('list-inspector-detail');
    await expect(detail).toContainText('no longer available');
    await expect(detail.getByRole('button', { name: 'Desktop endpoint' })).toHaveCount(0);
    await selectRow(page, profiles);
    await expectInspectorHeading(page, profiles);
  });

  test('keeps empty, loading, error, and read-only states usable', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings?state=loading');
    await expect(page.getByTestId('tool-state-loading')).toContainText('fixture://agent-settings');
    await expect(page.locator('.list-inspector')).toHaveCount(0);

    await page.getByTestId('tool-state-select').selectOption('empty');
    await expect(page.getByTestId('tool-state-empty')).toContainText('No local defaults configured');
    await page.getByTestId('tool-load-example').click();
    await expectInspectorHeading(page, profiles);

    await page.getByTestId('tool-state-select').selectOption('server-error');
    await expect(page.getByTestId('tool-state-server-error')).toContainText('503');
    await page.getByTestId('tool-retry').click();
    await expectInspectorHeading(page, profiles);

    await page.getByTestId('tool-state-select').selectOption('readonly');
    await selectRow(page, runtime);
    await expectInspectorHeading(page, runtime);
    await expect(page.getByRole('button', { name: 'Desktop endpoint' })).toBeDisabled();
    await expectListInspectorAxeClean(page);
  });

  test('keeps every existing fixture action in the inspector', async ({ page }) => {
    await openFixture(page, '#/tools/agent-settings');
    await page.getByTestId('agent-settings-refresh').click();
    await expect(page.getByTestId('tool-trace')).toContainText('fixture://agent-settings');

    await selectRow(page, runtime);
    await page.getByRole('button', { name: 'Desktop endpoint', exact: true }).click();
    await expect(page.getByTestId('tool-trace')).toContainText('fixture://agent-settings/connection');
    await page.getByRole('button', { name: 'Offline buffering', exact: true }).click();
    await expect(page.getByTestId('tool-trace')).toContainText('fixture://agent-settings/offline-buffer');

    await selectRow(page, profiles);
    await page.getByTestId('agent-settings-open-profiles').click();
    await expect(page).toHaveURL(/#\/profiles$/);
  });

  test('uses one pane at 640px and remains unclipped at 200% zoom', async ({ page }) => {
    await atNarrow(page);
    await openFixture(page, '#/tools/agent-settings');
    const list = page.getByRole('listbox', { name: 'Agent settings sections', includeHidden: true });
    await expect(list).toBeHidden();
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(list).toBeVisible();
    await selectRow(page, runtime);
    await expectInspectorHeading(page, runtime);
    await expect(list).toBeHidden();
    await expect(page.getByRole('button', { name: 'Desktop endpoint' })).toBeVisible();

    await atZoom200(page);
    const overflow = await page.locator('.list-inspector').evaluate((element) => ({ content: element.scrollWidth, available: element.clientWidth }));
    expect(overflow.content).toBeLessThanOrEqual(overflow.available + 1);
    await expectListInspectorAxeClean(page);
  });
});
