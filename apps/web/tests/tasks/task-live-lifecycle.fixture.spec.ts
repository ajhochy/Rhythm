import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';

test('task-live-lifecycle-c6: fixture lifecycle remains deterministic and network-free', async ({ page }) => {
  // Regression caught: adding the live branch changes fixture create/edit/complete/delete or makes a fixture request.
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).port === '4098') requests.push(request.url());
  });
  await openPage(page, 'tasks');
  await page.getByTestId('tasks-header-add-task').click();
  await page.getByTestId('task-create-title').fill('Fixture lifecycle task');
  await page.getByTestId('task-create-notes').fill('Fixture notes');
  await page.getByTestId('task-create-submit').click();
  const row = page.locator('[data-testid^="task-row-"]', { hasText: 'Fixture lifecycle task' });
  await expect(row).toBeVisible();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await row.getByTestId(`task-select-${id}`).click();
  await page.getByTestId('task-edit-title').fill('Fixture lifecycle task edited');
  await page.getByTestId('task-save').click();
  await page.getByTestId(`task-complete-${id}`).click();
  await page.getByTestId('tasks-completion-filter').selectOption('all');
  await page.getByTestId(`task-menu-${id}`).click();
  await page.getByTestId(`task-delete-${id}`).click();
  await page.getByTestId('task-delete-confirm').click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('task-live-lifecycle-c7: shared and owner tasks discriminate delete availability', async ({ page }) => {
  // Regression caught: live-mode shared state either enables collaborator delete or disables owner delete globally.
  await openPage(page, 'tasks');
  await page.getByTestId('task-menu-task-shared-with-me').click();
  await expect(page.getByTestId('task-delete-task-shared-with-me')).toBeDisabled();
  await page.getByTestId('task-menu-task-service-handoff').click();
  await expect(page.getByTestId('task-delete-task-service-handoff')).toBeEnabled();
});

test('issue-1475-c6: Electron/web moves tasks to Deferred after Done and excludes them from Open', async ({ page }) => {
  // Regression caught: the renderer omits Deferred, orders it incorrectly, or
  // continues counting parked tasks as Open.
  await page.setViewportSize({ width: 2000, height: 900 });
  await openPage(page, 'tasks');
  await page.getByTestId('tasks-tag-filter').selectOption('worship');
  await page.getByTestId('tasks-view-board').click();
  const done = page.getByTestId('kanban-column-done');
  const deferred = page.getByTestId('kanban-column-deferred');
  await expect(deferred).toBeVisible();
  expect((await deferred.boundingBox())!.x).toBeGreaterThan((await done.boundingBox())!.x);

  await deferred.scrollIntoViewIfNeeded();
  await page.getByTestId('task-card-task-service-handoff').dragTo(deferred);
  await expect(deferred).toContainText('Prepare Sunday service handoff');
  await page.getByTestId('tasks-view-list').click();
  await expect(page.getByTestId('task-row-task-service-handoff')).toHaveCount(0);
  await page.getByTestId('tasks-completion-filter').selectOption('all');
  await expect(page.getByTestId('task-row-task-service-handoff')).toBeVisible();
});
