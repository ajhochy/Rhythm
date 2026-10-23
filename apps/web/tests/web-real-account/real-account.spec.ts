import { createHash } from 'node:crypto';
import { test, expect, enabled, origin, responseFor, checked, type Row } from './real-account-fixture';

// Source-backed authoring only until root runs this dedicated final-candidate set.
// Existing synthetic specs remain separate; none of their fixtures are imported.
test.describe.configure({ mode: 'serial' });
test.skip(!enabled, 'Explicit AJ-only real-account opt-in required');
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('real local Cookbook: UI create, exact-owned API edit, reload and UI delete; never run', async ({ page, account }) => {
  const title = `${account.marker} inert local recipe`;
  const steps = ['First inert verification step.', 'Second inert verification step.'];
  const body = { title, description: `${account.marker} no execution`, stepsJson: JSON.stringify(steps) };
  await account.prepareCreate('cookbook', body);
  await page.goto('/#/tools/cookbook');
  await page.getByTestId('cookbook-new').click();
  const editor = page.getByTestId('cookbook-editor');
  await editor.getByLabel('Title', { exact: true }).fill(title);
  await editor.getByLabel('Description', { exact: true }).fill(body.description);
  await editor.getByLabel('Steps (one per line)', { exact: true }).fill(steps.join('\n'));
  const created = responseFor(page, 'POST', '/agent-cookbook');
  await page.getByTestId('cookbook-save').click();
  const response = await created; await checked(response, 201);
  const row = await response.json() as Row; account.remember('cookbook', row);
  expect({ title: row.title, description: row.description, steps: JSON.parse(row.stepsJson), ownerUserId: row.ownerUserId, boundConfigId: row.boundConfigId })
    .toEqual({ title, description: body.description, steps, ownerUserId: account.candidate.localOwnerId, boundConfigId: null });
  const id = row.id;
  await page.getByTestId(`recipe-${id}`).click();
  await expect(page.locator('.recipe-steps li')).toHaveText(steps);
  // Source UI has New/Delete but no editor for an existing recipe. This is explicitly API edit proof.
  const edited = { title: `${title} edited`, description: `${account.marker} saved API edit`, stepsJson: JSON.stringify([...steps, 'Third inert step.']) };
  const updated = await account.fetch(`/agent-cookbook/${id}`, 'PATCH', edited);
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ id, ...edited, ownerUserId: account.candidate.localOwnerId, boundConfigId: null });
  expect(await account.json(`/agent-cookbook/${id}`)).toMatchObject({ id, ...edited });
  const reloaded = responseFor(page, 'GET', '/agent-cookbook'); await page.reload();
  await checked(await reloaded, 200);
  await page.getByTestId(`recipe-${id}`).click();
  await expect(page.getByTestId(`recipe-${id}`)).toContainText(edited.title);
  await expect(page.locator('.recipe-steps li')).toHaveText([...steps, 'Third inert step.']);
  const deleted = responseFor(page, 'DELETE', `/agent-cookbook/${id}`);
  await page.getByTestId(`cookbook-delete-${id}`).click();
  await page.getByTestId('cookbook-delete-dialog-confirm').click();
  await checked(await deleted, 204);
  await expect(page.getByTestId(`recipe-${id}`)).toHaveCount(0);
  await account.assertAbsent(account.entries.find(entry => entry.id === id)!);
});

