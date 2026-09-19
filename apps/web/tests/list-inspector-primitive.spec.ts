import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';
import { atNarrow, atZoom200, expectInspectorHeading, expectListInspectorAxeClean, expectSelected, keyboardSelect, selectRow } from './helpers/list-inspector';

const digest = 'Monday planning digest';
const health = 'Integration health sweep';

test.describe('shared list and inspector through Agents → Tasks', () => {
  test('selects two schedules and retains their actions and history', async ({ page }) => {
    await openFixture(page, '#/tools/tasks');
    await expectSelected(page, digest);
    await expectInspectorHeading(page, digest);
    await selectRow(page, health);
    await expectInspectorHeading(page, health);
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Check configured agent integrations.');
    await page.getByRole('button', { name: /Integration health sweep · manual run/ }).click();
    await expect(page.getByTestId('tool-trace')).toContainText('/agent-sessions?scheduledTaskId=schedule-health');
    await page.getByTestId('schedule-trigger').click();
    await expect(page.getByTestId('tool-trace')).toContainText('/agent-schedules/schedule-health/trigger-now');
    await selectRow(page, digest);
    await expectInspectorHeading(page, digest);
    await expect(page.getByTestId('list-inspector-detail')).toContainText('Summarize open work and unresolved owners.');
    await expect(page.getByTestId('schedule-edit')).toBeEnabled();
    await expect(page.getByTestId('schedule-delete')).toBeEnabled();
    await expect(page.getByTestId('schedule-toggle')).toHaveText('Disable');
    await expectListInspectorAxeClean(page);
  });

  test('roves focus with arrows and boundaries, and selects with Enter and Space', async ({ page }) => {
    await openFixture(page, '#/tools/tasks');
    const list = page.getByRole('listbox', { name: 'Scheduled agent jobs' });
    await keyboardSelect(page, { fromTitle: digest, presses: ['ArrowDown'] });
    await expect(list.getByRole('option', { name: health, exact: true })).toBeFocused();
    await expectSelected(page, digest);
    const focus = await list.getByRole('option', { name: health, exact: true }).evaluate((element) => {
      const style = getComputedStyle(element);
      return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
    });
    expect(focus, 'Keyboard focus needs a visible outline or ring').toBe(true);
    await page.keyboard.press('Enter');
    await expectSelected(page, health);
    await expectInspectorHeading(page, health);
    await keyboardSelect(page, { fromTitle: health, presses: ['Home', 'Space'] });
    await expectSelected(page, digest);
    await keyboardSelect(page, { fromTitle: digest, presses: ['End', 'Space'] });
    await expectSelected(page, health);
    await keyboardSelect(page, { fromTitle: health, presses: ['ArrowUp', 'Enter'] });
    await expectInspectorHeading(page, digest);
    await expectListInspectorAxeClean(page);
  });

  test('restores deep links and refresh selection without losing other search params', async ({ page }) => {
    await openFixture(page, '#/tools/tasks?state=ready&retained=keep-me&scheduleId=schedule-health');
    await expectSelected(page, health);
    await expectInspectorHeading(page, health);
    await page.reload();
    await expectInspectorHeading(page, health);
    await selectRow(page, digest);
    const params = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
    expect(params.get('scheduleId')).toBe('schedule-digest');
    expect(params.get('state')).toBe('ready');
    expect(params.get('retained')).toBe('keep-me');
    await page.reload();
    await expectSelected(page, digest);
    await expectInspectorHeading(page, digest);
  });

  test('missing and deleted selections cannot show stale details or actions', async ({ page }) => {
    await openFixture(page, '#/tools/tasks?scheduleId=deleted-schedule');
    await expectInspectorHeading(page, 'Item not found');
    const detail = page.getByTestId('list-inspector-detail');
    await expect(detail).not.toContainText('Summarize open work');
    await expect(page.getByTestId('schedule-trigger')).toHaveCount(0);
    await expect(page.getByTestId('schedule-edit')).toHaveCount(0);
    await expect(page.getByTestId('schedule-delete')).toHaveCount(0);
    await selectRow(page, health);
    await page.getByTestId('schedule-delete').click();
    await page.getByTestId('schedule-delete-dialog-confirm').click();
    await expect(page.getByRole('option', { name: health, exact: true })).toHaveCount(0);
    await expectInspectorHeading(page, 'Item not found');
    await expect(detail).not.toContainText(health);
    await expect(detail).not.toContainText('Check configured agent integrations.');
    await expectListInspectorAxeClean(page);
  });

  test('uses one narrow pane and returns focus to the selected list row', async ({ page }) => {
    await atNarrow(page);
    await openFixture(page, '#/tools/tasks');
    const list = page.getByRole('listbox', { name: 'Scheduled agent jobs', includeHidden: true });
    await expectInspectorHeading(page, digest);
    await expect(list).toBeHidden();
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(list).toBeVisible();
    await expect(page.getByTestId('list-inspector-detail')).toBeHidden();
    await expect(list.getByRole('option', { name: digest, exact: true })).toBeFocused();
    await selectRow(page, health);
    await expectInspectorHeading(page, health);
    await expect(list).toBeHidden();
    await expect(page.getByTestId('schedule-trigger')).toBeVisible();
    await expectListInspectorAxeClean(page);
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expectSelected(page, health);
    await expect(list.getByRole('option', { name: health, exact: true })).toBeFocused();
    await expectListInspectorAxeClean(page);
  });

  test('keeps long titles and controls usable at 200% zoom and in RTL', async ({ page }) => {
    await openFixture(page, '#/tools/tasks');
    const title = 'مراجعة تسليم الفريق — An unusually long weekly planning digest covering owners, integrations, follow-through, and recurring operational work';
    await page.getByTestId('schedule-edit').click();
    await page.getByTestId('schedule-editor').getByLabel('Name', { exact: true }).fill(title);
    await page.getByTestId('schedule-save').click();
    await atZoom200(page);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await expectInspectorHeading(page, title);
    const option = page.getByRole('option', { name: title, exact: true, includeHidden: true });
    expect(await option.evaluate((element, value) => element.getAttribute('title') === value || Array.from(element.querySelectorAll('[title]')).some((child) => child.getAttribute('title') === value), title)).toBe(true);
    const bounds = await page.locator('.list-inspector').evaluate((element) => ({ content: element.scrollWidth, available: element.clientWidth }));
    expect(bounds.content, 'The shared panes must not create horizontal clipping').toBeLessThanOrEqual(bounds.available + 1);
    for (const id of ['schedule-edit', 'schedule-delete', 'schedule-trigger']) {
      const action = page.getByTestId(id);
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport();
      await expect(action).toHaveAccessibleName(/\S/);
      const horizontal = await action.evaluate((element) => {
        const control = element.getBoundingClientRect();
        const inspector = element.closest('.list-inspector-detail')!.getBoundingClientRect();
        return { left: control.left, right: control.right, availableLeft: Math.max(0, inspector.left), availableRight: Math.min(window.innerWidth, inspector.right) };
      });
      expect(horizontal.left, `${id} must not clip at the start of the inspector`).toBeGreaterThanOrEqual(horizontal.availableLeft - 1);
      expect(horizontal.right, `${id} must not clip at the end of the inspector`).toBeLessThanOrEqual(horizontal.availableRight + 1);
    }
    await expectListInspectorAxeClean(page);
  });

  test('retains loading, empty, error recovery and read-only inspection', async ({ page }) => {
    await openFixture(page, '#/tools/tasks?state=loading');
    await expect(page.getByTestId('tool-state-loading')).toContainText('/agent-schedules');
    await expect(page.getByTestId('schedule-trigger')).toHaveCount(0);
    await page.getByTestId('tool-state-select').selectOption('empty');
    await expect(page.getByTestId('tool-state-empty')).toBeVisible();
    await page.getByTestId('tool-load-example').click();
    await expectInspectorHeading(page, digest);
    await page.getByTestId('tool-state-select').selectOption('server-error');
    await expect(page.getByTestId('tool-state-server-error')).toContainText('503');
    await page.getByTestId('tool-retry').click();
    await expectInspectorHeading(page, digest);
    await page.getByTestId('tool-state-select').selectOption('readonly');
    await expect(page.getByTestId('tool-state-readonly')).toContainText('Read-only access');
    await selectRow(page, health);
    await expectInspectorHeading(page, health);
    for (const id of ['schedule-edit', 'schedule-delete', 'schedule-trigger', 'schedule-toggle']) await expect(page.getByTestId(id)).toBeDisabled();
    await expectListInspectorAxeClean(page);
  });
});
