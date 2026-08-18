import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from '../helpers';

const taskId = 'task-service-handoff';

async function expectNoBlockingAxe(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${state}: ${blocking.map((item) => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
}

test('Tasks renders all fifteen dense fixtures for every current-week date', async ({ page }) => {
  await openPage(page, 'tasks');

  for (const date of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']) {
    await expect(page.getByTestId('tasks-list').locator(`[data-testid^="task-row-density-${date}-"]`)).toHaveCount(15);
  }

  await expect(page.getByTestId('tasks-visible-count')).toHaveText('110 tasks');
});

test('Tasks click-through covers filtering, creation, editing, collaborators, board movement, and delete', async ({ page }) => {
  await openPage(page, 'tasks');
  await expect(page.getByTestId('page-tasks')).toBeVisible();

  await page.getByTestId('tasks-search').fill('livestream');
  await expect(page.getByTestId('task-row-task-livestream-fallback')).toBeVisible();
  await page.getByTestId('tasks-clear-search').click();

  await page.getByTestId('tasks-header-add-task').click();
  await page.getByTestId('task-create-title').fill('Coordinate sanctuary reset');
  await page.getByTestId('task-create-notes').fill('Confirm the volunteer handoff.');
  await page.getByTestId('task-create-scheduled-date').fill('2026-08-13');
  await page.getByTestId('task-create-due-date').fill('2026-08-14');
  await page.getByTestId('task-create-collaborator').selectOption('7');
  await page.getByTestId('task-create-submit').click();
  await expect(page.getByRole('heading', { name: 'Coordinate sanctuary reset' })).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText('POST /tasks {title,notes,scheduledDate,dueDate,preferredAgent} → 201');
  await expect(page.getByTestId('page-trace')).toContainText('POST /tasks/task-sanctuary-reset/collaborators {userId} → 201');

  await page.getByTestId(`task-inspect-${taskId}`).click();
  await page.getByTestId('task-edit-notes').fill('A verified final handoff for the whole team.');
  await page.getByTestId('task-edit-agent').selectOption('codex');
  await page.getByTestId('task-save').click();
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /tasks/${taskId} {title,notes,dueDate,scheduledDate,preferredAgent,energy} → 200`);

  await page.getByTestId(`task-inspect-${taskId}`).click();
  await page.getByTestId('task-add-collaborator').click();
  await page.getByTestId('task-collaborator-option-7').click();
  await page.getByTestId('task-remove-collaborator-7').click();
  await expect(page.getByTestId('page-trace')).toContainText(`GET /tasks/${taskId}/collaborators → 200`);

  // Lead determinism fix: slim the board through the worship tag filter (the recipe the
  // red-proven contract c3 uses) — HTML5 dragTo is unreliable when the drop point lands on
  // another draggable card inside a dense column.
  await page.getByTestId('tasks-tag-filter').selectOption('worship');
  await page.getByTestId('tasks-view-board').click();
  await page.getByTestId(`task-card-${taskId}`).dragTo(page.getByTestId('kanban-column-in-progress'));
  await expect(page.getByTestId('kanban-column-in-progress')).toContainText('Prepare Sunday service handoff');
  await page.getByTestId(`task-card-${taskId}`).press('Enter');
  await expect(page.getByTestId('task-inspector')).toBeVisible();

  await page.getByTestId('tasks-view-list').click();
  await page.getByTestId(`task-menu-${taskId}`).click();
  await page.getByTestId(`task-delete-${taskId}`).click();
  await page.getByTestId('task-delete-cancel').click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toBeVisible();
  await page.getByTestId(`task-menu-${taskId}`).click();
  await page.getByTestId(`task-delete-${taskId}`).click();
  await page.getByTestId('task-delete-confirm').click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toHaveCount(0);
});

test('Tasks permission and recovery states keep the truthful prerequisite boundary', async ({ page }) => {
  await openPage(page, 'tasks/task/task-shared-with-me', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('Collaborators may still edit and complete');
  await expect(page.getByTestId('task-save')).toBeEnabled();
  await expect(page.getByTestId('task-add-collaborator')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByTestId('task-menu-task-shared-with-me').click();
  await expect(page.getByTestId('task-delete-task-shared-with-me')).toBeDisabled();

  await openPage(page, 'tasks', '?state=server-error');
  await page.getByTestId('page-retry').click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText('GET /tasks → 200');

  await openPage(page, 'tasks/task/task-calendar-shadow', '?state=readonly');
  await expect(page.getByTestId('tasks-header-add-task')).toBeDisabled();
  await expect(page.locator('[data-testid^="quick-action-"]')).toHaveCount(0);
});

test('Tasks is responsive and axe-clean in representative list, board, inspector, error, and readonly states', async ({ page }) => {
  // Three responsive layouts plus five axe scans measured 21.2s on a loaded dev machine, just over
  // the 20s global budget. Given a per-test budget rather than raising the global one, which would
  // mask genuine regressions in the other 257 tests.
  test.setTimeout(60_000);
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'tasks');
    await expect(page.getByTestId('tasks-header-add-task')).toBeVisible();
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px`).toBeLessThanOrEqual(overflow.client + 1);
  }

  await expectNoBlockingAxe(page, 'ready list');
  await page.getByTestId('tasks-view-board').click();
  await expectNoBlockingAxe(page, 'ready board');
  await page.getByTestId(`task-card-${taskId}`).press('Enter');
  await expectNoBlockingAxe(page, 'task inspector');

  await openPage(page, 'tasks', '?state=server-error');
  await expectNoBlockingAxe(page, 'server error');
  await openPage(page, 'tasks/task/task-calendar-shadow', '?state=readonly');
  await expectNoBlockingAxe(page, 'readonly inspector');

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByText('准备礼拜交接 🎵', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
});
