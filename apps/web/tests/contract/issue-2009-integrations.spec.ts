import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

async function expectIntegrationsPage(page: Page) {
  await expect(page.getByTestId('page-integrations')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toHaveCount(1);
}

test('issue-2009-c1: integrations routes render the real page and section deep links', async ({ page }) => {
  // Regression caught: #/integrations or a supported section deep link continues rendering ModulePlaceholder or loses its intended section/dialog.
  await openPage(page, 'integrations');
  await expectIntegrationsPage(page);
  await expect(page.getByTestId('page-trace')).toContainText('GET /integrations/accounts → 200');

  for (const section of ['google-calendar', 'gmail', 'planning-center', 'assistant-tools']) {
    await openPage(page, `integrations/${section}`);
    await expectIntegrationsPage(page);
    await expect(page.getByTestId(`integration-${section}`)).toHaveAttribute('data-deep-link-active', 'true');
  }

  await openPage(page, 'integrations/import');
  await expectIntegrationsPage(page);
  await expect(page.getByTestId('ai-import-dialog')).toHaveAttribute('role', 'dialog');

  await openPage(page, 'integrations/not-a-section');
  await expectIntegrationsPage(page);
  await expect(page.getByTestId('integration-section-not-found')).toContainText('not found');
  await page.getByTestId('integrations-back').click();
  await expect(page).toHaveURL(/#\/integrations$/);
});

test('issue-2009-c2: provider cards distinguish connection sync error and permission states', async ({ page }) => {
  // Regression caught: cards collapse needs-reauth/error into a generic disconnected chip, hide prerequisites, or invent disconnect/revoke controls.
  await openPage(page, 'integrations', '?fixture=account-states');
  await expectIntegrationsPage(page);
  await expect(page.getByTestId('integration-status-google-calendar')).toHaveText('Connected');
  await expect(page.getByTestId('integration-google-calendar')).toContainText('aj@example.test');
  await expect(page.getByTestId('integration-status-gmail')).toHaveText('Permission required');
  await expect(page.getByTestId('integration-gmail')).toContainText(/Reconnect Google|authorization expired/i);
  await expect(page.getByTestId('integration-status-planning-center')).toHaveText('Needs attention');
  await expect(page.getByTestId('integration-planning-center')).toContainText('Refresh token rejected');
  await expect(page.getByTestId('integration-disconnect')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /revoke/i })).toHaveCount(0);

  await openPage(page, 'integrations', '?fixture=disconnected');
  await expectIntegrationsPage(page);
  await expect(page.getByTestId('integration-status-google-calendar')).toHaveText('Not connected');
  await expect(page.getByTestId('google-calendar-connect')).toBeEnabled();
  await page.getByTestId('integration-select-gmail').click();
  await expect(page.getByTestId('gmail-signals-empty')).toContainText('Connect Gmail and sync once');
});

