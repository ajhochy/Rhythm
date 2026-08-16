import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';

const taskTitle = 'Prepare Sunday service handoff';
const taskId = 'task-service-handoff';

async function expectTasksPage(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('page-tasks')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toHaveCount(1);
}

test('issue-2003-c1: tasks route and deep links render the real page shell', async ({ page }) => {
  // Regression caught: #/tasks continues rendering ModulePlaceholder or a deep link drops its selected task/filter state.
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  await expect(page.getByTestId('page-trace')).toContainText('GET /tasks → 200');

  await openPage(page, `tasks/board/task/${taskId}`, '?tag=worship&priority=3');
  await expectTasksPage(page);
  await expect(page.getByTestId('tasks-view-board')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tasks-tag-filter')).toHaveValue('worship');
  await expect(page.getByTestId('tasks-priority-filter')).toHaveValue('3');
  await expect(page.getByTestId('task-inspector')).toContainText(taskTitle);
});

test('issue-2003-c2: filters grouping sorting and clear recovery are deterministic', async ({ page }) => {
  // Regression caught: list and filter state update cosmetically while hidden rows, ordering, or groups remain stale.
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  const initialTrace = await page.getByTestId('page-trace').textContent();

  await page.getByTestId('tasks-search').fill('livestream');
  await expect(page.getByTestId('task-row-task-livestream-fallback')).toBeVisible();
  await expect(page.getByTestId('task-row-task-service-handoff')).toHaveCount(0);
  await expect(page.getByTestId('tasks-visible-count')).toHaveText('8 tasks');
  await page.getByTestId('tasks-search').fill('');

  await page.getByTestId('tasks-tag-filter').selectOption('worship');
  await page.getByTestId('tasks-priority-filter').selectOption('3');
  await page.getByTestId('tasks-date-filter').selectOption('today');
  await expect(page.getByTestId('task-group-today')).toContainText(taskTitle);
  await expect(page.getByTestId('tasks-visible-count')).toHaveText('1 task');

  await page.getByTestId('tasks-date-filter').selectOption('all');
  await page.getByTestId('tasks-tag-filter').selectOption('all');
  await page.getByTestId('tasks-priority-filter').selectOption('0');
  await page.getByTestId('tasks-completion-filter').selectOption('all');
  await page.getByTestId('tasks-sort').selectOption('title');
  const titleGroups = await page.locator('[data-testid^="task-group-"]').evaluateAll((groups) => groups.map((group) =>
    [...group.querySelectorAll('[data-testid="task-title"]')].map((title) => title.textContent ?? ''),
  ));
  for (const titles of titleGroups) {
    expect(titles).toEqual([...titles].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })));
  }
  await expect(page.getByTestId('task-group-completed')).toBeVisible();
  await expect(page.getByTestId('page-trace')).toHaveText(initialTrace ?? '');
});

