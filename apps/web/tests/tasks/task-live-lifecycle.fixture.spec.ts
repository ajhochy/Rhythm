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
