import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const calendarRuleId = 'rule-calendar-room';
const gmailRuleId = 'rule-gmail-follow-up';

async function expectAutomationsPage(page: Page) {
  await expect(page.getByTestId('page-automations')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Automations' })).toHaveCount(1);
  await expect(page.getByTestId('module-placeholder')).toHaveCount(0);
}

async function openBuilder(page: Page) {
  const trigger = page.getByTestId('automations-new');
  await trigger.click();
  const dialog = page.getByTestId('automations-builder-dialog');
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}

test('issue-2008-c1: automations route and rule deep links render the real page shell', async ({ page }) => {
  // Regression caught: #/automations or a rule deep link keeps rendering ModulePlaceholder, loses shell selection, or fabricates a detail endpoint.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  await expect(page.getByTestId('nav-automations')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId(`automation-rule-${calendarRuleId}`)).toBeVisible();

  await openPage(page, `automations/${calendarRuleId}`);
  await expectAutomationsPage(page);
  await expect(page.getByTestId(`automation-rule-${calendarRuleId}`)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('automation-preview-dialog')).toContainText('Book a room');
  await expect(page.getByTestId('page-trace')).toContainText(`GET /automation-rules/${calendarRuleId}/preview → 200`);

  await openPage(page, 'automations/rule-does-not-exist');
  await expect(page.getByTestId('automation-rule-not-found')).toContainText('Automation not found');
  const traceBefore = await page.getByTestId('page-trace').textContent();
  await page.getByTestId('automations-back-to-list').click();
  await expect(page).toHaveURL(/#\/automations(?:\?|$)/);
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');
});

test('issue-2008-c2: rule grouping ordering and enabled statistics are deterministic', async ({ page }) => {
  // Regression caught: rules sort alphabetically/randomly, enabled switches drift from fixtures, statistics disagree, or web-only search/filter controls appear.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const groups = page.locator('[data-testid^="automation-group-"]');
  await expect(groups).toHaveCount(4);
  for (const source of ['rhythm', 'planning_center', 'google_calendar', 'gmail']) {
    await expect(page.getByTestId(`automation-group-${source}`)).toHaveAttribute('data-source', source);
  }
  const sources = await groups.evaluateAll((elements) => elements.map((group) => group.getAttribute('data-source')));
  expect(sources).toEqual(['rhythm', 'planning_center', 'google_calendar', 'gmail']);
  await expect(page.getByTestId('automations-rule-count')).toHaveText('5');
  await expect(page.getByTestId('automations-enabled-count')).toHaveText('4');
  await expect(page.getByTestId(`automation-enabled-${calendarRuleId}`)).toBeChecked();
  await expect(page.getByTestId(`automation-enabled-${gmailRuleId}`)).not.toBeChecked();
  await expect(page.getByTestId('automations-search')).toHaveCount(0);
  await expect(page.getByTestId('automations-filter')).toHaveCount(0);
});

test('issue-2008-c3: shared state matrix exposes deterministic recovery and readonly inspection', async ({ page }) => {
  // Regression caught: a URL state is blank/dead, Retry reloads, empty cannot create, or readonly hides inspection while leaving mutation enabled.
  await openPage(page, 'automations', '?state=loading');
  await expect(page.getByTestId('page-state-loading')).toContainText('Loading automations');

  await openPage(page, 'automations', '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toContainText('No automations');
  await page.getByTestId('automations-empty-create').click();
  await expect(page.getByTestId('automations-builder-dialog')).toBeVisible();

  await openPage(page, 'automations', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');
  await page.getByTestId('page-retry').click();
  await expectAutomationsPage(page);
  await expect(page).toHaveURL(/state=ready/);

  await openPage(page, 'automations', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('workspace');
  await openPage(page, 'automations', '?state=unavailable');
  await expect(page.getByTestId('page-state-unavailable')).toContainText('Rhythm API');

  await openPage(page, `automations/${calendarRuleId}`, '?state=readonly');
  await expect(page.getByTestId('page-state-readonly')).toContainText('read-only');
  await expect(page.getByTestId('automations-mutations')).toHaveAttribute('disabled', '');
  await expect(page.getByTestId('automations-mutations')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('automation-direct-editor').getByTestId('automation-name')).toBeDisabled();
  await expect(page.getByTestId(`automation-resync-${calendarRuleId}`)).toBeDisabled();
  await expect(page.getByTestId('automation-preview-dialog')).toBeVisible();
});

test('issue-2008-c4: controls are live receipt-honest and modal focus is restored', async ({ page }) => {
  // Regression caught: an enabled control lacks stable identity/outcome, or Escape closes inspection/builders without restoring the invoking control.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const enabled = page.getByTestId('page-automations').locator('button:enabled, input:enabled, select:enabled, textarea:enabled');
  const missingTestIds = await enabled.evaluateAll((elements) => elements
    .filter((element) => !/^[-a-z0-9]+$/.test(element.getAttribute('data-testid') ?? ''))
    .map((element) => element.outerHTML));
  expect(missingTestIds).toEqual([]);

  const inspect = page.getByTestId(`automation-inspect-${calendarRuleId}`);
  await inspect.click();
  await expect(page.getByTestId('automation-preview-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(inspect).toBeFocused();

  const { trigger } = await openBuilder(page);
  await expect(page.getByTestId('automations-builder-dialog').getByTestId('automation-name')).toBeFocused();
  const traceAfterOpen = await page.getByTestId('page-trace').textContent();
  expect(traceAfterOpen).toContain('GET /facilities → 200');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId('page-trace')).toHaveText(traceAfterOpen ?? '');
});

test('issue-2008-c5: bootstrap ledger records exact catalog dependency receipts', async ({ page }) => {
  // Regression caught: the page omits a Flutter dependency, assumes a similarly named endpoint, or records the wrong simulated status.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const trace = page.getByTestId('page-trace');
  for (const receipt of [
    'GET /automation-rules → 200',
    'GET /automation-catalog/triggers → 200',
    'GET /automation-catalog/actions → 200',
    'GET /automation-catalog/providers → 200',
    'GET /integrations/accounts → 200',
    'GET /integrations/planning-center/task-options → 200',
    'GET /integrations/gmail/labels → 200',
    'GET /project-templates → 200',
  ]) {
    await expect(trace.getByText(receipt, { exact: true })).toHaveCount(1);
  }
  await expect(trace.getByText('GET /facilities → 200', { exact: true })).toHaveCount(0);
});

test('issue-2008-c6: ready page and builder satisfy axe and modal focus', async ({ page }) => {
  // Regression caught: the dense rule surface appears correct while axe finds serious violations or keyboard focus escapes the builder.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  let result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  const { dialog } = await openBuilder(page);
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog.getByTestId('automation-name')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
});

test('issue-2008-c7: automations remains responsive under required presentation modes', async ({ page }) => {
  // Regression caught: rule actions or the 620px builder force horizontal scroll, touch targets shrink, or alternate presentation modes become unusable.
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openPage(page, 'automations');
    await expectAutomationsPage(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
  });
  await expect(page.getByTestId('page-automations')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const undersized = await page.getByTestId('page-automations').locator('button:visible, input:visible, select:visible').evaluateAll((controls) => controls
    .filter((control) => {
      const rect = control.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44;
    })
    .map((control) => control.getAttribute('data-testid')));
  expect(undersized).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await expect(page.getByTestId(`automation-rule-${calendarRuleId}`)).toContainText(/会場|📅|Book a room/);
});

test('issue-2008-c8: fixture isolation blocks external I O and reload resets rule state', async ({ page }) => {
  // Regression caught: a fixture control contacts API/OAuth hosts, generates time-based ids, or persists local mutations across reload.
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') external.push(request.url());
  });
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const initialIds = await page.locator('[data-rule-id]').evaluateAll((rules) => rules.map((rule) => rule.getAttribute('data-rule-id')));
  await page.getByTestId(`automation-enabled-${calendarRuleId}`).uncheck();
  await expect(page.getByTestId('automations-enabled-count')).toHaveText('3');
  await page.reload();
  await expectAutomationsPage(page);
  await expect(page.getByTestId(`automation-enabled-${calendarRuleId}`)).toBeChecked();
  const reloadedIds = await page.locator('[data-rule-id]').evaluateAll((rules) => rules.map((rule) => rule.getAttribute('data-rule-id')));
  expect(reloadedIds).toEqual(initialIds);
  expect(external).toEqual([]);
});

test('issue-2008-c9: provider prerequisites and dependency failures remain explicit', async ({ page }) => {
  // Regression caught: an empty/invalid/provider-error fixture exposes runnable controls, hides the prerequisite, or opens a real OAuth URL.
  await openPage(page, 'automations', '?state=catalog-empty');
  await expect(page.getByTestId('automations-catalog-empty')).toContainText('automation catalog');
  await expect(page.getByTestId('automations-new')).toBeDisabled();

  await openPage(page, 'automations', '?state=invalid-config');
  await expect(page.getByTestId('automation-invalid-config')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('automation-invalid-config')).toContainText('trigger');
  await expect(page.getByTestId('automation-invalid-run')).toBeDisabled();
  await expect(page.getByTestId('automation-invalid-edit')).toBeEnabled();

  await openPage(page, 'automations', '?state=provider-error');
  await expect(page.getByTestId('automation-provider-error')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('automation-provider-error')).toContainText(/reconnect/i);
  await expect(page.getByTestId('automation-provider-resync')).toBeDisabled();
  await page.getByTestId('automations-open-integrations').click();
  await expect(page).toHaveURL(/#\/integrations/);
});

test('issue-2008-c10: builder choices follow provider trigger and action catalogs', async ({ page }) => {
  // Regression caught: builder choices are static, PCO loses multi-select, reservation appears for unsupported sources, or auxiliary catalogs are not used.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const { dialog } = await openBuilder(page);
  await expect(page.getByTestId('page-trace')).toContainText('GET /facilities → 200');

  const source = dialog.getByTestId('automation-source');
  await source.selectOption('planning_center');
  await expect(dialog.getByTestId('automation-account')).toHaveValue('account-pco-production');
  await expect(dialog.locator('[data-testid^="automation-trigger-pco-"]')).toHaveCount(8);
  await dialog.getByTestId('automation-trigger-pco-plan-upcoming').check();
  await dialog.getByTestId('automation-trigger-pco-volunteer-declined').check();
  await expect(dialog.getByTestId('automation-pco-team-worship')).toBeVisible();
  let actions = await dialog.getByTestId('automation-action').locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(actions).toEqual(['create_task', 'create_project_from_template']);

  await dialog.getByTestId('automation-add-condition').click();
  await expect(dialog.getByTestId('automation-condition-field-0').locator('option')).toContainText(['title', 'serviceTypeName', 'teamName', 'positionName', 'planDate']);
  await source.selectOption('google_calendar');
  actions = await dialog.getByTestId('automation-action').locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(actions).toContain('create_reservation');
  await expect(dialog.getByTestId('automation-condition-field-0').locator('option')).toContainText(['title', 'description', 'location', 'eventType']);
  await source.selectOption('gmail');
  actions = await dialog.getByTestId('automation-action').locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(actions).not.toContain('create_reservation');
  await expect(dialog.getByTestId('automation-gmail-label').locator('option')).toContainText(['Any label', 'Unread', 'Inbox', 'Worship']);
});

test('issue-2008-c11: create edit and delete update the list with exact receipts', async ({ page }) => {
  // Regression caught: CRUD mutates twice/the wrong rule, statistics stay stale, or route methods/payload/statuses differ from Flutter.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const { dialog } = await openBuilder(page);
  await dialog.getByTestId('automation-name').fill('Wednesday rehearsal follow-up');
  await dialog.getByTestId('automation-source').selectOption('rhythm');
  await dialog.getByTestId('automation-trigger').selectOption('rhythm.task_due');
  await dialog.getByTestId('automation-action').selectOption('create_task');
  await dialog.getByTestId('automation-title-template').fill('Prepare {{title}}');
  await dialog.getByTestId('automation-builder-submit').click();
  const createdId = 'rule-wednesday-rehearsal-follow-up';
  const created = page.getByTestId(`automation-rule-${createdId}`);
  await expect(created).toHaveCount(1);
  await expect(page.getByTestId('automations-rule-count')).toHaveText('6');
  await expect(page.getByTestId('page-trace')).toContainText('POST /automation-rules {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,enabled,conditions} → 201');

  await page.getByTestId(`automation-select-${createdId}`).click();
  const directEditor = page.getByTestId('automation-direct-editor');
  await directEditor.getByTestId('automation-name').fill('Wednesday rehearsal prep');
  await directEditor.getByTestId('automation-builder-submit').click();
  await expect(created).toContainText('Wednesday rehearsal prep');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /automation-rules/${createdId} {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,conditions} → 200`);

  // Lead edit (authorized): delete goes through the approved cross-page confirmation hardening.
  // Cancel must preserve the rule; Confirm keeps every original outcome assertion.
  await created.getByTestId(`automation-delete-${createdId}`).click();
  await page.getByTestId('automation-delete-cancel').click();
  await expect(created).toHaveCount(1);
  await created.getByTestId(`automation-delete-${createdId}`).click();
  await page.getByTestId('automation-delete-confirm').click();
  await expect(created).toHaveCount(0);
  await expect(page.getByTestId('automations-rule-count')).toHaveText('5');
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /automation-rules/${createdId} → 204`);
});

test('issue-2008-c12: enabled switch patches one rule and preserves deterministic order', async ({ page }) => {
  // Regression caught: toggling reorders rules, changes another card/count, or sends a full edit payload instead of enabled-only PATCH.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const orderBefore = await page.locator('[data-rule-id]').evaluateAll((rules) => rules.map((rule) => rule.getAttribute('data-rule-id')));
  const toggle = page.getByTestId(`automation-enabled-${calendarRuleId}`);
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('automations-enabled-count')).toHaveText('3');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /automation-rules/${calendarRuleId} {enabled} → 200`);
  await toggle.check();
  await expect(page.getByTestId('automations-enabled-count')).toHaveText('4');
  await expect(page.getByTestId('page-trace').getByText(`PATCH /automation-rules/${calendarRuleId} {enabled} → 200`, { exact: true })).toHaveCount(2);
  const orderAfter = await page.locator('[data-rule-id]').evaluateAll((rules) => rules.map((rule) => rule.getAttribute('data-rule-id')));
  expect(orderAfter).toEqual(orderBefore);
});

test('issue-2008-c13: preview renders historical match evidence without mutation', async ({ page }) => {
  // Regression caught: Preview pretends to dry-run changes, mutates execution state, or uses a non-existent endpoint/method.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const cardBefore = await page.getByTestId(`automation-rule-${calendarRuleId}`).textContent();
  await page.getByTestId(`automation-inspect-${calendarRuleId}`).click();
  const preview = page.getByTestId('automation-preview-dialog');
  await expect(preview).toContainText('When Calendar event matches filter');
  await expect(preview).toContainText('2 matches last run');
  await expect(preview).toContainText('Latest sample');
  await expect(preview).toContainText('会場');
  await expect(preview.getByText(/changes will be made/i)).toHaveCount(0);
  await preview.getByTestId('automation-preview-close').click();
  await expect(page.getByTestId(`automation-rule-${calendarRuleId}`)).toHaveText(cardBefore ?? '');
  await expect(page.getByTestId('page-trace').getByText(`GET /automation-rules/${calendarRuleId}/preview → 200`, { exact: true })).toHaveCount(1);
  const ledger = await page.getByTestId('page-trace').textContent() ?? '';
  expect(ledger).not.toMatch(new RegExp(`(?:POST|PATCH|DELETE) /automation-rules/${calendarRuleId}(?:\\s|$)`));
});

test('issue-2008-c14: resync exposes progress result receipt and deterministic reload', async ({ page }) => {
  // Regression caught: Resync remains clickable, hides progress/results, omits its receipt/reload, or duplicates the refreshed rule.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const button = page.getByTestId(`automation-resync-${calendarRuleId}`);
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByTestId(`automation-resync-progress-${calendarRuleId}`)).toHaveAttribute('role', 'status');
  await expect(page.getByTestId(`automation-resync-result-${calendarRuleId}`)).toContainText('2 matched');
  await expect(page.getByTestId(`automation-resync-result-${calendarRuleId}`)).toContainText('1 action');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /automation-rules/${calendarRuleId}/resync → 200`);
  await expect(page.getByTestId('page-trace').getByText('GET /automation-rules → 200', { exact: true })).toHaveCount(2);
  await expect(page.getByTestId(`automation-rule-${calendarRuleId}`)).toHaveCount(1);
  await expect(button).toBeEnabled();
});

test('issue-2008-c15: builder validates required action fields and omits blank conditions', async ({ page }) => {
  // Regression caught: required action config submits blank or Flutter-optional blank conditions leak into the payload.
  await openPage(page, 'automations');
  await expectAutomationsPage(page);
  const { dialog } = await openBuilder(page);
  await dialog.getByTestId('automation-source').selectOption('planning_center');
  await dialog.getByTestId('automation-action').selectOption('create_project_from_template');
  await dialog.getByTestId('automation-builder-submit').click();
  await expect(dialog.getByRole('alert')).toContainText('template name');
  await expect(page.getByTestId('page-trace').getByText(/POST \/automation-rules /)).toHaveCount(0);

  await dialog.getByTestId('automation-source').selectOption('google_calendar');
  await dialog.getByTestId('automation-action').selectOption('create_reservation');
  await dialog.getByTestId('automation-builder-submit').click();
  await expect(dialog.getByRole('alert')).toContainText('Pick a room');
  await expect(page.getByTestId('page-trace').getByText(/POST \/automation-rules /)).toHaveCount(0);

  await dialog.getByTestId('automation-source').selectOption('gmail');
  await dialog.getByTestId('automation-action').selectOption('send_notification');
  await dialog.getByTestId('automation-add-condition').click();
  await dialog.getByTestId('automation-builder-submit').click();
  await expect(dialog.getByRole('alert')).toContainText('message template');
  await expect(page.getByTestId('page-trace').getByText(/POST \/automation-rules /)).toHaveCount(0);

  await dialog.getByTestId('automation-message-template').fill('Follow up with {{sender}} about {{subject}}');
  await expect(dialog.getByTestId('automation-review')).toContainText('Gmail');
  await dialog.getByTestId('automation-builder-submit').click();
  await expect(page.getByTestId('automation-rule-rule-gmail-message-matches-filter')).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText('POST /automation-rules {name,source,triggerKey,actionType,triggerConfig,actionConfig,sourceAccountId,enabled,conditions} → 201');
  await expect(page.getByTestId('automation-rule-rule-gmail-message-matches-filter')).toHaveAttribute('data-condition-count', '0');
});
