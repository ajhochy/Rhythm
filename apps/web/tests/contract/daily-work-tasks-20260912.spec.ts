import { expect, test } from '@playwright/test';
import { openPage } from '../helpers';

const id = 'task-service-handoff';
for (const focus of ['option', 'boundary'] as const) test(`tasks-child-dismiss: Escape only closes topmost picker at390 (${focus})`, async ({ page }) => {
  // Regression: the child's Escape/cancel also closes the parent or opens its dirty guard.
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, 'tasks');
  const trigger = page.getByTestId(`task-select-${id}`);
  await trigger.click();
  const add = page.getByTestId('task-add-collaborator');
  for (const dirty of [false, true]) {
    if (dirty) await page.getByTestId('task-edit-title').fill('Nested draft');
    await add.click();
    const picker = page.getByTestId('task-collaborator-picker');
    const target = focus === 'option' ? page.getByTestId('task-collaborator-option-7') : picker.locator('..');
    await target.focus();
    await expect(target).toBeFocused();
    const url = page.url();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(page.getByTestId('task-inspector-dialog')).toBeVisible();
    await expect(page).toHaveURL(url);
    await expect(add).toBeFocused();
    await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    if (dirty) {
      await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();
      await expect(page).toHaveURL(url);
      await expect(page.getByTestId('task-edit-title')).toHaveValue('Nested draft');
      await page.getByRole('button', { name: 'Discard', exact: true }).click();
    }
    await expect(page.getByTestId('task-inspector')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    if (!dirty) await trigger.click();
  }
});

test('tasks-retained-resize: mounted desktop draft and hit targets fit1440→390', async ({ page }) => {
  // Regression: the higher-specificity fixed400px grid overflows a retained inspector.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page, `tasks/task/${id}`);
  const inspector = page.getByTestId('task-inspector');
  const form = await page.getByTestId('task-edit-title').elementHandle();
  await page.getByTestId('task-edit-title').fill('Resize draft');
  await page.getByTestId('task-edit-notes').fill('Retained notes');
  const url = page.url();
  await page.setViewportSize({ width: 390, height: 844 });
  await inspector.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('task-inspector-dialog')).toHaveCount(0);
  expect(await form!.evaluate(el => el.isConnected)).toBe(true);
  await expect(page.getByTestId('task-edit-title')).toHaveValue('Resize draft');
  await expect(page.getByTestId('task-edit-notes')).toHaveValue('Retained notes');
  await expect(page).toHaveURL(url);
  for (const target of [inspector, page.getByTestId('task-detail-complete'), page.getByTestId('task-detail-close')]) {
    const box = (await target.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    if (target !== inspector) expect(await target.evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })).toBe(true);
  }
  for (const target of [inspector, page.locator('.tasks-scroll'), page.locator('html')]) expect(await target.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByTestId('task-detail-close').click();
  await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByTestId(`task-select-${id}`).click();
  await expect(page.getByTestId('task-inspector-dialog')).toBeVisible();
});

