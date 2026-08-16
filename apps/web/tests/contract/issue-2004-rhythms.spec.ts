import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const ruleId = 'rhythm-weekend-service';
const ruleTitle = 'Weekend service cadence';

async function expectRhythmsPage(page: Page) {
  await expect(page.getByTestId('page-rhythms')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Rhythms' })).toHaveCount(1);
}

test('issue-2004-c1: rhythms route and deep links render the real page shell', async ({ page }) => {
  // Regression caught: #/rhythms continues rendering ModulePlaceholder or deep links lose the selected rule/edit state.
  await openPage(page, 'rhythms');
  await expectRhythmsPage(page);
  await expect(page.getByTestId('page-trace')).toContainText('GET /recurring-rules → 200');
  await expect(page.getByTestId('page-trace')).toContainText('GET /workspaces/me/members → 200');

  await openPage(page, `rhythms/rule/${ruleId}`);
  await expectRhythmsPage(page);
  await expect(page.getByTestId('rhythm-detail')).toContainText(ruleTitle);

  await openPage(page, `rhythms/rule/${ruleId}/edit`);
  await expectRhythmsPage(page);
  await expect(page.getByTestId('rhythm-direct-editor')).toBeVisible();
  await expect(page.getByTestId('rhythm-direct-editor').getByTestId('rhythm-edit-title')).toHaveValue(ruleTitle);
});

test('issue-2004-c2: ready list exposes exact schedules progress and enabled state without invented filters', async ({ page }) => {
  // Regression caught: the redesign invents search/filter affordances or drops Flutter's exact schedule/status/progress information.
  await openPage(page, 'rhythms');
  await expectRhythmsPage(page);

  const cards = page.locator('[data-testid^="rhythm-card-"]');
  await expect(cards).toHaveCount(4);
  await expect(page.getByTestId(`rhythm-card-${ruleId}`)).toContainText(ruleTitle);
  await expect(page.getByTestId(`rhythm-pattern-${ruleId}`)).toHaveText('Every Sunday');
  await expect(page.getByTestId(`rhythm-progress-${ruleId}`)).toHaveText('75%');
  await expect(page.getByTestId(`rhythm-status-${ruleId}`)).toHaveText('Enabled');
  await expect(page.getByTestId('rhythm-pattern-rhythm-monthly-care')).toHaveText('Monthly on the 15th');
  await expect(page.getByTestId('rhythm-status-rhythm-monthly-care')).toHaveText('Paused');
  await expect(page.getByTestId('rhythm-pattern-rhythm-annual-safety')).toHaveText('Every September 1st');
  await expect(page.getByTestId('rhythms-search')).toHaveCount(0);
  await expect(page.locator('[data-testid^="rhythms-filter-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="rhythms-sort-"]')).toHaveCount(0);
});

test('issue-2004-c3: selected detail exposes deterministic ownership progress and next due data', async ({ page }) => {
  // Regression caught: the selected rule shows a decorative donut but hides the generated-task counts, ownership, collaborators, or next due returned by the API.
  await openPage(page, `rhythms/rule/${ruleId}`);
  await expectRhythmsPage(page);
  const detail = page.getByTestId('rhythm-detail');
  await expect(detail.getByTestId('rhythm-owner')).toHaveText('AJ Hochhalter');
  await expect(detail.getByTestId('rhythm-generated-count')).toHaveText('4 generated tasks');
  await expect(detail.getByTestId('rhythm-completed-count')).toHaveText('3 completed');
  await expect(detail.getByTestId('rhythm-remaining-count')).toHaveText('1 remaining');
  await expect(detail.getByTestId('rhythm-waiting-on')).toHaveText('Waiting on Morgan Lee');
  await expect(detail.getByTestId('rhythm-next-due')).toContainText('Sunday, August 16, 2026');
  await expect(detail.getByTestId('rhythm-collaborator-3')).toContainText('Morgan Lee');
  await expect(page.getByTestId('page-trace')).not.toContainText(`GET /recurring-rules/${ruleId}`);
  await expect(page.getByTestId('page-trace')).not.toContainText('/generate');
});

test('issue-2004-c4: create validates recurrence and supported step template fields', async ({ page }) => {
  // Regression caught: Create accepts blank/invalid recurrence, exposes unsupported task fields, drops step ownership/schedule, or inserts without the exact POST receipt.
  await openPage(page, 'rhythms');
  await expectRhythmsPage(page);
  await page.getByTestId('rhythms-new-rule').click();
  const dialog = page.getByTestId('rhythm-create-dialog');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  const createReceiptsBefore = await page.getByTestId('page-trace').getByText(/POST \/recurring-rules /).count();
  await dialog.getByTestId('rhythm-create-submit').click();
  expect(await dialog.getByTestId('rhythm-create-title').evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await expect(page.getByTestId('page-trace').getByText(/POST \/recurring-rules /)).toHaveCount(createReceiptsBefore);

  await dialog.getByTestId('rhythm-create-title').fill('Monthly care follow-up');
  await dialog.getByTestId('rhythm-create-frequency').selectOption('monthly');
  await dialog.getByTestId('rhythm-create-day-of-month').fill('32');
  await dialog.getByTestId('rhythm-create-submit').click();
  await expect(dialog.getByTestId('rhythm-create-day-of-month')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('page-trace').getByText(/POST \/recurring-rules /)).toHaveCount(createReceiptsBefore);
  await dialog.getByTestId('rhythm-create-day-of-month').fill('20');

  await dialog.getByTestId('rhythm-add-step').click();
  await dialog.getByTestId('rhythm-add-step').click();
  await dialog.getByTestId('rhythm-step-title-0').fill('Prepare care list');
  await dialog.getByTestId('rhythm-step-assignee-0').selectOption('2');
  await dialog.getByTestId('rhythm-step-day-of-month-0').fill('20');
  await dialog.getByTestId('rhythm-step-title-1').fill('Send follow-up');
  await dialog.getByTestId('rhythm-step-day-of-month-1').fill('21');
  await dialog.getByTestId('rhythm-create-sequential').check();
  await expect(dialog.getByLabel('Owner')).toHaveCount(0);
  await expect(dialog.getByLabel('Notes')).toHaveCount(0);
  await expect(dialog.getByLabel('Due date')).toHaveCount(0);
  await dialog.getByTestId('rhythm-create-submit').click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('rhythm-card-rhythm-monthly-care-follow-up')).toContainText('Monthly care follow-up');
  await expect(page.getByTestId('rhythm-detail')).toContainText('Monthly care follow-up');
  await expect(page.getByTestId('page-trace')).toContainText('POST /recurring-rules {title,frequency,dayOfMonth,sequential,steps} → 201');
});

test('issue-2004-c5: edit prepopulates validates and updates supported fields', async ({ page }) => {
  // Regression caught: Edit opens with defaults instead of the selected rule, silently saves invalid annual dates, or leaves the card/detail stale after PATCH.
  await openPage(page, `rhythms/rule/${ruleId}/edit`);
  await expectRhythmsPage(page);
  const editor = page.getByTestId('rhythm-direct-editor');
  await expect(editor.getByTestId('rhythm-edit-title')).toHaveValue(ruleTitle);
  await expect(editor.getByTestId('rhythm-edit-frequency')).toHaveValue('weekly');
  await editor.getByTestId('rhythm-edit-title').fill('Weekend service annual reset');
  await editor.getByTestId('rhythm-edit-frequency').selectOption('annual');
  await editor.getByTestId('rhythm-edit-month').selectOption('9');
  await editor.getByTestId('rhythm-edit-day-of-month').fill('6');
  await editor.getByTestId('rhythm-step-month-0').selectOption('9');
  await editor.getByTestId('rhythm-step-day-of-month-0').fill('6');
  await editor.getByTestId('rhythm-edit-submit').click();

  await expect(editor).toBeVisible();
  await expect(page.getByTestId(`rhythm-card-${ruleId}`)).toContainText('Weekend service annual reset');
  await expect(page.getByTestId(`rhythm-pattern-${ruleId}`)).toHaveText('Every September 6th');
  await expect(page.getByTestId('rhythm-detail')).toContainText('Weekend service annual reset');
  await expect(page.getByTestId('rhythm-owner')).toHaveText('AJ Hochhalter');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /recurring-rules/${ruleId} {title,frequency,dayOfMonth,month,sequential,steps} → 200`);
});

test('issue-2004-c6: enable and pause update the selected rule with exact receipts', async ({ page }) => {
  // Regression caught: pause changes only switch styling, mutates another card, retains a false next due, or omits its exact PATCH receipt.
  await openPage(page, `rhythms/rule/${ruleId}`);
  await expectRhythmsPage(page);
  const enabled = page.getByTestId(`rhythm-enabled-${ruleId}`);
  await enabled.uncheck();
  await expect(page.getByTestId(`rhythm-status-${ruleId}`)).toHaveText('Paused');
  await expect(page.getByTestId('rhythm-next-due')).toContainText('Paused - no next generation');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /recurring-rules/${ruleId} {enabled:false} → 200`);
  await expect(page.getByTestId('rhythm-status-rhythm-annual-safety')).toHaveText('Enabled');

  await enabled.check();
  await expect(page.getByTestId(`rhythm-status-${ruleId}`)).toHaveText('Enabled');
  await expect(page.getByTestId('rhythm-next-due')).toContainText('Sunday, August 16, 2026');
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /recurring-rules/${ruleId} {enabled:true} → 200`);
});

test('issue-2004-c7: collaborator add remove and owner prerequisite are observable', async ({ page }) => {
  // Regression caught: collaborator chips mutate only locally, offer the owner/existing people, use the wrong 201 status, or expose owner controls on a shared rule.
  await openPage(page, `rhythms/rule/${ruleId}`);
  await expectRhythmsPage(page);
  const detail = page.getByTestId('rhythm-detail');
  await detail.getByTestId('rhythm-add-collaborator').click();
  const picker = page.getByTestId('rhythm-collaborator-picker');
  await expect(picker.getByRole('option', { name: /AJ Hochhalter/ })).toHaveCount(0);
  await expect(picker.getByRole('option', { name: /Morgan Lee/ })).toHaveCount(0);
  await picker.getByRole('option', { name: /Riley Chen/ }).click();
  await expect(detail.getByTestId('rhythm-collaborator-2')).toContainText('Riley Chen');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /recurring-rules/${ruleId}/collaborators {userId} → 200`);

  await detail.getByTestId('rhythm-remove-collaborator-2').click();
  await expect(detail.getByTestId('rhythm-collaborator-2')).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /recurring-rules/${ruleId}/collaborators/2 → 204`);
  await expect(page.getByTestId('page-trace')).not.toContainText(`GET /recurring-rules/${ruleId}/collaborators`);

  await openPage(page, 'rhythms/rule/rhythm-shared-care', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('Only the rhythm owner can manage collaborators');
  await expect(page.getByTestId('rhythm-add-collaborator')).toBeDisabled();
});

test('issue-2004-c8: delete confirmation preserves generated-task truth and updates selection', async ({ page }) => {
  // Regression caught: Delete acts immediately, Cancel removes the rule, confirmation promises generated tasks are deleted, or successful deletion leaves selection/receipt stale.
  await openPage(page, `rhythms/rule/${ruleId}`);
  await expectRhythmsPage(page);
  await page.getByTestId(`rhythm-delete-${ruleId}`).click();
  let dialog = page.getByTestId('rhythm-delete-dialog');
  await expect(dialog).toContainText(`Delete "${ruleTitle}"?`);
  await expect(dialog).toContainText('This will not remove already-generated tasks.');
  await dialog.getByTestId('rhythm-delete-cancel').click();
  await expect(page.getByTestId(`rhythm-card-${ruleId}`)).toBeVisible();

  await page.getByTestId(`rhythm-delete-${ruleId}`).click();
  dialog = page.getByTestId('rhythm-delete-dialog');
  await dialog.getByTestId('rhythm-delete-confirm').click();
  await expect(page.getByTestId(`rhythm-card-${ruleId}`)).toHaveCount(0);
  await expect(page.getByTestId('rhythm-detail')).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /recurring-rules/${ruleId} → 204`);
});

