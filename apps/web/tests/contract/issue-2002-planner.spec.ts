import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function reloadWithQuery(page: Page, query: string) {
  await page.evaluate((nextQuery) => {
    history.replaceState(null, '', `/#/planner${nextQuery}`);
  }, query);
  await page.reload();
  await expect(page.locator('#main-content')).toBeAttached();
}

test('issue-2002-c1: planner route renders the real shell and fixed current week', async ({ page }) => {
  // Regression caught: #/planner falls through to ModulePlaceholder or derives the fixture week from the host clock.
  await openPage(page, '/planner');
  const planner = page.getByTestId('page-planner');
  await expect(planner).toBeVisible();
  await expect(planner.getByRole('heading', { level: 1, name: 'Planner' })).toHaveCount(1);
  await expect(page.getByTestId('planner-week-label')).toHaveText('Week of Aug 10, 2026');
  await expect(page.getByTestId('planner-day-2026-08-12')).toContainText('Today');
  await expect(page.getByTestId('module-placeholder')).toHaveCount(0);
});

test('issue-2002-c2: previous next and Today change the deterministic week and load receipt', async ({ page }) => {
  // Regression caught: week controls relabel the header without loading the correct ISO-week fixture or updating the shareable query.
  await openPage(page, '/planner');
  await page.getByTestId('planner-next-week').click();
  await expect(page.getByTestId('planner-week-label')).toHaveText('Week of Aug 17, 2026');
  await expect(page).toHaveURL(/#\/planner\?week=2026-W34/);
  await expect(page.getByTestId('page-trace')).toContainText('GET /weekly-plan?week=2026-W34 → 200');

  await page.getByTestId('planner-prev-week').click();
  await expect(page.getByTestId('planner-week-label')).toHaveText('Week of Aug 10, 2026');
  await page.getByTestId('planner-prev-week').click();
  await expect(page.getByTestId('planner-week-label')).toHaveText('Week of Aug 3, 2026');
  await page.getByTestId('planner-today').click();
  await expect(page.getByTestId('planner-week-label')).toHaveText('Week of Aug 10, 2026');
  await expect(page.getByTestId('planner-today')).toBeDisabled();
  await expect(page.getByTestId('page-trace')).toContainText('GET /weekly-plan?week=2026-W33 → 200');
});

test('issue-2002-c3: tasks project steps calendar context and backlog occupy their source-of-truth lanes', async ({ page }) => {
  // Regression caught: due-date fallback or source conversion puts every record in the same day list and loses the distinct backlog/calendar treatment.
  await openPage(page, '/planner');
  await expect(page.getByTestId('planner-day-2026-08-12').getByTestId('planner-task-task-wed')).toBeVisible();
  await expect(page.getByTestId('planner-day-2026-08-13').getByTestId('planner-task-step-thu')).toBeVisible();
  await expect(page.getByTestId('planner-day-2026-08-12').getByTestId('planner-event-calendar-wed')).toContainText('9:30 AM');
  await expect(page.getByTestId('planner-backlog').getByTestId('planner-task-task-backlog')).toBeVisible();
  await expect(page.getByTestId('planner-backlog').getByTestId('planner-task-step-overdue')).toBeVisible();
  await expect(page.getByTestId('planner-backlog-count')).toHaveText('2');
});

test('issue-2002-c4: scheduling normal work moves it and emits the correct task-family receipt', async ({ page }) => {
  // Regression caught: dropping backlog work only changes DOM position or incorrectly uses the weekly/project-step endpoint.
  await openPage(page, '/planner');
  await page.getByTestId('planner-task-task-backlog').dragTo(page.getByTestId('planner-day-2026-08-14'));
  await expect(page.getByTestId('planner-day-2026-08-14').getByTestId('planner-task-task-backlog')).toBeVisible();
  await expect(page.getByTestId('planner-backlog').getByTestId('planner-task-task-backlog')).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(
    'PATCH /tasks/task-backlog {dueDate:2026-08-14,scheduledDate:2026-08-14,scheduledOrder} → 200',
  );
});

test('issue-2002-c5: scheduling and completing a project step use project-step receipts', async ({ page }) => {
  // Regression caught: task-shaped project steps are mutated through /tasks and silently diverge from their project source.
  await openPage(page, '/planner');
  await page.getByTestId('planner-task-step-overdue').dragTo(page.getByTestId('planner-day-2026-08-15'));
  await expect(page.getByTestId('planner-day-2026-08-15').getByTestId('planner-task-step-overdue')).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText(
    'PATCH /project-instances/steps/step-overdue {dueDate:2026-08-15} → 200',
  );
  await page.getByTestId('planner-complete-step-overdue').click();
  await expect(page.getByTestId('page-trace')).toContainText(
    'PATCH /project-instances/steps/step-overdue {status:done} → 200',
  );
});

test('issue-2002-c6: creating scheduled and unscheduled tasks updates plan counts with POST receipts', async ({ page }) => {
  // Regression caught: the create inspector calls an update path, loses the seeded day, or leaves summaries stale.
  await openPage(page, '/planner');
  await page.getByTestId('planner-add-task-2026-08-12').click();
  await expect(page.getByRole('dialog', { name: 'Add task' })).toBeVisible();
  await page.getByLabel('Task title').fill('Prepare bilingual volunteer brief 日本語 📋');
  await page.getByLabel('Task notes').fill('Confirm owners and room setup.');
  await page.getByTestId('planner-create-task-submit').click();
  await expect(page.getByTestId('planner-day-2026-08-12')).toContainText('Prepare bilingual volunteer brief 日本語 📋');
  await expect(page.getByTestId('planner-summary-open')).toHaveText('109');
  await expect(page.getByTestId('page-trace')).toContainText(
    'POST /tasks {title,notes,scheduledDate:2026-08-12} → 201',
  );

  await page.getByTestId('planner-add-backlog-task').click();
  await page.getByLabel('Task title').fill('Unscheduled follow-up');
  await page.getByTestId('planner-create-task-submit').click();
  await expect(page.getByTestId('planner-backlog')).toContainText('Unscheduled follow-up');
  await expect(page.getByTestId('planner-summary-unscheduled')).toHaveText('3');
});

test('issue-2002-c7: editing supported task details persists notes and date through the normal task patch', async ({ page }) => {
  // Regression caught: the shared inspector closes as if saved while Planner drops its supported notes/date changes.
  await openPage(page, '/planner');
  await page.getByTestId('planner-task-task-wed').click();
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible();
  await page.getByLabel('Task notes').fill('Bring the revised handoff checklist.');
  await page.getByLabel('Scheduled date').fill('2026-08-13');
  await page.getByTestId('planner-save-task').click();
  await expect(page.getByTestId('planner-day-2026-08-13').getByTestId('planner-task-task-wed')).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText(
    'PATCH /tasks/task-wed {notes,scheduledDate:2026-08-13} → 200',
  );
  await page.getByTestId('planner-task-task-wed').click();
  await expect(page.getByLabel('Task notes')).toHaveValue('Bring the revised handoff checklist.');
});

test('issue-2002-c8: single and bulk completion update visible plan summaries and affirmation', async ({ page }) => {
  // Regression caught: completion emits a request but leaves open/all filtering, selection, or summary counts stale.
  await openPage(page, '/planner');
  await page.getByTestId('planner-complete-task-wed').click();
  await expect(page.getByTestId('toast-status')).toContainText('Task marked complete.');
  await expect(page.getByTestId('planner-task-task-wed')).toHaveCount(0);
  await expect(page.getByTestId('planner-summary-done')).toHaveText('2');
  await expect(page.getByTestId('page-trace')).toContainText('PATCH /tasks/task-wed {status:done} → 200');

  await page.getByTestId('planner-task-select-task-fri').click();
  await page.getByTestId('planner-task-select-step-thu').click();
  await expect(page.getByTestId('planner-selection-count')).toHaveText('2 selected');
  await page.getByTestId('planner-bulk-complete').click();
  await expect(page.getByTestId('planner-selection-count')).toHaveCount(0);
  await expect(page.getByTestId('planner-summary-done')).toHaveText('4');
});

test('issue-2002-c9: client-side filters selection and dialogs have observable outcomes without fake APIs', async ({ page }) => {
  // Regression caught: an enabled Planner control is inert, or client-only Open/All/Clear actions fabricate endpoint receipts.
  await openPage(page, '/planner');
  const trace = page.getByTestId('page-trace');
  const before = await trace.getByRole('listitem').count();
  await page.getByTestId('planner-filter-all').click();
  await expect(page.getByTestId('planner-task-task-done')).toBeVisible();
  await expect(trace.getByRole('listitem')).toHaveCount(before);

  await page.getByTestId('planner-task-select-task-wed').click();
  await page.getByTestId('planner-clear-selection').click();
  await expect(page.getByTestId('planner-selection-count')).toHaveCount(0);
  await expect(trace.getByRole('listitem')).toHaveCount(before);

  await page.getByTestId('planner-add-backlog-task').click();
  await expect(page.getByRole('dialog', { name: 'Add task' })).toBeVisible();
  await page.getByTestId('planner-create-task-cancel').click();
  await expect(page.getByRole('dialog', { name: 'Add task' })).toHaveCount(0);
  await expect(page.getByTestId('planner-add-backlog-task')).toBeFocused();
});

test('issue-2002-c10: deterministic state matrix remains actionable and Retry recovers without reload', async ({ page }) => {
  // Regression caught: a fixture query falls through to ready, Retry reloads the browser, or readonly leaves a mutating control enabled.
  await openPage(page, '/planner', '?state=loading');
  await expect(page.getByTestId('page-state-loading')).toHaveRole('status');

  await reloadWithQuery(page, '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toBeVisible();
  await expect(page.getByTestId('planner-add-empty-task')).toBeEnabled();

  await reloadWithQuery(page, '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveRole('alert');
  await page.getByTestId('page-retry').click();
  await expect(page.getByTestId('page-planner')).toBeVisible();
  await expect(page).toHaveURL(/state=ready/);

  for (const state of ['forbidden', 'unavailable'] as const) {
    await reloadWithQuery(page, `?state=${state}`);
    await expect(page.getByTestId(`page-state-${state}`)).toContainText(/required|prerequisite|access|service/i);
  }

  await reloadWithQuery(page, '?state=readonly');
  await expect(page.getByTestId('page-state-readonly')).toContainText(/read.only|permission/i);
  await expect(page.getByTestId('planner-mutations')).toBeDisabled();
  await page.getByTestId('planner-task-task-wed').click();
  await expect(page.getByRole('dialog', { name: /task details/i })).toBeVisible();
});

test('issue-2002-c11: partial records long titles and read-only calendar items remain usable', async ({ page }) => {
  // Regression caught: optional fields or international text overflow the board, while calendar context exposes task mutations.
  await openPage(page, '/planner', '?fixture=partial-long');
  const longTitle = page.getByTestId('planner-task-long-title');
  await expect(longTitle).toContainText('خطة تسليم طويلة');
  await expect(longTitle).toContainText('日本語');
  await expectNoPageOverflow(page);
  await page.getByTestId('planner-event-calendar-wed').click();
  const dialog = page.getByRole('dialog', { name: /calendar event/i });
  await expect(dialog).toContainText('READ ONLY');
  await expect(dialog.getByRole('button', { name: /save|complete|collaborator/i })).toHaveCount(0);
});

test('issue-2002-c12: trace ledger records exact endpoint families and excludes client-only controls', async ({ page }) => {
  // Regression caught: receipts collapse task and project-step mutations into a generic fake route or omit method/payload/status.
  await openPage(page, '/planner');
  const trace = page.getByTestId('page-trace');
  await expect(trace).toContainText('GET /weekly-plan?week=2026-W33 → 200');
  const beforeFilter = await trace.getByRole('listitem').count();
  await page.getByTestId('planner-filter-all').click();
  await expect(trace.getByRole('listitem')).toHaveCount(beforeFilter);

  await page.getByTestId('planner-task-task-wed').dragTo(page.getByTestId('planner-day-2026-08-13'));
  await expect(trace).toContainText(
    'PATCH /weekly-plan/tasks/task-wed {scheduledDate:2026-08-13,locked:false,scheduledOrder} → 200',
  );
  await page.getByTestId('planner-complete-task-wed').click();
  await expect(trace).toContainText('PATCH /tasks/task-wed {status:done} → 200');
  await page.getByTestId('planner-complete-step-thu').click();
  await expect(trace).toContainText('PATCH /project-instances/steps/step-thu {status:done} → 200');
  await page.getByTestId('planner-add-backlog-task').click();
  await page.getByLabel('Task title').fill('Receipt coverage task');
  await page.getByTestId('planner-create-task-submit').click();
  await expect(trace).toContainText('POST /tasks {title} → 201');
});

test('issue-2002-c13: Planner has no serious axe violations and modal keyboard focus is contained and restored', async ({ page }) => {
  // Regression caught: dense board semantics hide labels/headings, or Escape from an inspector loses keyboard focus behind the modal.
  await openPage(page, '/planner');
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
  expect(blocking, blocking.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);

  await page.getByTestId('planner-task-task-wed').focus();
  await page.getByTestId('planner-task-task-wed').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible();
  await expect(page.getByLabel('Task notes')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('planner-inspector-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('planner-task-task-wed')).toBeFocused();
});

test('issue-2002-c14: Planner fits target widths text scaling RTL and 44px touch targets', async ({ page }) => {
  // Regression caught: the seven-day board creates page-level horizontal overflow or hides week/task actions on compact and translated layouts.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, '/planner');
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expectNoPageOverflow(page);
    await expect(page.getByTestId('planner-prev-week')).toBeVisible();
    await expect(page.getByTestId('planner-add-backlog-task')).toBeVisible();
  }

  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoPageOverflow(page);
  const undersized = await page.locator('.pg-planner button:visible, .pg-planner input:visible, .pg-planner select:visible').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const control = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement;
      const rect = control.getBoundingClientRect();
      if (control.disabled || rect.width === 0 || rect.height === 0) return [];
      return rect.width < 44 || rect.height < 44
        ? [{ label: control.getAttribute('aria-label') || control.textContent?.trim(), width: rect.width, height: rect.height }]
        : [];
    }),
  );
  expect(undersized).toEqual([]);
});

test('issue-2002-c15: Planner fixtures are loopback-only and reload to the identical seeded week', async ({ page }) => {
  // Regression caught: a fixture mutation leaks to a real API or persists across reload, making contract results order-dependent.
  const requestedHosts = new Set<string>();
  page.on('request', (request) => requestedHosts.add(new URL(request.url()).hostname));
  await openPage(page, '/planner');
  const seededTitles = await page.locator('[data-testid^="planner-task-"][data-task-title]').allTextContents();

  await page.getByTestId('planner-add-backlog-task').click();
  await page.getByLabel('Task title').fill('Ephemeral contract task');
  await page.getByTestId('planner-create-task-submit').click();
  // Lead disambiguation: the creation toast also contains the title, so target the task element itself (strictly stronger).
  await expect(page.getByTestId('planner-task-created-1')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('planner-task-created-1')).toHaveCount(0);
  await expect(page.locator('[data-testid^="planner-task-"][data-task-title]').allTextContents()).resolves.toEqual(seededTitles);
  expect([...requestedHosts]).toEqual(['127.0.0.1']);
});
