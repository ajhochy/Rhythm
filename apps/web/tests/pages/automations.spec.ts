import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const calendarRuleId = 'rule-calendar-room';

async function expectNoBlockingAxe(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${state}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
}

test('Automations click-through covers catalog creation, editing, confirmation-gated delete, preview, and resync', async ({ page }) => {
  await openPage(page, 'automations');
  await expect(page.getByTestId('page-automations')).toBeVisible();
  await page.getByTestId(`automation-select-${calendarRuleId}`).click();
  // Regression caught: selection left the inspector read-only until a separate edit dialog was opened.
  await expect(page.getByTestId('automation-direct-editor').getByTestId('automation-source')).toBeEnabled();

  await page.getByTestId('automations-new').click();
  const builder = page.getByTestId('automations-builder-dialog');
  await builder.getByTestId('automation-name').fill('Wednesday rehearsal follow-up');
  await builder.getByTestId('automation-trigger').selectOption('rhythm.task_due');
  await builder.getByTestId('automation-title-template').fill('Prepare {{title}}');
  await builder.getByTestId('automation-builder-submit').click();

  const createdId = 'rule-wednesday-rehearsal-follow-up';
  const created = page.getByTestId(`automation-rule-${createdId}`);
  await expect(created).toContainText('Wednesday rehearsal follow-up');
  await page.getByTestId(`automation-select-${createdId}`).click();
  const directEditor = page.getByTestId('automation-direct-editor');
  await directEditor.getByTestId('automation-name').fill('Wednesday rehearsal prep');
  await directEditor.getByTestId('automation-builder-submit').click();
  await expect(created).toContainText('Wednesday rehearsal prep');

  await created.getByTestId(`automation-delete-${createdId}`).click();
  const confirmation = page.getByTestId('automation-delete-dialog');
  await expect(confirmation).toContainText('Wednesday rehearsal prep');
  await page.getByTestId('automation-delete-cancel').click();
  await expect(created).toBeVisible();
  await expect(page.getByTestId('page-trace').getByText(`DELETE /automation-rules/${createdId} → 204`, { exact: true })).toHaveCount(0);

  await created.getByTestId(`automation-delete-${createdId}`).click();
  await page.getByTestId('automation-delete-confirm').click();
  await expect(created).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /automation-rules/${createdId} → 204`);

  const inspect = page.getByTestId(`automation-inspect-${calendarRuleId}`);
  await inspect.click();
  await expect(page.getByTestId('automation-preview-dialog')).toContainText('会場');
  await page.getByTestId('automation-preview-close').click();
  await expect(inspect).toBeFocused();

  const resync = page.getByTestId(`automation-resync-${calendarRuleId}`);
  await resync.click();
  await expect(page.getByTestId(`automation-resync-progress-${calendarRuleId}`)).toBeVisible();
  await expect(page.getByTestId(`automation-resync-result-${calendarRuleId}`)).toContainText('2 matched');
  await expect(resync).toBeEnabled();
});

test('Automations state and prerequisite journeys recover in place without external OAuth', async ({ page }) => {
  await openPage(page, 'automations', '?state=server-error');
  await page.getByTestId('page-retry').click();
  await expect(page).toHaveURL(/state=ready/);
  await expect(page.getByTestId(`automation-rule-${calendarRuleId}`)).toBeVisible();

  await openPage(page, `automations/${calendarRuleId}`, '?state=readonly');
  await expect(page.getByTestId('automations-mutations')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('automation-direct-editor').getByTestId('automation-name')).toBeDisabled();
  await expect(page.getByTestId('automation-preview-dialog')).toBeVisible();

  await openPage(page, 'automations', '?state=provider-error');
  await expect(page.getByTestId('automation-provider-resync')).toBeDisabled();
  await page.getByTestId('automations-open-integrations').click();
  await expect(page).toHaveURL(/#\/integrations/);

  await openPage(page, 'automations/not-a-rule');
  const trace = await page.getByTestId('page-trace').textContent();
  await page.getByTestId('automations-back-to-list').click();
  await expect(page).toHaveURL(/#\/automations$/);
  await expect(page.getByTestId('page-trace')).toHaveText(trace ?? '');
});

test('Automations is responsive and axe-clean across representative page, dialog, error, and readonly states', async ({ page }) => {
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'automations');
    await expect(page.getByTestId('automations-new')).toBeVisible();
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px`).toBeLessThanOrEqual(overflow.client + 1);
  }

  await expectNoBlockingAxe(page, 'ready');
  await page.getByTestId('automations-new').click();
  await expectNoBlockingAxe(page, 'builder');
  await page.keyboard.press('Escape');

  await openPage(page, 'automations', '?state=server-error');
  await expectNoBlockingAxe(page, 'server error');
  await openPage(page, `automations/${calendarRuleId}`, '?state=readonly');
  await expectNoBlockingAxe(page, 'readonly preview');
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByTestId(`automation-rule-${calendarRuleId}`)).toContainText('会場');
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
});