test('real AJ cloud task: private UI create, edit, complete, reload and exact-ID delete', async ({ page, account }) => {
  const title = `${account.marker} private task`;
  const notes = `${account.marker} no staff notification or sharing`;
  await account.prepareCreate('task', { title, notes, preferredAgent: null });
  await page.goto('/#/tasks');
  const empty = page.getByTestId('tasks-empty-create');
  await (await empty.isVisible() ? empty : page.getByTestId('tasks-header-add-task')).click();
  await page.getByTestId('task-create-title').fill(title);
  await page.getByTestId('task-create-notes').fill(notes);
  await expect(page.getByTestId('task-create-collaborator')).toHaveValue('');
  await expect(page.getByTestId('task-create-scheduled-date')).toHaveValue('');
  await expect(page.getByTestId('task-create-due-date')).toHaveValue('');
  const created = responseFor(page, 'POST', '/cloud/tasks');
  await page.getByTestId('task-create-submit').click();
  const response = await created; await checked(response, 201);
  const row = await response.json() as Row; account.remember('task', row);
  const id = row.id;
  expect({ ownerId: row.ownerId, title: row.title, notes: row.notes, collaborators: row.collaborators,
    isShared: row.isShared, workspaceId: row.workspaceId, sourceType: row.sourceType, sourceId: row.sourceId })
    .toEqual({ ownerId: account.cloudOwnerId, title, notes, collaborators: [], isShared: false,
      workspaceId: null, sourceType: null, sourceId: null });
  await page.getByTestId('tasks-search').fill(account.marker);
  await page.getByTestId(`task-select-${id}`).click();
  const editedTitle = `${title} edited`;
  const editedNotes = `${notes}\nsecond owned line`;
  await page.getByTestId('task-edit-title').fill(editedTitle);
  await page.getByTestId('task-edit-notes').fill(editedNotes);
  const saved = responseFor(page, 'PATCH', `/cloud/tasks/${id}`);
  await page.getByTestId('task-save').click(); await checked(await saved, 200);
  const updated = await account.json(`/cloud/tasks/${id}`); account.assertOwned('task', updated);
  expect({ title: updated.title, notes: updated.notes, ownerId: updated.ownerId })
    .toEqual({ title: editedTitle, notes: editedNotes, ownerId: account.cloudOwnerId });
  expect(await account.json(`/cloud/tasks/${id}/collaborators`)).toEqual([]);
  // Completion has no recipients: controller gets only this owner and NotificationService excludes the actor.
  const completed = responseFor(page, 'PATCH', `/cloud/tasks/${id}`);
  await page.getByTestId(`task-complete-${id}`).click(); await checked(await completed, 200);
  expect((await account.json(`/cloud/tasks/${id}`)).status).toBe('done');
  const reload = responseFor(page, 'GET', '/cloud/tasks'); await page.reload(); await checked(await reload, 200);
  await page.getByTestId('tasks-completion-filter').selectOption('all');
  await page.getByTestId('tasks-search').fill(account.marker);
  await expect(page.getByTestId(`task-row-${id}`)).toContainText(editedTitle);
  await page.getByTestId(`task-select-${id}`).click();
  await expect(page.getByTestId('task-edit-notes')).toHaveValue(editedNotes);
  const deleted = responseFor(page, 'DELETE', `/cloud/tasks/${id}`);
  await page.getByTestId(`task-menu-${id}`).click();
  await page.getByTestId(`task-delete-${id}`).click();
  await page.getByTestId('task-delete-confirm').click(); await checked(await deleted, 204);
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  await account.assertAbsent(account.entries.find(entry => entry.id === id)!);
});