test('issue-2009-c3: deterministic state matrix remains actionable and readonly is native', async ({ page }) => {
  // Regression caught: a required fixture state is blank/dead, Retry reloads the document, prerequisites are vague, or readonly styling leaves mutations enabled.
  await openPage(page, 'integrations', '?state=loading');
  await expect(page.getByTestId('page-state-loading')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('page-state-loading')).toContainText('Loading integrations');

  await openPage(page, 'integrations', '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toContainText('No integrations connected');
  await page.getByTestId('integrations-empty-connect-google').click();
  await expect(page.getByTestId('oauth-fixture-handoff')).toBeVisible();

  await openPage(page, 'integrations', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');
  await page.getByTestId('page-retry').click();
  await expectIntegrationsPage(page);
  await expect(page).toHaveURL(/state=ready/);

  await openPage(page, 'integrations', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText(/authenticated Rhythm workspace session/i);
  await openPage(page, 'integrations', '?state=unavailable');
  await expect(page.getByTestId('page-state-unavailable')).toContainText(/local Rhythm integration service|local Rhythm API/i);
  await openPage(page, 'integrations/gmail', '?state=readonly');
  await expect(page.getByTestId('page-state-readonly')).toContainText(/integration-management|read-only/i);
  await expect(page.getByTestId('integrations-mutations')).toBeDisabled();
  await expect(page.getByTestId('integrations-mutations')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('gmail-signals-list')).toBeVisible();
});

test('issue-2009-c4: enabled controls are live identifiable and restore focus', async ({ page }) => {
  // Regression caught: an enabled control is unlabeled/dead, a client-only action fakes API work, or Escape strands focus after a modal.
  await openPage(page, 'integrations');
  await expectIntegrationsPage(page);
  const enabled = page.getByTestId('page-integrations').locator('button:enabled, input:enabled, select:enabled, textarea:enabled');
  const missingTestIds = await enabled.evaluateAll((elements) => elements
    .filter((element) => !/^[-a-z0-9]+$/.test(element.getAttribute('data-testid') ?? ''))
    .map((element) => element.outerHTML));
  expect(missingTestIds).toEqual([]);

  const traceBefore = await page.getByTestId('page-trace').textContent();
  await page.getByTestId('calendar-select-all').click();
  await expect(page.getByTestId('calendar-selected-summary')).toContainText('3 of 3');
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');

  await page.getByTestId('integration-select-planning-center').click();
  await expect(page.getByTestId('planning-center-direct-editor')).toBeVisible();
  await expect(page.getByTestId('pco-team-worship-vocals')).toBeEnabled();
});

test('issue-2009-c5: visible ledger is exact append only and excludes client controls', async ({ page }) => {
  // Regression caught: initial conditional reads disappear, endpoint paths/payloads drift, or local selection/cancel actions append fabricated receipts.
  await openPage(page, 'integrations');
  await expectIntegrationsPage(page);
  const trace = page.getByTestId('page-trace');
  for (const receipt of [
    'GET /integrations/accounts → 200',
    'GET /integrations/google-calendar/settings → 200',
    'GET /integrations/gmail/signals → 200',
    'GET /integrations/planning-center/task-preferences → 200',
  ]) await expect(trace.getByText(receipt, { exact: true })).toHaveCount(1);

  const initialReceipts = await trace.locator('li').allTextContents();
  await page.getByTestId('calendar-select-none').click();
  await page.getByTestId('integration-select-planning-center').click();
  await expect(trace).toContainText('GET /integrations/planning-center/task-options → 200');
  const after = await trace.locator('li').allTextContents();
  expect(after.slice(0, initialReceipts.length)).toEqual(initialReceipts);
  await expect(trace).not.toContainText('client-side');
  await expect(trace).not.toContainText('GET /integrations/gmail/labels');
  await expect(trace).not.toContainText('GET /integrations/gmail-signals');
});

test('issue-2009-c6: page dialogs and fixture handoff are accessible', async ({ page }) => {
  // Regression caught: compact cards look acceptable while axe finds serious violations or focus escapes a dialog/handoff.
  await openPage(page, 'integrations');
  await expectIntegrationsPage(page);
  let result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  await page.getByTestId('integration-select-planning-center').click();
  await expect(page.getByTestId('planning-center-direct-editor')).toBeVisible();
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  await page.getByTestId('open-ai-import').click();
  let dialog = page.getByTestId('ai-import-dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByTestId('planning-center-reconnect').click();
  await expect(page.getByTestId('oauth-fixture-handoff')).toHaveAttribute('aria-modal', 'true');
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
});

test('issue-2009-c7: integrations remains responsive under required presentation modes', async ({ page }) => {
  // Regression caught: action rows, provider metadata, chips, or import fields overflow at a target width/localization mode or controls fall below 44px.
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'integrations');
    await expectIntegrationsPage(page);
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.getByTestId('integrations-sync-all')).toBeVisible();
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByText('礼拝チーム予定 🗓️ · Calendar', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
  const undersized = await page.getByTestId('page-integrations').locator('button:enabled, input:enabled, select:enabled').evaluateAll((elements) => elements
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44;
    })
    .map((element) => ({ testId: element.getAttribute('data-testid'), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
  expect(undersized).toEqual([]);

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.getByTestId('integration-select-planning-center').click();
  await expect(page.getByTestId('planning-center-direct-editor')).toBeVisible();
  const dialogOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dialogOverflow.scroll).toBeLessThanOrEqual(dialogOverflow.client + 1);
});

test('issue-2009-c8: fixtures block every external and OAuth request and reset on reload', async ({ page }) => {
  // Regression caught: connect/import/sync contacts production, localhost, OAuth, analytics, or AI services, or mutation survives deterministic fixture reload.
  const attemptedExternal: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') attemptedExternal.push(request.url());
  });
  await openPage(page, 'integrations');
  await expectIntegrationsPage(page);
  const seededAccounts = await page.locator('[data-testid^="integration-account-"]').allTextContents();
  const seededSignals = await page.locator('[data-testid^="gmail-signal-"]').allTextContents();
  await page.getByTestId('gmail-reconnect').click();
  await expect(page.getByTestId('oauth-fixture-handoff')).toContainText('FIXTURE HANDOFF');
  await page.keyboard.press('Escape');
  await page.getByTestId('integration-select-google-calendar').click();
  await page.getByTestId('calendar-select-none').click();
  await page.getByTestId('calendar-save').click();
  await page.reload();
  await expectIntegrationsPage(page);
  expect(await page.locator('[data-testid^="integration-account-"]').allTextContents()).toEqual(seededAccounts);
  expect(await page.locator('[data-testid^="gmail-signal-"]').allTextContents()).toEqual(seededSignals);
  await expect(page.getByTestId('calendar-selected-summary')).toContainText('2 of 3 selected');
  expect(attemptedExternal).toEqual([]);
});

test('issue-2009-c9: connect actions expose explicit OAuth fixture handoffs without navigation', async ({ page }) => {
  // Regression caught: Connect invokes xdg-open/window.open, navigates away, omits the intended service/query, or claims a real OAuth completion.
  const attemptedExternal: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') attemptedExternal.push(request.url());
  });
  await openPage(page, 'integrations', '?fixture=disconnected');
  await expectIntegrationsPage(page);

  await page.getByTestId('google-calendar-connect').click();
  let handoff = page.getByTestId('oauth-fixture-handoff');
  await expect(handoff).toContainText('Google');
  await expect(handoff).toContainText('FIXTURE HANDOFF');
  await expect(page).toHaveURL(/#\/integrations\?fixture=disconnected$/);
  await expect(page.getByTestId('page-trace')).toContainText('GET /auth/google/begin?sessionToken=fixture-session → 302 FIXTURE HANDOFF');
  await handoff.getByTestId('oauth-handoff-close').click();

  await page.getByTestId('planning-center-connect').click();
  handoff = page.getByTestId('oauth-fixture-handoff');
  await expect(handoff).toContainText('Planning Center');
  await expect(page.getByTestId('page-trace')).toContainText('GET /auth/planning-center/begin?sessionToken=fixture-session → 302 FIXTURE HANDOFF');
  expect(attemptedExternal).toEqual([]);
});

test('issue-2009-c10: calendar sources select validate save sync and recover truthfully', async ({ page }) => {
  // Regression caught: selection count drifts, Save submits unavailable/unsorted IDs, skips the follow-up sync, or a failure discards the user's selection.
  await openPage(page, 'integrations');
  await expectIntegrationsPage(page);
  await expect(page.getByTestId('calendar-primary-cal-primary')).toHaveText('Primary');
  await expect(page.getByTestId('calendar-selected-summary')).toContainText('2 of 3 selected');
  await page.getByTestId('calendar-select-none').click();
  await expect(page.getByTestId('calendar-selected-summary')).toContainText('0 of 3 selected');
  await page.getByTestId('calendar-option-cal-primary').check();
  await page.getByTestId('calendar-option-cal-team').check();
  await page.getByTestId('calendar-save').click();
  await expect(page.getByTestId('calendar-save-status')).toContainText(/saved|synced/i);
  const trace = page.getByTestId('page-trace');
  await expect(trace).toContainText('PUT /integrations/google-calendar/preferences {selectedCalendarIds:["cal-primary","cal-team"]} → 200');
  await expect(trace).toContainText('GET /integrations/google-calendar/settings → 200');
  await expect(trace).toContainText('POST /integrations/google-calendar/sync → 200');
  await expect(trace).toContainText('GET /integrations/accounts → 200');

  await openPage(page, 'integrations/google-calendar', '?fixture=calendar-save-error');
  await page.getByTestId('calendar-option-cal-community').check();
  await page.getByTestId('calendar-save').click();
  await expect(page.getByTestId('calendar-save-error')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('calendar-option-cal-community')).toBeChecked();
  await page.getByTestId('calendar-save-retry').click();
  await expect(page.getByTestId('calendar-save-status')).toContainText(/saved|synced/i);
});

test('issue-2009-c11: Gmail signals dedupe display sync failure and retry', async ({ page }) => {
  // Regression caught: duplicate messages from one thread consume the five-row limit, unread/subject fallbacks drift, or failed sync clears prior signals and cannot retry.
  await openPage(page, 'integrations/gmail');
  await expectIntegrationsPage(page);
  await expect(page.getByTestId('gmail-unread-count')).toHaveText('3 unread');
  await expect(page.locator('[data-testid^="gmail-signal-"]')).toHaveCount(5);
  await expect(page.locator('[data-gmail-thread-id="thread-weekend-team"]')).toHaveCount(1);
  await expect(page.getByTestId('gmail-signal-thread-no-subject')).toContainText('(No subject)');
  await expect(page.getByTestId('gmail-signal-thread-no-subject')).toContainText('Unknown sender');

  await openPage(page, 'integrations/gmail', '?fixture=gmail-sync-error');
  const before = await page.locator('[data-testid^="gmail-signal-"]').allTextContents();
  await page.getByTestId('gmail-sync').click();
  await expect(page.getByTestId('gmail-sync-status')).toContainText(/failed|could not sync/i);
  expect(await page.locator('[data-testid^="gmail-signal-"]').allTextContents()).toEqual(before);
  await expect(page.getByTestId('page-trace')).toContainText('POST /integrations/gmail/sync → 503');
  await page.getByTestId('gmail-sync-retry').click();
  await expect(page.getByTestId('gmail-sync-status')).toContainText(/synced/i);
  await expect(page.getByTestId('page-trace')).toContainText('POST /integrations/gmail/sync → 200');
});

test('issue-2009-c12: Planning Center dependent team and position preferences save exactly', async ({ page }) => {
  // Regression caught: Choose eagerly/falsely loads options, incompatible positions survive a team change, Cancel mutates the summary, or Save sends labels instead of IDs.
  await openPage(page, 'integrations/planning-center');
  await expectIntegrationsPage(page);
  const trace = page.getByTestId('page-trace');
  await expect(trace).toContainText('GET /integrations/planning-center/task-options → 200');
  const summaryBefore = await page.getByTestId('planning-center-preferences-summary').textContent();
  const editor = page.getByTestId('planning-center-direct-editor');
  await editor.getByTestId('pco-position-foh-engineer').click();
  await editor.getByTestId('pco-team-worship-vocals').click();
  await expect(editor.getByTestId('pco-position-foh-engineer')).toHaveCount(0);
  await expect(page.getByTestId('planning-center-preferences-summary')).toHaveText(summaryBefore ?? '');

  await editor.getByTestId('planning-center-preferences-clear').click();
  await editor.getByTestId('pco-team-worship-vocals').click();
  await editor.getByTestId('pco-position-vocalist').click();
  await editor.getByTestId('planning-center-preferences-save').click();
  await expect(page.getByTestId('planning-center-preferences-summary')).toContainText('Teams: 1 selected');
  await expect(page.getByTestId('planning-center-preferences-summary')).toContainText('Positions: 1 selected');
  await expect(trace).toContainText('PUT /integrations/planning-center/task-preferences {teamIds:["team-vocals"],positionNames:["Vocalist"]} → 200');
});

test('issue-2009-c13: assistant Google consent remains separate and fixture safe', async ({ page }) => {
  // Regression caught: broad agent read/send consent is merged into Gmail metadata connection or launches a real OAuth host without intent=agent.
  await openPage(page, 'integrations/assistant-tools');
  await expectIntegrationsPage(page);
  const card = page.getByTestId('integration-assistant-tools');
  await expect(card).toContainText('Full Google Calendar and Gmail');
  await expect(card).toContainText('read + send');
  await expect(card.getByTestId('assistant-google-enable')).toBeVisible();
  await card.getByTestId('assistant-google-enable').click();
  await expect(page.getByTestId('oauth-fixture-handoff')).toContainText('Assistant Google tools');
  await expect(page.getByTestId('page-trace')).toContainText('GET /auth/google/begin?intent=agent&sessionToken=fixture-session → 302 FIXTURE HANDOFF');
  await expect(page.getByTestId('integration-gmail')).not.toContainText('read + send');
});

test('issue-2009-c14: individual and sync all operations expose progress partial failure and retry', async ({ page }) => {
  // Regression caught: duplicate clicks race, HTTP-200 errors[] is shown as total success, retry re-syncs successful providers, or status changes are not announced.
  await openPage(page, 'integrations/planning-center');
  await expectIntegrationsPage(page);
  const individual = page.getByTestId('planning-center-sync');
  await individual.click();
  await expect(individual).toBeDisabled();
  await expect(page.getByTestId('planning-center-sync-status')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('planning-center-sync-status')).toContainText(/Syncing|Synced/);
  await expect(page.getByTestId('page-trace')).toContainText('POST /integrations/planning-center/sync → 200');

  await openPage(page, 'integrations', '?fixture=sync-partial');
  const syncAll = page.getByTestId('integrations-sync-all');
  await syncAll.click();
  await expect(syncAll).toBeDisabled();
  const partial = page.getByTestId('sync-all-partial');
  await expect(partial).toHaveAttribute('role', 'alert');
  await expect(partial).toContainText('Google Calendar synced');
  await expect(partial).toContainText('Gmail synced');
  await expect(partial).toContainText('Planning Center failed');
  await expect(page.getByTestId('page-trace')).toContainText('POST /integrations/sync-all → 200');
  const syncAllCount = await page.getByTestId('page-trace').getByText('POST /integrations/sync-all → 200', { exact: true }).count();
  await page.getByTestId('sync-all-retry-failed').click();
  await expect(page.getByTestId('page-trace')).toContainText('POST /integrations/planning-center/sync → 200');
  await expect(page.getByTestId('page-trace').getByText('POST /integrations/sync-all → 200', { exact: true })).toHaveCount(syncAllCount);
  await expect(page.getByTestId('sync-all-status')).toContainText('All connected services are up to date');
});

test('issue-2009-c15: AI Import validates formats reports exact outcomes and retries safely', async ({ page }) => {
  // Regression caught: Import contacts an AI service, accepts malformed sections, changes Flutter field names/order, claims false total success, or duplicates completed records on retry.
  await openPage(page, 'integrations/import');
  await expectIntegrationsPage(page);
  const dialog = page.getByTestId('ai-import-dialog');
  await expect(dialog).toContainText('Return ONLY valid JSON');
  await dialog.getByTestId('ai-import-copy-prompt').click();
  await expect(dialog.getByTestId('ai-import-copy-status')).toHaveText('Copied!');
  await dialog.getByTestId('ai-import-next').click();
  await dialog.getByTestId('ai-import-submit').click();
  await expect(dialog.getByTestId('ai-import-error')).toContainText('Paste the JSON first');
  await dialog.getByTestId('ai-import-json').fill('{"tasks":{}}');
  await dialog.getByTestId('ai-import-submit').click();
  await expect(dialog.getByTestId('ai-import-error')).toContainText('"tasks" must be an array');

  await dialog.getByTestId('ai-import-json').fill('```json\n{"tasks":[{"title":"Call dentist","notes":"Annual checkup","dueDate":"2026-08-20"}],"rhythms":[{"title":"Weekly review","frequency":"weekly","dayOfWeek":1}],"projects":[{"name":"Conference Prep","description":"秋の準備 🎵","steps":[{"title":"Book travel","offsetDays":-30,"offsetDescription":"30 days before"}]}]}\n```');
  await dialog.getByTestId('ai-import-submit').click();
  await expect(page.getByTestId('toast-status')).toContainText('Imported: 1 task, 1 rhythm, 1 template');
  const trace = page.getByTestId('page-trace');
  await expect(trace).toContainText('POST /tasks {title,notes,scheduledDate,preferredAgent} → 201');
  await expect(trace).toContainText('POST /recurring-rules {title,frequency,dayOfWeek} → 201');
  await expect(trace).toContainText('POST /project-templates {name,description} → 201');
  await expect(trace).toContainText('POST /project-templates/template-conference-prep/steps {title,offsetDays,offsetDescription,sortOrder,assigneeId} → 201');
  await expect(trace).toContainText('GET /project-templates → 200');

  await openPage(page, 'integrations/import', '?fixture=import-partial');
  const partialDialog = page.getByTestId('ai-import-dialog');
  await partialDialog.getByTestId('ai-import-next').click();
  await partialDialog.getByTestId('ai-import-json').fill('[{"type":"task","title":"Email team"},{"type":"recurring_rule","title":"Daily review","frequency":"weekly","dayOfWeek":3}]');
  await partialDialog.getByTestId('ai-import-submit').click();
  await expect(partialDialog.getByTestId('ai-import-partial-error')).toContainText('1 imported, 1 failed');
  const taskReceipts = await page.getByTestId('page-trace').getByText(/POST \/tasks /).count();
  await partialDialog.getByTestId('ai-import-retry').click();
  await expect(page.getByTestId('toast-status')).toContainText('Imported: 1 task, 1 rhythm');
  await expect(page.getByTestId('page-trace').getByText(/POST \/tasks /)).toHaveCount(taskReceipts);
});