test('issue-2003-c3: list and board preserve selection filters and status movement', async ({ page }) => {
  // Regression caught: switching presentation resets filters/selection or moving a card changes only its column without the PATCH receipt.
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  await page.getByTestId('tasks-tag-filter').selectOption('worship');
  await page.getByTestId(`task-row-${taskId}`).click();
  await expect(page.getByTestId('task-inspector')).toContainText(taskTitle);
  await expect(page.getByTestId(`task-row-${taskId}`)).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('tasks-view-board').click();
  await expect(page.getByTestId('tasks-tag-filter')).toHaveValue('worship');
  await expect(page.getByTestId(`task-card-${taskId}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('kanban-column-open')).toBeVisible();
  await expect(page.getByTestId('kanban-column-in-progress')).toBeVisible();
  await expect(page.getByTestId('kanban-column-waiting-for-reply')).toBeVisible();
  await expect(page.getByTestId('kanban-column-done')).toBeVisible();

  await page.getByTestId(`task-card-${taskId}`).dragTo(page.getByTestId('kanban-column-waiting-for-reply'));
  await expect(page.getByTestId('kanban-column-waiting-for-reply')).toContainText(taskTitle);
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /tasks/${taskId} {status:"waiting_for_reply"} → 200`);
});

test('issue-2003-c4: create validates inserts clears and records exact receipts', async ({ page }) => {
  // Regression caught: a blank or duplicate task is inserted, optional fields are dropped, or create pretends collaborator attachment is part of POST /tasks.
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  const createReceiptsBefore = await page.getByTestId('page-trace').getByText(/POST \/tasks /).count();
  await page.getByTestId('tasks-header-add-task').click();
  await page.getByTestId('task-create-submit').click();
  expect(await page.getByTestId('task-create-title').evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await expect(page.getByTestId('page-trace').getByText(/POST \/tasks /)).toHaveCount(createReceiptsBefore);

  await page.getByTestId('task-create-title').fill('Coordinate sanctuary reset');
  await page.getByTestId('task-create-notes').fill('Confirm the volunteer handoff.');
  await page.getByTestId('task-create-scheduled-date').fill('2026-08-13');
  await page.getByTestId('task-create-collaborator').selectOption('7');
  await page.getByTestId('task-create-submit').click();

  await expect(page.getByRole('heading', { name: 'Coordinate sanctuary reset' })).toHaveCount(1);
  await page.getByTestId('tasks-header-add-task').click();
  await expect(page.getByTestId('task-create-title')).toHaveValue('');
  await expect(page.getByTestId('task-create-notes')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('page-trace')).toContainText('POST /tasks {title,notes,scheduledDate,preferredAgent} → 201');
  await expect(page.getByTestId('page-trace')).toContainText('POST /tasks/task-sanctuary-reset/collaborators {userId} → 201');
});

test('issue-2003-c5: inspector edits supported fields and keeps source metadata read only', async ({ page }) => {
  // Regression caught: Save closes without changing a supported field, or exposes API-only owner/project controls that Flutter Tasks does not have.
  await openPage(page, `tasks/task/${taskId}`);
  await expectTasksPage(page);
  const inspector = page.getByTestId('task-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId('task-source')).toHaveText('Sunday service rollout');
  await expect(inspector.getByTestId('task-source')).toHaveAttribute('aria-readonly', 'true');
  await expect(inspector.getByTestId('task-created-by')).toHaveAttribute('aria-readonly', 'true');
  await expect(inspector.getByLabel('Owner')).toHaveCount(0);
  await expect(inspector.getByLabel('Project')).toHaveCount(0);

  await inspector.getByTestId('task-edit-title').fill('Prepare Sunday service handoff — updated');
  await inspector.getByTestId('task-edit-notes').fill('Share the final plan with the team.');
  await inspector.getByTestId('task-edit-scheduled-date').fill('2026-08-13');
  await inspector.getByTestId('task-edit-due-date').fill('2026-08-14');
  await inspector.getByTestId('task-edit-agent').selectOption('codex');
  await inspector.getByTestId('task-edit-energy').selectOption('⚡');
  await inspector.getByTestId('task-save').click();

  await expect(inspector.getByRole('heading', { name: 'Prepare Sunday service handoff — updated' })).toBeVisible();
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /tasks/${taskId} {title,notes,dueDate,scheduledDate,preferredAgent,energy} → 200`);
});

test('issue-2003-c6: complete and reopen update counts receipts and affirmation', async ({ page }) => {
  // Regression caught: completion celebrates before failure, reopening repeats the celebration, or Open view/count remains stale.
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  const countBefore = Number((await page.getByTestId('tasks-visible-count').textContent())?.match(/\d+/)?.[0]);
  await page.getByTestId(`task-complete-${taskId}`).click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toHaveCount(0);
  await expect(page.getByTestId('tasks-visible-count')).toHaveText(`${countBefore - 1} tasks`);
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /tasks/${taskId} {status:"done"} → 200`);
  await expect(page.getByTestId('toast-status')).toContainText('Task marked complete.');

  await page.getByTestId('tasks-completion-filter').selectOption('all');
  await page.getByTestId(`task-complete-${taskId}`).uncheck();
  await expect(page.getByTestId('page-trace')).toContainText(`PATCH /tasks/${taskId} {status:"open"} → 200`);
  await expect(page.getByTestId('toast-status')).not.toContainText('Nice work — one less thing carrying weight.');
});

test('issue-2003-c7: collaborator add remove and forbidden outcomes are observable', async ({ page }) => {
  // Regression caught: People chips mutate only locally, include invalid candidates, or owner-only failures disappear without a prerequisite.
  await openPage(page, `tasks/task/${taskId}`);
  await expectTasksPage(page);
  const inspector = page.getByTestId('task-inspector');
  await inspector.getByTestId('task-add-collaborator').click();
  const picker = page.getByTestId('task-collaborator-picker');
  await expect(picker.getByRole('option', { name: /AJ Hochhalter/ })).toHaveCount(0);
  await expect(picker.getByRole('option', { name: /Morgan Lee/ })).toHaveCount(0);
  await picker.getByRole('option', { name: /Visalia CRC/ }).click();
  await expect(inspector.getByTestId('task-collaborator-7')).toContainText('Visalia CRC');
  await expect(page.getByTestId('page-trace')).toContainText(`POST /tasks/${taskId}/collaborators {userId} → 201`);

  await inspector.getByTestId('task-remove-collaborator-7').click();
  await expect(inspector.getByTestId('task-collaborator-7')).toHaveCount(0);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /tasks/${taskId}/collaborators/7 → 204`);
  await expect(page.getByTestId('page-trace')).toContainText(`GET /tasks/${taskId}/collaborators → 200`);

  await openPage(page, 'tasks/task/task-shared-with-me', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('Only the task owner can add or remove collaborators');
  await expect(page.getByTestId('task-add-collaborator')).toBeDisabled();
});

test('issue-2003-c8: delete confirmation cancel and success update list count and receipt', async ({ page }) => {
  // Regression caught: Delete acts immediately, Cancel removes the row, or Confirm leaves counts and the endpoint ledger stale.
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  const countBefore = Number((await page.getByTestId('tasks-visible-count').textContent())?.match(/\d+/)?.[0]);
  await page.getByTestId(`task-menu-${taskId}`).click();
  await page.getByTestId(`task-delete-${taskId}`).click();
  const dialog = page.getByTestId('task-delete-dialog');
  await expect(dialog).toContainText(`Delete “${taskTitle}”?`);
  await expect(dialog).toContainText('This cannot be undone.');
  await dialog.getByTestId('task-delete-cancel').click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toBeVisible();

  await page.getByTestId(`task-menu-${taskId}`).click();
  await page.getByTestId(`task-delete-${taskId}`).click();
  await page.getByTestId('task-delete-confirm').click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toHaveCount(0);
  await expect(page.getByTestId('tasks-visible-count')).toHaveText(`${countBefore - 1} tasks`);
  await expect(page.getByTestId('page-trace')).toContainText(`DELETE /tasks/${taskId} → 204`);
});

test('issue-2003-c9: state matrix and no-results expose recovery and prerequisites', async ({ page }) => {
  // Regression caught: a fixture state is blank/dead, Retry requires reload, or readonly styling leaves mutations enabled.
  await openPage(page, 'tasks', '?state=loading');
  await expect(page.getByTestId('page-state-loading')).toContainText('Loading tasks');

  await openPage(page, 'tasks', '?state=empty');
  await expect(page.getByTestId('page-state-empty')).toContainText('No tasks yet');
  await page.getByTestId('tasks-empty-create').click();
  await expect(page.getByTestId('task-create-title')).toBeFocused();

  await openPage(page, 'tasks', '?state=server-error');
  await expect(page.getByTestId('page-state-server-error')).toHaveAttribute('role', 'alert');
  await page.getByTestId('page-retry').click();
  await expectTasksPage(page);
  await expect(page).toHaveURL(/state=ready/);

  await openPage(page, 'tasks', '?state=forbidden');
  await expect(page.getByTestId('page-state-forbidden')).toContainText('task owner');
  await openPage(page, 'tasks', '?state=unavailable');
  await expect(page.getByTestId('page-state-unavailable')).toContainText('task service');
  await openPage(page, 'tasks', '?state=readonly');
  await expect(page.getByTestId('page-state-readonly')).toContainText('source of truth');
  await expect(page.getByTestId('tasks-header-add-task')).toBeDisabled();
  await expect(page.getByTestId(`task-inspect-${taskId}`)).toBeEnabled();

  await openPage(page, 'tasks');
  await page.getByTestId('tasks-search').fill('no fixture task has this text');
  await expect(page.getByTestId('tasks-no-results')).toContainText('No matching tasks');
  await page.getByTestId('tasks-clear-search').click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toBeVisible();
});

test('issue-2003-c10: task quick actions produce a fixture session handoff', async ({ page }) => {
  // Regression caught: inspector quick actions spin without an observable session, use a real host, or remain visible for synced readonly tasks.
  await openPage(page, `tasks/task/${taskId}`);
  await expectTasksPage(page);
  await expect(page.getByTestId('quick-action-help-finish')).toBeEnabled();
  await expect(page.getByTestId('quick-action-draft-next-steps')).toBeEnabled();
  await expect(page.getByTestId('quick-action-summarize')).toBeEnabled();
  await expect(page.getByTestId('quick-action-follow-up-tasks')).toBeEnabled();
  await page.getByTestId('quick-action-summarize').click();
  await expect(page.getByTestId('toast-status')).toContainText('POST /agent-sessions {cwd,name,agentId,mcpRole,taskId} → 201');
  await expect(page).toHaveURL(/#\/agents/);

  await openPage(page, 'tasks/task/task-calendar-shadow', '?state=readonly');
  await expect(page.locator('[data-testid^="quick-action-"]')).toHaveCount(0);
});

test('issue-2003-c11: enabled controls are identifiable live and receipt-honest', async ({ page }) => {
  // Regression caught: an unlabeled enabled button is dead, or a client filter fabricates a network receipt to look wired.
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  const enabled = page.getByTestId('page-tasks').locator('button:enabled, input:enabled, select:enabled, textarea:enabled');
  const missingTestIds = await enabled.evaluateAll((elements) => elements
    .filter((element) => !/^[-a-z0-9]+$/.test(element.getAttribute('data-testid') ?? ''))
    .map((element) => element.outerHTML));
  expect(missingTestIds).toEqual([]);

  const traceBefore = await page.getByTestId('page-trace').textContent();
  await page.getByTestId('tasks-search').fill('livestream');
  await page.getByTestId('tasks-sort').selectOption('title');
  await page.getByTestId('tasks-view-board').click();
  await expect(page.getByTestId('page-trace')).toHaveText(traceBefore ?? '');
  await expect(page.getByTestId('tasks-unavailable-prerequisite')).toHaveCount(0);
});

test('issue-2003-c12: ready editable inspector is accessible and dialog focus recovers', async ({ page }) => {
  // Regression caught: the dense editable inspector passes visual review while axe finds a serious violation or Escape strands focus in its collaborator picker.
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  let result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  const trigger = page.getByTestId(`task-inspect-${taskId}`);
  await trigger.focus();
  await trigger.click();
  await expect(page.getByTestId('task-inspector')).toHaveAttribute('aria-label', 'Selected task');
  await expect(page.getByTestId('task-edit-title')).toBeVisible();
  const addTrigger = page.getByTestId('task-add-collaborator');
  await addTrigger.focus();
  await addTrigger.click();
  await expect(page.getByTestId('task-collaborator-picker')).toHaveAttribute('role', 'dialog');
  result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-collaborator-picker')).toHaveCount(0);
  await expect(addTrigger).toBeFocused();
});

test('issue-2003-c13: tasks remains responsive at required widths text scale and rtl', async ({ page }) => {
  // Regression caught: the toolbar, Kanban, or inspector creates page-level overflow or hides Add task at a required breakpoint/localization mode.
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPage(page, 'tasks');
    await expectTasksPage(page);
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll, `${width}px ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.client + 1);
    await expect(page.getByTestId('tasks-header-add-task')).toBeVisible();
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });
  await expect(page.getByText('准备礼拜交接 🎵', { exact: true })).toBeVisible();
  const resilientOverflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(resilientOverflow.scroll).toBeLessThanOrEqual(resilientOverflow.client + 1);
  await expect(page.getByTestId('tasks-header-add-task')).toBeVisible();
});

