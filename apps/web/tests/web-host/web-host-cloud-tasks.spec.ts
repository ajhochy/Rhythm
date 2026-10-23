// UI + real web proxy + synthetic upstream persistence only; not real-account proof.
import { test, expect, responseFor, assertResponse, openTaskDialog } from './cloud-parity-fixture';

test('#63: [cloud fixture] tasks: create, edit, complete, reload and permanently delete', async ({ page, tasks }) => {
  // Catches optimistic-only writes, wrong backend routing, lost edits and a completed task disappearing after reload.
  await tasks.open();
  const row = await tasks.create(' café "quoted" 😀');
  await page.getByTestId(`task-select-${row.id}`).click();
  const title = `${tasks.prefix} edited & <literal> 😀`;
  const notes = `${tasks.prefix} notes\nsecond line with apostrophe's text`;
  await page.getByTestId('task-edit-title').fill(title);
  await page.getByTestId('task-edit-notes').fill(notes);
  const saved = responseFor(page, 'PATCH', `/cloud/tasks/${row.id}`);
  await page.getByTestId('task-save').click();
  const savedResponse = await saved;
  await assertResponse(savedResponse, 'PATCH', `/cloud/tasks/${row.id}`, 200);
  expect(await savedResponse.json()).toMatchObject({ id: row.id, title, notes });
  expect(await tasks.read(row.id)).toMatchObject({ title, notes });
  await expect(page.getByTestId('task-inspector')).toContainText(title);
  const completed = responseFor(page, 'PATCH', `/cloud/tasks/${row.id}`);
  await page.getByTestId(`task-complete-${row.id}`).click();
  const completedResponse = await completed;
  await assertResponse(completedResponse, 'PATCH', `/cloud/tasks/${row.id}`, 200);
  expect(await completedResponse.json()).toMatchObject({ status: 'done', title });
  expect(await tasks.read(row.id)).toMatchObject({ status: 'done', title, notes });
  await page.reload();
  await page.getByTestId('tasks-completion-filter').selectOption('all');
  await page.getByTestId('tasks-search').fill(tasks.prefix);
  await expect(page.getByTestId(`task-row-${row.id}`)).toContainText(title);
  await page.getByTestId(`task-select-${row.id}`).click();
  await expect(page.getByTestId('task-edit-notes')).toHaveValue(notes);
  const removed = responseFor(page, 'DELETE', `/cloud/tasks/${row.id}`);
  await page.getByTestId(`task-menu-${row.id}`).click();
  await page.getByTestId(`task-delete-${row.id}`).click();
  await page.getByTestId('task-delete-confirm').click();
  await assertResponse(await removed, 'DELETE', `/cloud/tasks/${row.id}`, 204);
  await expect(page.getByTestId(`task-row-${row.id}`)).toHaveCount(0);
  expect((await tasks.api!.fetch(`/cloud/tasks/${row.id}`)).status).toBe(404);
});

test('#64: [cloud fixture] tasks: blank/whitespace and cancel/reload never create a record', async ({ page, tasks }) => {
  // Catches whitespace bypassing validation, Cancel committing a draft, and reload accidentally submitting a dialog.
  await tasks.open();
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/cloud/tasks') writes.push(request.postData() ?? ''); });
  await openTaskDialog(page);
  await page.getByTestId('task-create-title').fill('');
  await page.getByTestId('task-create-submit').click();
  await expect(page.getByTestId('task-create-dialog')).toBeVisible();
  await page.getByTestId('task-create-title').fill('   ');
  await page.getByTestId('task-create-submit').click();
  await expect(page.getByTestId('task-create-dialog')).toBeVisible();
  await page.getByTestId('task-create-title').fill(`${tasks.prefix} cancelled`);
  await page.getByTestId('task-create-cancel').click();
  await expect(page.getByTestId('task-create-dialog')).toHaveCount(0);
  await openTaskDialog(page);
  await page.getByTestId('task-create-title').fill(`${tasks.prefix} discarded on reload`);
  await page.reload();
  await expect(page.getByTestId('tasks-title').or(page.locator('#tasks-title'))).toBeVisible();
  expect(writes).toEqual([]);
  expect((await tasks.list()).filter(row => tasks.owns(row.title))).toEqual([]);
});

test('#65: [cloud fixture] tasks: rapid repeat submit persists exactly one task', async ({ page, tasks }) => {
  // Catches a double click issuing two writes before React's pending state disables the form.
  await tasks.open();
  await openTaskDialog(page);
  await page.getByTestId('task-create-title').fill(tasks.prefix);
  const created = responseFor(page, 'POST', '/cloud/tasks');
  await page.getByTestId('task-create-submit').dblclick();
  const response = await created;
  await assertResponse(response, 'POST', '/cloud/tasks', 201);
  const row = await response.json();
  tasks.remember(row);
  await expect(page.getByTestId(`task-row-${row.id}`)).toContainText(tasks.prefix);
  expect((await tasks.list()).filter(row => tasks.owns(row.title))).toHaveLength(1);
});

test('#66: [cloud fixture] tasks: failed create retains the draft and can be retried', async ({ page, tasks }) => {
  // Catches closing the dialog on a failed save or rendering a phantom task as successfully persisted.
  await tasks.open();
  await openTaskDialog(page);
  await page.getByTestId('task-create-title').fill(tasks.prefix);
  const failOnce = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ status: 503, json: { error: { code: 'SMOKE_UNAVAILABLE', message: '[smoke] temporary task outage' } } });
    await page.unroute('**/cloud/tasks', failOnce);
  };
  await page.route('**/cloud/tasks', failOnce);
  const failed = responseFor(page, 'POST', '/cloud/tasks');
  await page.getByTestId('task-create-submit').click();
  await assertResponse(await failed, 'POST', '/cloud/tasks', 503);
  await expect(page.getByRole('alert').filter({ hasText: /unavailable|failed|retry|temporary|503/i }).first()).toBeVisible();
  await expect(page.getByTestId('task-create-title')).toHaveValue(tasks.prefix);
  expect((await tasks.list()).filter(row => tasks.owns(row.title))).toEqual([]);
  const created = responseFor(page, 'POST', '/cloud/tasks');
  await page.getByTestId('task-create-submit').click();
  const response = await created;
  await assertResponse(response, 'POST', '/cloud/tasks', 201);
  const row = await response.json(); tasks.remember(row);
  expect(await tasks.read(row.id)).toMatchObject({ title: tasks.prefix });
  await expect(page.getByTestId(`task-row-${row.id}`)).toContainText(tasks.prefix);
});

test('#67: [cloud fixture] tasks: delete cancellation preserves a long title after reload', async ({ page, tasks }) => {
  // Catches truncating persisted long content and dispatching Delete before the confirmation is accepted.
  await tasks.open();
  const title = ` ${'long café 😀 '.repeat(35)}`.trimEnd();
  const row = await tasks.create(title);
  const deleted: string[] = [];
  page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/cloud/tasks/${row.id}`) deleted.push(request.url()); });
  await page.getByTestId(`task-menu-${row.id}`).click();
  await page.getByTestId(`task-delete-${row.id}`).click();
  await page.getByTestId('task-delete-cancel').click();
  await page.reload();
  await page.getByTestId('tasks-search').fill(tasks.prefix);
  await expect(page.getByTestId(`task-row-${row.id}`)).toContainText(tasks.prefix + title);
  expect(await tasks.read(row.id)).toMatchObject({ title: tasks.prefix + title });
  expect(deleted).toEqual([]);
});