test('real cloud navigation: narrow Tasks route and reload use the authenticated proxy without writes', async ({ page, account }) => {
  const before = account.entries.length;
  await page.setViewportSize({ width: 550, height: 600 });
  await page.goto('/#/tools/cookbook');
  const direct = page.getByTestId('nav-tasks');
  if (!await direct.isVisible()) await page.getByTestId('nav-more').click();
  const loaded = responseFor(page, 'GET', '/cloud/tasks');
  await (await direct.isVisible() ? direct : page.getByTestId('nav-tasks-overflow')).click();
  const response = await loaded; await checked(response, 200);
  expect(Array.isArray(await response.json())).toBe(true);
  await expect(page).toHaveURL(/#\/tasks(?:\?.*)?$/);
  await expect(page.locator('#tasks-title')).toBeVisible();
  await expect(page.getByTestId('route-not-found')).toHaveCount(0);
  const reload = responseFor(page, 'GET', '/cloud/tasks'); await page.reload();
  const again = await reload; await checked(again, 200);
  expect(Array.isArray(await again.json())).toBe(true);
  await expect(page.locator('#tasks-title')).toBeVisible();
  expect(account.entries.length).toBe(before);
});

test('real private live artifact: API create and revision update, standalone browser render and tombstone cleanup', async ({ page, account }) => {
  expect(account.workspaceId, 'UNVERIFIED: AJ needs an existing cloud workspace for private artifact API proof').toBeGreaterThan(0);
  const title = `${account.marker} private HTML artifact`;
  const marker = `${account.marker} first revision`;
  const bundle = { html: `<!doctype html><html><head><title>${title}</title></head><body><main id="owned-marker">${marker}</main></body></html>`, css: '', js: '' };
  const body = { type: 'html', title, workspaceId: account.workspaceId, visibility: 'private',
    collaborators: [], declaredCapabilities: [], bundle, state: {} };
  await account.prepareCreate('artifact', body);
  const response = await account.fetch('/cloud/live-artifacts', 'POST', body);
  expect(response.status, 'UNVERIFIED: deployed public artifact create route required').toBe(201);
  const row = await response.json() as Row; account.remember('artifact', row);
  const id = row.id;
  expect({ ownerUserId: row.ownerUserId, visibility: row.visibility, bundleRevision: row.currentBundleRevision,
    stateRevision: row.currentStateRevision, bundleHash: row.currentBundleHash, stateHash: row.currentStateHash })
    .toEqual({ ownerUserId: account.cloudOwnerId, visibility: 'private', bundleRevision: 1,
      stateRevision: 1, bundleHash: sha(bundle), stateHash: sha({}) });
  expect(await account.json(`/cloud/live-artifacts/${id}/collaborators`)).toEqual([]);
  // Direct render does not mount Dashboard or modify existing artifactTabIds preferences.
  const rendered = await page.goto(`${origin}/cloud/live-artifacts/${id}/render`);
  expect(rendered?.status()).toBe(200);
  await expect(page.locator('#owned-marker')).toHaveText(marker);
  const nextMarker = `${account.marker} second revision`;
  const editedTitle = `${title} edited`;
  const nextBundle = { ...bundle, html: bundle.html.replace(marker, nextMarker) };
  const renamed = await account.fetch(`/cloud/live-artifacts/${id}`, 'PATCH', { title: editedTitle }); expect(renamed.status).toBe(200);
  const changed = await account.fetch(`/cloud/live-artifacts/${id}/bundle`, 'PUT', { expectedBundleRevision: 1, bundle: nextBundle }); expect(changed.status).toBe(200);
  const state = { marker: nextMarker };
  const saved = await account.fetch(`/cloud/live-artifacts/${id}/state`, 'PUT', { expectedStateRevision: 1, state }); expect(saved.status).toBe(200);
  const detail = await account.json(`/cloud/live-artifacts/${id}`); account.assertOwned('artifact', detail);
  expect({ title: detail.title, bundleRevision: detail.currentBundleRevision, stateRevision: detail.currentStateRevision,
    bundleHash: detail.currentBundleHash, stateHash: detail.currentStateHash, state: detail.state })
    .toEqual({ title: editedTitle, bundleRevision: 2, stateRevision: 2, bundleHash: sha(nextBundle), stateHash: sha(state), state });
  const reload = await page.reload(); expect(reload?.status()).toBe(200);
  await expect(page.locator('#owned-marker')).toHaveText(nextMarker);
  expect(await account.json(`/cloud/live-artifacts/${id}/collaborators`)).toEqual([]);
  expect((await account.fetch(`/cloud/live-artifacts/${id}`, 'DELETE')).status).toBe(204);
  await account.assertAbsent(account.entries.find(entry => entry.id === id)!);
});
