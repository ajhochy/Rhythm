import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.client + 1);
}

async function expectNoBlockingAxe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
}

test('planner: density fixture adds fifteen tasks to every current-week day', async ({ page }) => {
  await openPage(page, '/planner');

  for (const date of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']) {
    await expect(page.getByTestId(`planner-day-${date}`).locator(`[data-testid^="planner-task-density-${date}-"]`)).toHaveCount(15);
  }

  await expect(page.getByTestId('planner-task-task-wed')).toBeVisible();
  await expect(page.getByTestId('planner-task-step-thu')).toBeVisible();
  await expect(page.getByTestId('planner-task-task-fri')).toBeVisible();
});

test('planner: full weekly planning journey', async ({ page }) => {
  await openPage(page, '/planner');
  await expect(page.getByTestId('planner-week-label')).toHaveText('Week of Aug 10, 2026');
  await expect(page.getByTestId('planner-summary-open')).toHaveText('108');

  await page.getByTestId('planner-filter-all').click();
  await expect(page.getByTestId('planner-task-task-done')).toBeVisible();
  await page.getByTestId('planner-filter-open').click();

  await page.getByTestId('planner-task-task-backlog').dragTo(page.getByTestId('planner-day-2026-08-14'));
  await expect(page.getByTestId('planner-day-2026-08-14')).toContainText('Vendor equipment follow-up');
  await expect(page.getByTestId('page-trace')).toContainText('PATCH /tasks/task-backlog {dueDate:2026-08-14,scheduledDate:2026-08-14,scheduledOrder} → 200');

  await page.getByTestId('planner-add-task-2026-08-12').click();
  await page.getByLabel('Task title').fill('Coordinate translated welcome cards 日本語 🌿');
  await page.getByLabel('Task notes').fill('Confirm print and pickup owners.');
  await page.getByTestId('planner-create-due-date').fill('2026-08-13');
  await page.getByTestId('planner-create-collaborator').selectOption('workspace-user-3');
  await page.getByTestId('planner-create-task-submit').click();
  await expect(page.getByTestId('planner-day-2026-08-12')).toContainText('Coordinate translated welcome cards');
  await expect(page.getByTestId('planner-task-due-created-1')).toHaveText('Due 2026-08-13');
  await expect(page.getByTestId('page-trace')).toContainText('POST /tasks/created-1/collaborators {userId:workspace-user-3} → 201');
  await expect(page.getByTestId('planner-task-due-task-wed')).toHaveCount(0);
  await expect(page.getByTestId('planner-task-due-step-thu')).toHaveCount(0);

  await page.getByTestId('planner-task-task-wed').click();
  await page.getByLabel('Task notes').fill('Use the revised handoff checklist.');
  await page.getByLabel('Scheduled date').fill('2026-08-13');
  await page.getByTestId('planner-add-collaborator').click();
  await page.getByTestId('planner-collaborator-option-workspace-user-3').click();
  // Lead disambiguation: the toast also announces the name; assert the chip inside the dialog (strictly stronger).
  await expect(page.getByRole('dialog', { name: 'Edit task' }).getByText('Morgan Lee')).toBeVisible();
  await page.getByTestId('planner-save-task').click();
  await expect(page.getByTestId('planner-day-2026-08-13').getByTestId('planner-task-task-wed')).toBeVisible();
  await expect(page.getByTestId('planner-day-2026-08-13').getByTestId('planner-task-due-task-wed')).toHaveText('Due 2026-08-12');

  await page.getByTestId('planner-task-select-task-fri').click();
  await page.getByTestId('planner-task-select-step-thu').click();
  await expect(page.getByTestId('planner-selection-count')).toHaveText('2 selected');
  await page.getByTestId('planner-bulk-complete').click();
  await expect(page.getByTestId('planner-summary-done')).toHaveText('3');

  await page.getByTestId('planner-event-calendar-wed').click();
  await expect(page.getByRole('dialog', { name: 'Calendar event' })).toContainText('READ ONLY');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('planner-event-calendar-wed')).toBeFocused();

  await page.getByTestId('planner-next-week').click();
  await expect(page).toHaveURL(/week=2026-W34/);
  await page.getByTestId('planner-today').click();
  await expect(page).toHaveURL(/week=2026-W33/);
});

test('planner: source-safe navigation and deterministic agent handoff', async ({ page }) => {
  await openPage(page, '/planner');
  await page.getByTestId('planner-task-step-thu').click();
  await expect(page.getByTestId('planner-inspector')).toContainText('Source-owned by Weekend service rollout');
  await expect(page.getByTestId('planner-add-collaborator')).toHaveCount(0);
  await page.getByTestId('planner-open-projects').click();
  await expect(page).toHaveURL(/#\/projects$/);

  await openPage(page, '/planner');
  await page.getByTestId('planner-task-task-wed').click();
  await page.getByTestId('planner-quick-summarize').click();
  await expect(page.getByTestId('toast-status')).toContainText('POST /agent-sessions {cwd,name,agentId,mcpRole,taskId} → 201');
  await expect(page).toHaveURL(/#\/agents$/);
});

for (const width of [1024, 768, 390]) {
  test(`planner: responsive at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, '/planner', '?fixture=partial-long');
    await expectNoOverflow(page);
    await expect(page.getByTestId('planner-prev-week')).toBeVisible();
    await expect(page.getByTestId('planner-add-backlog-task')).toBeVisible();
    await expect(page.getByTestId('planner-task-long-title')).toContainText('日本語');
  });
}

for (const state of ['ready', 'readonly', 'server-error'] as const) {
  test(`planner: axe scan for ${state}`, async ({ page }) => {
    await openPage(page, '/planner', state === 'ready' ? undefined : `?state=${state}`);
    await expectNoBlockingAxe(page);
  });
}
