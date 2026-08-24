import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

async function expectNoBlockingAxe(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${state}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
}

test('Integrations click-through covers provider sync settings consent and deterministic import', async ({ page }) => {
  await openPage(page, 'integrations');
  await expect(page.getByTestId('page-integrations')).toBeVisible();

  await page.getByTestId('calendar-select-none').click();
  await page.getByTestId('calendar-option-cal-community').check();
  await page.getByTestId('calendar-save').click();
  await expect(page.getByTestId('calendar-save-status')).toContainText('saved and synced');

  await page.getByTestId('gmail-sync').click();
  await expect(page.getByTestId('gmail-sync-status')).toContainText(/Gmail synced/i);
  await page.getByTestId('gmail-reconnect').click();
  await expect(page.getByTestId('oauth-fixture-handoff')).toContainText('Google');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gmail-reconnect')).toBeFocused();

  // Regression caught: selecting Planning Center required a second dialog before its editable filters appeared.
  await page.getByTestId('integration-select-planning-center').click();
  await expect(page.getByTestId('planning-center-direct-editor')).toBeVisible();
  await expect(page.getByTestId('pco-team-worship-vocals')).toBeEnabled();
  await page.getByTestId('pco-team-worship-vocals').click();
  await page.getByTestId('pco-position-vocalist').click();
  await page.getByTestId('planning-center-preferences-save').click();
  await expect(page.getByTestId('planning-center-preferences-summary')).toContainText('Teams: 1 selected');

  await page.getByTestId('assistant-google-enable').click();
  await expect(page.getByTestId('oauth-fixture-handoff')).toContainText('Assistant Google tools');
  await page.getByTestId('oauth-handoff-close').click();

  await page.getByTestId('open-ai-import').click();
  await page.getByTestId('ai-import-next').click();
  await page.getByTestId('ai-import-json').fill('{"tasks":[{"title":"Prepare welcome desk"}],"rhythms":[],"projects":[]}');
  await page.getByTestId('ai-import-submit').click();
  await expect(page.getByTestId('toast-status')).toContainText('Imported: 1 task');

  const trace = page.getByTestId('page-trace');
  await expect(trace).toContainText('PUT /integrations/google-calendar/preferences');
  await expect(trace).toContainText('POST /integrations/gmail/sync → 200');
  await expect(trace).toContainText('PUT /integrations/planning-center/task-preferences');
  await expect(trace).toContainText('intent=agent');
  await expect(trace).toContainText('POST /tasks');
});

test('Integrations state recovery partial failures and idempotent retries stay truthful', async ({ page }) => {
  await openPage(page, 'integrations', '?state=server-error');
  await page.getByTestId('page-retry').click();
  await expect(page).toHaveURL(/state=ready/);
  await expect(page.getByTestId('integration-google-calendar')).toBeVisible();

  await openPage(page, 'integrations', '?fixture=sync-partial');
  await page.getByTestId('integrations-sync-all').click();
  await expect(page.getByTestId('sync-all-partial')).toContainText('Planning Center failed');
  await page.getByTestId('sync-all-retry-failed').click();
  await expect(page.getByTestId('sync-all-status')).toContainText('All connected services are up to date');

  await openPage(page, 'integrations/import', '?fixture=import-partial');
  await page.getByTestId('ai-import-next').click();
  await page.getByTestId('ai-import-json').fill('[{"type":"task","title":"Email team"},{"type":"recurring_rule","title":"Weekly review","frequency":"weekly","dayOfWeek":3}]');
  await page.getByTestId('ai-import-submit').click();
  await expect(page.getByTestId('ai-import-partial-error')).toContainText('1 imported, 1 failed');
  const taskCount = await page.getByTestId('page-trace').getByText(/POST \/tasks /).count();
  await page.getByTestId('ai-import-retry').click();
  await expect(page.getByTestId('page-trace').getByText(/POST \/tasks /)).toHaveCount(taskCount);
});

test('Integrations is responsive at 1024, 768, and 390 pixels', async ({ page }) => {
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'integrations');
    await expect(page.getByTestId('integrations-sync-all')).toBeVisible();
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByText('礼拝チーム予定 🗓️ · Calendar', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});

test('Integrations representative states and dialogs have no serious or critical axe violations', async ({ page }) => {
  await openPage(page, 'integrations');
  await expectNoBlockingAxe(page, 'ready');

  await page.getByTestId('integration-select-planning-center').click();
  await expect(page.getByTestId('planning-center-direct-editor')).toBeVisible();
  await expectNoBlockingAxe(page, 'Planning Center preferences');
  await page.keyboard.press('Escape');

  await page.getByTestId('open-ai-import').click();
  await expectNoBlockingAxe(page, 'AI Import prompt');
  await page.getByTestId('ai-import-next').click();
  await expectNoBlockingAxe(page, 'AI Import paste');
  await page.keyboard.press('Escape');

  await page.getByTestId('planning-center-reconnect').click();
  await expectNoBlockingAxe(page, 'OAuth fixture handoff');
  await page.keyboard.press('Escape');

  for (const state of ['loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly']) {
    await openPage(page, 'integrations', `?state=${state}`);
    await expectNoBlockingAxe(page, state);
  }
});
