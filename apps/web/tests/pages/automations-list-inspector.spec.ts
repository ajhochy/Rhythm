import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';
import {
  atNarrow,
  atZoom200,
  expectInspectorHeading,
  expectListInspectorAxeClean,
  expectSelected,
  keyboardSelect,
  selectRow,
} from '../helpers/list-inspector';

const dueName = 'Nudge owners before tasks are due';
const followUpName = 'Open a follow-up after project steps';
const calendarName = 'Book a room for calendar events · 会場 📅';
const calendarId = 'rule-calendar-room';
const gmailName = 'Follow up on ministry inbox requests';
const gmailId = 'rule-gmail-follow-up';

test.describe('Automations shared list and inspector', () => {
  test('selects two rules without execution and exposes every item action in the inspector', async ({ page }) => {
    await openPage(page, 'automations');
    await expectInspectorHeading(page, dueName);
    const ledgerBefore = await page.getByTestId('page-trace').textContent();

    await selectRow(page, calendarName);
    await expectInspectorHeading(page, calendarName);
    const detail = page.getByTestId('list-inspector-detail');
    await expect(detail).toContainText('Google Calendar');
    await expect(detail).toContainText('Calendar event matches filter');
    await expect(detail).toContainText('title contains Rehearsal');
    await expect(detail).toContainText('Create reservation');
    await expect(detail).toContainText('Weekend Team Calendar');

    for (const id of [
      `automation-edit-${calendarId}`,
      `automation-enabled-${calendarId}`,
      `automation-resync-${calendarId}`,
      `automation-inspect-${calendarId}`,
      `automation-delete-${calendarId}`,
      'automation-builder-submit',
    ]) await expect(page.getByTestId(id)).toBeVisible();

    await selectRow(page, followUpName);
    await expectInspectorHeading(page, followUpName);
    await expect(detail).toContainText('Project step is approaching its due date');
    await expect(page.getByTestId('page-trace')).toHaveText(ledgerBefore ?? '');
    expect((await page.getByTestId('page-trace').textContent()) ?? '').not.toMatch(/(?:POST|PATCH|DELETE) \/automation-rules/);

    await page.getByTestId('automations-new').click();
    await expect(page.getByTestId('automations-builder-dialog')).toBeVisible();
    await page.getByTestId('automation-builder-cancel').click();
    await page.getByTestId('automation-edit-rule-rhythm-project-follow-up').click();
    await expect(page.getByTestId('automations-builder-dialog')).toBeVisible();
    await page.getByTestId('automation-builder-cancel').click();
    await page.getByTestId('automation-delete-rule-rhythm-project-follow-up').click();
    await expect(page.getByTestId('automation-delete-dialog')).toBeVisible();
    await page.getByTestId('automation-delete-cancel').click();
    await expectListInspectorAxeClean(page);
  });

  test('supports roving keyboard focus and selection', async ({ page }) => {
    await openPage(page, 'automations');
    const list = page.getByRole('listbox', { name: 'Automation rules' });
    await keyboardSelect(page, { fromTitle: dueName, presses: ['ArrowDown'] });
    await expect(list.getByRole('option', { name: followUpName, exact: true })).toBeFocused();
    await expectSelected(page, dueName);
    await page.keyboard.press('Enter');
    await expectSelected(page, followUpName);
    await expectInspectorHeading(page, followUpName);
    await keyboardSelect(page, { fromTitle: followUpName, presses: ['End', 'Space'] });
    await expectSelected(page, gmailName);
    await keyboardSelect(page, { fromTitle: gmailName, presses: ['Home', 'Enter'] });
    await expectInspectorHeading(page, dueName);
    await expectListInspectorAxeClean(page);
  });

  test('restores selection, shows missing ids, and clears stale details after deletion', async ({ page }) => {
    await openPage(page, 'automations', '?state=ready&retained=keep-me&automationId=rule-calendar-room');
    await expectSelected(page, calendarName);
    await expectInspectorHeading(page, calendarName);
    await page.reload();
    await expectInspectorHeading(page, calendarName);
    const params = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
    expect(params.get('automationId')).toBe(calendarId);
    expect(params.get('retained')).toBe('keep-me');

    await openPage(page, 'automations', '?automationId=rule-does-not-exist');
    await expectInspectorHeading(page, 'Item not found');
    await expect(page.getByTestId('automation-direct-editor')).toHaveCount(0);
    await expect(page.locator('[data-testid^="automation-delete-"]')).toHaveCount(0);

    await selectRow(page, gmailName);
    await page.getByTestId(`automation-delete-${gmailId}`).click();
    await page.getByTestId('automation-delete-confirm').click();
    await expect(page.getByRole('option', { name: gmailName, exact: true })).toHaveCount(0);
    await expectInspectorHeading(page, 'Item not found');
    await expect(page.getByTestId('automation-direct-editor')).toHaveCount(0);
    await expectListInspectorAxeClean(page);
  });

  test('keeps loading, empty, error, and read-only states inside the shared surface', async ({ page }) => {
    await openPage(page, 'automations', '?state=loading');
    await expect(page.getByTestId('page-state-loading')).toContainText('Loading Automation rules');
    await expect(page.getByTestId('automation-direct-editor')).toHaveCount(0);

    await openPage(page, 'automations', '?state=empty');
    await expect(page.getByTestId('page-state-empty')).toContainText('No automations yet');
    await expect(page.getByTestId('automations-empty-create')).toBeEnabled();

    await openPage(page, 'automations', '?state=server-error');
    await expect(page.getByTestId('page-state-server-error')).toContainText('503');
    await page.getByTestId('page-retry').click();
    await expectInspectorHeading(page, dueName);

    await openPage(page, 'automations', '?state=readonly&automationId=rule-calendar-room');
    await expectInspectorHeading(page, calendarName);
    for (const id of [`automation-edit-${calendarId}`, `automation-enabled-${calendarId}`, `automation-resync-${calendarId}`, `automation-delete-${calendarId}`]) {
      await expect(page.getByTestId(id)).toBeDisabled();
    }
    await expect(page.getByTestId(`automation-inspect-${calendarId}`)).toBeEnabled();
    await expectListInspectorAxeClean(page);
  });

  test('uses one narrow pane and remains usable at 200 percent zoom', async ({ page }) => {
    await atNarrow(page);
    await openPage(page, 'automations');
    const list = page.getByRole('listbox', { name: 'Automation rules', includeHidden: true });
    await expectInspectorHeading(page, dueName);
    await expect(list).toBeHidden();
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(list).toBeVisible();
    await selectRow(page, calendarName);
    await expectInspectorHeading(page, calendarName);
    await expect(list).toBeHidden();
    await expect(page.getByTestId(`automation-inspect-${calendarId}`)).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    const longTitle = 'مراجعة تسليم الفريق — An unusually long automation rule covering owners, integrations, calendar rooms, and recurring operational work';
    await page.getByTestId('automation-direct-editor').getByTestId('automation-name').fill(longTitle);
    await page.getByTestId('automation-direct-editor').getByTestId('automation-builder-submit').click();
    await atZoom200(page);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await expectInspectorHeading(page, longTitle);
    const option = page.getByRole('option', { name: longTitle, exact: true, includeHidden: true });
    expect(await option.locator('strong').getAttribute('title')).toBe(longTitle);
    const bounds = await page.locator('.list-inspector').evaluate((element) => ({ content: element.scrollWidth, available: element.clientWidth }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.available + 1);
    await expectListInspectorAxeClean(page);
  });
});