test('issue-2003-c14: fixture isolation blocks external I O and reload resets deterministically', async ({ page }) => {
  // Regression caught: a Tasks control calls production/localhost services or persists a prior mutation across deterministic fixture reload.
  const attemptedExternal: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') attemptedExternal.push(request.url());
  });
  await openPage(page, 'tasks');
  await expectTasksPage(page);
  const seededTitles = await page.locator('[data-testid^="task-row-"] [data-testid="task-title"]').allTextContents();
  await page.getByTestId(`task-complete-${taskId}`).click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toHaveCount(0);
  await page.reload();
  await expectTasksPage(page);
  await expect(page.getByTestId(`task-row-${taskId}`)).toBeVisible();
  const reloadedTitles = await page.locator('[data-testid^="task-row-"] [data-testid="task-title"]').allTextContents();
  expect(reloadedTitles).toEqual(seededTitles);
  expect(attemptedExternal).toEqual([]);
});

test('issue-2003-c15: selecting a task keeps the queue visible and synchronizes a persistent inspector', async ({ page }) => {
  // Regression caught: selecting a row replaces the work queue with a modal, or the detail pane keeps showing the previously selected task.
  await openPage(page, 'tasks');
  await expectTasksPage(page);

  const inspector = page.getByTestId('task-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute('aria-label', 'Selected task');
  await expect(inspector).not.toHaveAttribute('role', 'dialog');
  await expect(inspector).toContainText('Select a task');

  await page.getByTestId(`task-select-${taskId}`).click();
  await expect(page.getByTestId('tasks-list')).toBeVisible();
  await expect(inspector).toContainText(taskTitle);
  await expect(inspector).toContainText('Confirm the final run sheet and coverage notes.');
  await expect(page.getByTestId(`task-row-${taskId}`)).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('task-select-task-livestream-fallback').click();
  await expect(inspector).toContainText('Review livestream fallback');
  await expect(inspector).not.toContainText(taskTitle);
  await expect(page.getByTestId(`task-row-${taskId}`)).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('task-row-task-livestream-fallback')).toHaveAttribute('aria-selected', 'true');

  await expect(inspector.getByTestId('task-edit-title')).toHaveValue('Review livestream fallback');
  await expect(inspector.getByTestId('task-edit-notes')).toHaveValue('Verify the fallback encoder before the volunteer rehearsal.');
  await expect(page.getByTestId('task-edit-dialog')).toHaveCount(0);
});
