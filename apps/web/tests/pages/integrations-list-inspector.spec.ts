import { expect, test, type Page } from '@playwright/test';
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

async function openIntegrations(page: Page, path = 'integrations', search = '') {
  await openPage(page, path, search);
  await expect(page.getByTestId('page-integrations')).toBeVisible();
}

test('issue-1519-c1: rows expose compact provider identity and connection status', async ({ page }) => {
  // Regression caught: page-specific cards return, or row actions/nested controls make the list noisy and inaccessible.
  await openIntegrations(page);
  const list = page.getByRole('listbox', { name: 'Integrations' });
  await expect(list.getByRole('option')).toHaveCount(5);
  await expect(list.getByRole('option', { name: 'Google Calendar' })).toContainText('aj@example.test · Connected');
  await expect(list.getByRole('option', { name: 'Gmail' })).toContainText('aj@example.test · Connected');
  await expect(list.getByRole('option', { name: 'Planning Center' })).toContainText('Rhythm Community Church · Connected');
  await expect(list.getByRole('option', { name: 'Assistant access' })).toContainText('Separate consent');
  await expect(list.getByRole('option', { name: 'AI Import' })).toContainText('Tasks, rhythms, and project templates');
  await expect(list.locator('button, a, input, select, textarea')).toHaveCount(0);
});

test('issue-1519-c2: selecting two entries swaps the inspector details', async ({ page }) => {
  // Regression caught: selection styling changes while stale provider details remain in the inspector.
  await openIntegrations(page);
  await selectRow(page, 'Gmail');
  await expectInspectorHeading(page, 'Gmail');
  await expect(page.getByTestId('gmail-signals-list')).toBeVisible();
  await selectRow(page, 'Planning Center');
  await expectInspectorHeading(page, 'Planning Center');
  await expect(page.getByTestId('planning-center-direct-editor')).toBeVisible();
  await expect(page.getByTestId('gmail-signals-list')).toHaveCount(0);
});

test('issue-1519-c3: every existing item action remains reachable from its inspector', async ({ page }) => {
  // Regression caught: migration strands a provider action in the removed row-card markup.
  await openIntegrations(page);
  await expect(page.getByTestId('calendar-save')).toBeVisible();
  await expect(page.getByTestId('google-calendar-sync')).toBeVisible();

  await selectRow(page, 'Gmail');
  await expect(page.getByTestId('gmail-reconnect')).toBeVisible();
  await expect(page.getByTestId('gmail-sync')).toBeVisible();
  await expect(page.getByTestId('gmail-signals-list')).toBeVisible();

  await selectRow(page, 'Planning Center');
  await expect(page.getByTestId('planning-center-reconnect')).toBeVisible();
  await expect(page.getByTestId('planning-center-sync')).toBeVisible();
  await expect(page.getByTestId('planning-center-preferences-save')).toBeVisible();

  await selectRow(page, 'Assistant access');
  await expect(page.getByTestId('assistant-google-enable')).toBeVisible();
  await selectRow(page, 'AI Import');
  await expect(page.getByTestId('open-ai-import')).toBeVisible();

  await openIntegrations(page, 'integrations', '?fixture=disconnected');
  await expect(page.getByTestId('google-calendar-connect')).toBeVisible();
  await selectRow(page, 'Gmail');
  await expect(page.getByTestId('gmail-connect')).toBeVisible();
  await selectRow(page, 'Planning Center');
  await expect(page.getByTestId('planning-center-connect')).toBeVisible();
});

test('issue-1519-c4: consent scopes stay distinct and selection is inert', async ({ page }) => {
  // Regression caught: selecting a row starts sync/OAuth/import, or broad assistant consent is presented as Gmail metadata consent.
  await openIntegrations(page);
  const traceBefore = await page.getByTestId('page-trace').textContent();
  await selectRow(page, 'Gmail');
  await expect(page.getByTestId('list-inspector-detail')).toContainText('metadata connection does not grant assistant mailbox authority');
  await selectRow(page, 'Assistant access');
  await expect(page.getByTestId('list-inspector-detail')).toContainText('broader than the Gmail metadata connection');
  await selectRow(page, 'AI Import');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');
});

test('issue-1519-c5: keyboard selection updates visible focus and selected state', async ({ page }) => {
  // Regression caught: arrow keys move focus but Enter leaves the previous inspector selected.
  await openIntegrations(page);
  await keyboardSelect(page, { fromTitle: 'Google Calendar', presses: ['ArrowDown', 'Enter'] });
  await expectSelected(page, 'Gmail');
  await expectInspectorHeading(page, 'Gmail');
  await expect(page.getByRole('option', { name: 'Gmail' })).toBeFocused();
});

test('issue-1519-c6: states narrow layout zoom long metadata and readonly inspection remain usable', async ({ page }) => {
  // Regression caught: state handling bypasses the primitive, zoom clips controls, or read-only disables selection as well as mutations.
  await openIntegrations(page, 'integrations', '?state=loading');
  await expectInspectorHeading(page, 'Loading Integrations');
  await expect(page.locator('.list-inspector-state[role="status"]')).toContainText('Loading Integrations');

  await openIntegrations(page, 'integrations', '?state=empty');
  await expect(page.getByRole('listbox', { name: 'Integrations' }).getByRole('option')).toHaveCount(0);
  await expect(page.getByTestId('page-state-empty')).toContainText('No integrations connected');

  await openIntegrations(page, 'integrations', '?state=server-error');
  await expectInspectorHeading(page, 'Integrations unavailable');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');

  await openIntegrations(page, 'integrations', '?fixture=account-states');
  const gmail = page.getByRole('option', { name: 'Gmail' });
  await expect(gmail.locator('.list-inspector-badge')).toHaveAttribute('title', /Google authorization expired/);
  await expectListInspectorAxeClean(page);

  await openIntegrations(page, 'integrations/gmail', '?state=readonly');
  await selectRow(page, 'Planning Center');
  await expectInspectorHeading(page, 'Planning Center');
  await expect(page.getByTestId('planning-center-preferences-save')).toBeDisabled();

  await atNarrow(page);
  await openIntegrations(page);
  await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to list' }).click();
  await selectRow(page, 'Gmail');
  await expectInspectorHeading(page, 'Gmail');
  await expect(page.getByTestId('gmail-sync')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await openIntegrations(page);
  await atZoom200(page);
  await expect(page.getByTestId('calendar-save')).toBeVisible();
  const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  await expectListInspectorAxeClean(page);
});

test('issue-1519-c7: deep links and refresh restore the selected integration', async ({ page }) => {
  // Regression caught: legacy section routes or URL-backed row selection fall back to the first provider, or a deleted ID leaves stale details.
  await openIntegrations(page, 'integrations/gmail');
  await expectSelected(page, 'Gmail');
  await expectInspectorHeading(page, 'Gmail');
  await selectRow(page, 'Planning Center');
  await expect(page).toHaveURL(/integrationId=integration-planning-center/);
  await page.reload();
  await expectSelected(page, 'Planning Center');
  await expectInspectorHeading(page, 'Planning Center');

  await openIntegrations(page, 'integrations', '?integrationId=integration-deleted');
  await expectInspectorHeading(page, 'Item not found');
  await expect(page.getByTestId('list-inspector-detail')).toContainText('no longer available');
  await expect(page.getByTestId('calendar-save')).toHaveCount(0);
  await expect(page.getByTestId('gmail-sync')).toHaveCount(0);
  await selectRow(page, 'Google Calendar');
  await expectInspectorHeading(page, 'Google Calendar');
});