test('issue-2004-c9: deterministic state matrix remains actionable and read only is native', async ({ page }) => {
  // Regression caught: a fixture state is blank/dead, Retry requires reload, or readonly styling leaves mutation enabled.
  await openPage(page, 'rhythms', '?state=loading');
  await expect(page.getByTestId('page-state-loading')).toContainText('Loading rhythms');

  await openPage(page, 'rhythms', '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toContainText('No recurring rules yet');
  await page.getByTestId('rhythms-empty-create').click();
  await expect(page.getByTestId('rhythm-create-title')).toBeFocused();

  await openPage(page, 'rhythms', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');
  await page.getByTestId('page-retry').click();
  await expectRhythmsPage(page);
  await expect(page).toHaveURL(/state=ready/);

  await openPage(page, 'rhythms', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('rhythm owner');
  await openPage(page, 'rhythms', '?state=unavailable');
  await expect(page.getByTestId('page-state-unavailable')).toContainText('recurring-rule service');
  await openPage(page, `rhythms/rule/${ruleId}`, '?state=readonly');
  await expect(page.getByTestId('page-state-readonly')).toContainText('source of truth');
  await expect(page.getByTestId('rhythms-mutations')).toBeDisabled();
  await expect(page.getByTestId(`rhythm-inspect-${ruleId}`)).toBeEnabled();
  await expect(page.getByTestId('rhythm-detail')).toContainText(ruleTitle);
});

test('issue-2004-c10: enabled controls are identifiable live and dialogs restore focus', async ({ page }) => {
  // Regression caught: an enabled control is unlabeled/dead, or Escape strands focus after a dialog while client interactions fake API work.
  await openPage(page, 'rhythms');
  await expectRhythmsPage(page);
  const enabled = page.getByTestId('page-rhythms').locator('button:enabled, input:enabled, select:enabled, textarea:enabled');
  const missingTestIds = await enabled.evaluateAll((elements) => elements
    .filter((element) => !/^[-a-z0-9]+$/.test(element.getAttribute('data-testid') ?? ''))
    .map((element) => element.outerHTML));
  expect(missingTestIds).toEqual([]);

  const traceBefore = await page.getByTestId('page-trace').textContent();
  const trigger = page.getByTestId('rhythms-new-rule');
  await trigger.focus();
  await trigger.click();
  await expect(page.getByTestId('rhythm-create-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rhythm-create-dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByTestId(`rhythm-inspect-${ruleId}`).click();
  await expect(page.getByTestId('rhythm-detail')).toBeVisible();
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');
});

test('issue-2004-c11: trace ledger is exact append only and excludes unused endpoint families', async ({ page }) => {
  // Regression caught: initial read receipts disappear after mutation or the ledger claims unused users/detail/step routes were called.
  await openPage(page, `rhythms/rule/${ruleId}`);
  await expectRhythmsPage(page);
  const trace = page.getByTestId('page-trace');
  await expect(trace.getByText('GET /recurring-rules → 200', { exact: true })).toHaveCount(1);
  await expect(trace.getByText('GET /workspaces/me/members → 200', { exact: true })).toHaveCount(1);
  await expect(trace).not.toContainText('GET /users');
  await expect(trace).not.toContainText(`GET /recurring-rules/${ruleId}`);
  await expect(trace).not.toContainText('/steps');

  await page.getByTestId(`rhythm-enabled-${ruleId}`).uncheck();
  await expect(trace.getByText('GET /recurring-rules → 200', { exact: true })).toHaveCount(1);
  await expect(trace.getByText('GET /workspaces/me/members → 200', { exact: true })).toHaveCount(1);
  await expect(trace).toContainText(`PATCH /recurring-rules/${ruleId} {enabled:false} → 200`);
});

test('issue-2004-c12: ready page and dialogs are accessible', async ({ page }) => {
  // Regression caught: the compact list passes visual review while axe finds serious violations or dialog focus escapes its semantic boundary.
  await openPage(page, 'rhythms');
  await expectRhythmsPage(page);
  let result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  await page.getByTestId('rhythms-new-rule').click();
  const dialog = page.getByTestId('rhythm-create-dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByLabel('Title')).toBeFocused();
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  for (let index = 0; index < 10; index += 1) await page.keyboard.press('Tab');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="rhythm-create-dialog"]') != null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rhythms-new-rule')).toBeFocused();
});

test('issue-2004-c13: rhythms is responsive under required widths text scale rtl and touch sizing', async ({ page }) => {
  // Regression caught: rule cards or the step editor overflow at a target width/localization mode, or compact controls fall below the 44px target.
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'rhythms');
    await expectRhythmsPage(page);
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.getByTestId('rhythms-new-rule')).toBeVisible();
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByText('礼拜准备节奏 🎵', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
  const undersized = await page.getByTestId('page-rhythms').locator('button:enabled, input:enabled, select:enabled').evaluateAll((elements) => elements
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44;
    })
    .map((element) => ({ testId: element.getAttribute('data-testid'), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
  expect(undersized).toEqual([]);
});

test('issue-2004-c14: fixture isolation blocks external io and reload resets deterministically', async ({ page }) => {
  // Regression caught: a Rhythms control calls production/localhost services or persists a pause/delete across deterministic fixture reload.
  const attemptedExternal: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') attemptedExternal.push(request.url());
  });
  await openPage(page, `rhythms/rule/${ruleId}`);
  await expectRhythmsPage(page);
  const seededTitles = await page.locator('[data-testid^="rhythm-card-"] [data-testid="rhythm-title"]').allTextContents();
  await page.getByTestId(`rhythm-enabled-${ruleId}`).uncheck();
  await expect(page.getByTestId(`rhythm-status-${ruleId}`)).toHaveText('Paused');
  await page.reload();
  await expectRhythmsPage(page);
  await expect(page.getByTestId(`rhythm-enabled-${ruleId}`)).toBeChecked();
  await expect(page.getByTestId('rhythm-next-due')).toContainText('Sunday, August 16, 2026');
  const reloadedTitles = await page.locator('[data-testid^="rhythm-card-"] [data-testid="rhythm-title"]').allTextContents();
  expect(reloadedTitles).toEqual(seededTitles);
  expect(attemptedExternal).toEqual([]);
});