test('tasks-preservation: All completion filter survives inspector URL changes and reload', async ({ page }) => {
  // Regression: writeUrl removes completion=all even though the default is Open.
  await openPage(page, 'tasks');
  await page.getByTestId('tasks-completion-filter').selectOption('all');
  await page.getByTestId(`task-select-${id}`).click();
  await expect(page).toHaveURL(/completion=all/);
  await page.reload();
  await expect(page.getByTestId('tasks-completion-filter')).toHaveValue('all');
  await expect(page.getByTestId('task-inspector')).toBeVisible();
  await page.getByTestId('task-detail-close').click();
  await expect(page).toHaveURL(/#\/tasks\?completion=all$/);
});

test('tasks-preservation: query defaults are key-specific and unrelated filters survive selection', async ({ page }) => {
  // Regression: values such as all/open/due are deleted from unrelated keys.
  const query = '?completion=all&tag=worship&priority=3&date=today&sort=title&extra=all';
  await openPage(page, `tasks/task/${id}`, query);
  await page.getByTestId('task-detail-close').click();
  await expect(page).toHaveURL(new RegExp(`#/tasks\\${query}$`));
  await page.getByTestId('tasks-view-board').click();
  await page.getByTestId(`task-card-${id}`).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/board/task/${id}\\${query}$`));
  await page.getByTestId('task-detail-close').click();
  for (const word of ['all', 'open', 'due', '0']) {
    await page.getByTestId('tasks-search').fill(word);
    expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('search')).toBe(word);
  }
});

test('tasks-dirty-switch: selection and URL wait for Save, Discard or Keep editing', async ({ page }) => {
  // Regression: changing selection silently unmounts dirty fields or changes the URL first.
  await openPage(page, `tasks/task/${id}`);
  await page.getByTestId('task-edit-title').fill('Guarded draft');
  const next = page.locator(`[data-testid^="task-select-"]:not([data-testid="task-select-${id}"])`).first();
  const nextId = (await next.getAttribute('data-testid'))!.replace('task-select-', '');
  await next.click();
  await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/task/${id}$`));
  await expect(page.getByTestId('task-edit-title')).toHaveValue('Guarded draft');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await next.click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/task/${nextId}$`));
  await page.getByTestId(`task-select-${id}`).click();
  await expect(page.getByTestId('task-edit-title')).toHaveValue('Guarded draft');
  await page.getByTestId('task-edit-title').fill('Discard this');
  await page.getByTestId('task-detail-close').click();
  await expect(page).toHaveURL(new RegExp(`/task/${id}$`));
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByTestId('task-inspector')).toHaveCount(0);
  await page.getByTestId(`task-select-${id}`).click();
  await expect(page.getByTestId('task-edit-title')).toHaveValue('Guarded draft');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`tasks-density: compact actionable queue at ${viewport.width}`, async ({ page }) => {
    // Regression: empty inspector and redundant actions consume the work viewport.
    await page.setViewportSize(viewport);
    await openPage(page, 'tasks');
    await expect(page.getByTestId('task-inspector')).toHaveCount(0);
    if (viewport.width === 1440) expect((await page.locator('.tasks-header').boundingBox())!.height).toBeLessThanOrEqual(64);
    await expect(page.getByTestId('tasks-search')).toBeInViewport();
    await expect(page.getByTestId('tasks-completion-filter')).toBeInViewport();
    await expect(page.getByTestId('tasks-date-filter')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeInViewport();
    const row = page.locator('.task-row').first();
    await expect(row).toBeInViewport();
    expect((await row.boundingBox())!.height).toBe(56);
    await expect(page.locator('.task-inspect-button')).toHaveCount(0);
    const target = row.getByRole('checkbox');
    const box = (await target.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const main = (await row.locator('.task-row-main').boundingBox())!;
    const menu = (await row.locator('.task-menu-trigger').boundingBox())!;
    expect(main.x).toBeGreaterThanOrEqual(box.x + box.width);
    expect(main.x + main.width).toBeLessThanOrEqual(menu.x);
    expect(await target.evaluate((el) => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`tasks-inspector: sticky status-only action preserves drafts at ${viewport.width}`, async ({ page }) => {
    // Regression: completion submits or remounts the draft, or scrolls offscreen.
    await page.setViewportSize(viewport);
    await openPage(page, `tasks/task/${id}`);
    const inspector = page.getByTestId('task-inspector');
    if (viewport.width === 1440) {
      const width = (await inspector.boundingBox())!.width;
      expect(width).toBeGreaterThanOrEqual(380);
      expect(width).toBeLessThanOrEqual(420);
    } else await expect(page.getByRole('dialog')).toBeVisible();
    const action = page.getByTestId('task-detail-complete');
    await expect(action).toHaveText('Complete task');
    await expect(action).toBeInViewport();
    const actionBox = (await action.boundingBox())!;
    const headingBox = (await inspector.locator('#task-detail-title').boundingBox())!;
    expect(actionBox.y).toBeGreaterThanOrEqual(headingBox.y + headingBox.height);
    await page.getByTestId('task-edit-title').fill('Unsaved title');
    await page.getByTestId('task-edit-notes').fill('Unsaved notes');
    await page.getByTestId('task-edit-scheduled-date').fill('2026-09-13');
    await page.getByTestId('task-save').scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
    await action.focus();
    await page.keyboard.press('Space');
    await expect(action).toHaveText('Reopen task');
    await expect(page.getByTestId('task-edit-title')).toHaveValue('Unsaved title');
    await expect(page.getByTestId('task-edit-notes')).toHaveValue('Unsaved notes');
    await expect(page.getByTestId('task-edit-scheduled-date')).toHaveValue('2026-09-13');
    await expect(page.getByTestId('page-trace').getByText(`PATCH /tasks/${id} {status:"done"} → 200`, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('page-trace')).not.toContainText('{title,notes');
    await action.click();
    await expect(action).toHaveText('Complete task');
    await expect(page.getByTestId('task-edit-title')).toHaveValue('Unsaved title');
  });
}

test('tasks-board: compact cards have sibling keyboard completion', async ({ page }) => {
  // Regression: card activation eats Space or completion also opens the inspector.
  await openPage(page, 'tasks/board', '?tag=worship');
  const card = page.getByTestId(`task-card-${id}`);
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(94);
  const complete = card.getByRole('checkbox');
  await complete.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('kanban-column-done').getByTestId(`task-card-${id}`)).toBeVisible();
  await expect(page.getByTestId('task-inspector')).toHaveCount(0);
  await expect(page.getByTestId('page-trace').getByText(`PATCH /tasks/${id} {status:"done"} → 200`, { exact: true })).toHaveCount(1);
});

test('tasks-permissions: readonly and source-owned block status, collaborators can complete', async ({ page }) => {
  // Regression: owner-only people permissions incorrectly prohibit collaborator completion.
  await openPage(page, 'tasks/task/task-shared-with-me', '?state=forbidden');
  await expect(page.getByTestId('task-add-collaborator')).toBeDisabled();
  await expect(page.getByTestId('task-detail-complete')).toBeEnabled();
  await page.getByTestId('task-detail-complete').click();
  await expect(page.getByTestId('task-detail-complete')).toHaveText('Reopen task');
  await openPage(page, `tasks/task/${id}`, '?state=readonly');
  await expect(page.getByTestId('task-detail-complete')).toBeDisabled();
  await expect(page.getByTestId('task-inspector')).toContainText('Read-only workspace');
  await openPage(page, 'tasks/task/task-calendar-shadow');
  await expect(page.getByTestId('task-detail-complete')).toBeDisabled();
  await expect(page.getByTestId('task-inspector')).toContainText('Synchronized source of truth');
});

test('tasks-narrow: Escape preserves dirty fields, Discard restores focus, People stays keyboard usable', async ({ page }) => {
  // Regression: sheet cancellation bypasses the dirty guard or traps focus outside People.
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, 'tasks');
  const trigger = page.getByTestId(`task-select-${id}`);
  await trigger.click();
  await page.getByTestId('task-edit-due-date').fill('2026-09-17');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/task/${id}$`));
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByTestId('task-edit-due-date')).toHaveValue('2026-09-17');
  await expect(page.getByTestId('task-edit-title')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByTestId('task-inspector')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByTestId('task-add-collaborator').click();
  const option = page.getByTestId('task-collaborator-option-7');
  await option.focus();
  await expect(option).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('task-collaborator-7')).toBeVisible();
});
