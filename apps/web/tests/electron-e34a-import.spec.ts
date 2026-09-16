import { expect, test, type Page } from '@playwright/test';

type Write = { path: string; body: Record<string, any> };
const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4195', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' };
async function openImport(page: Page, reject: (write: Write) => boolean = () => false) {
  const writes: Write[] = [];
  const saved: Write[] = [];
  const unexpected: string[] = [];
  await page.routeWebSocket(/.*/, () => {});
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4195' && !['fetch', 'xhr'].includes(request.resourceType())) return route.continue();
    if (!['https://e34a.invalid', 'http://127.0.0.1:4001', 'http://127.0.0.1:4096'].includes(url.origin)) {
      unexpected.push(request.url()); return route.abort();
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() === 'POST') {
      expect(url.origin).toBe('https://e34a.invalid');
      expect(request.headers().authorization).toBe('Bearer e34a-synthetic');
      const write = { path: url.pathname, body: request.postDataJSON() }; writes.push(write);
      if (reject(write)) return route.fulfill({ status: 503, headers, json: { error: 'test-owned rejection' } });
      saved.push(write);
      return route.fulfill({ status: 201, headers, json: { ...write.body, id: url.pathname === '/project-templates' ? 'retained-template' : `record-${saved.length}` } });
    }
    const json = url.pathname === '/health' ? { status: 'ok' } : url.pathname === '/global/health' ? { healthy: true } : [];
    return route.fulfill({ headers, json });
  });
  await page.goto('/#/integrations/import');
  await expect(page.getByTestId('page-integrations')).toBeVisible();
  await page.getByTestId('ai-import-next').click();
  return { writes, saved, unexpected };
}

async function importJson(page: Page, value: unknown) {
  await page.getByTestId('ai-import-json').fill(JSON.stringify(value));
  await page.getByTestId('ai-import-submit').click();
  // Reach the original importer during RED as well as the new reviewed flow.
  if (await page.getByTestId('ai-import-confirm').count()) await page.getByTestId('ai-import-confirm').click();
}

test('E34A-c1: monthly/annual and separate planned/deadline payloads are not discarded', async ({ page }) => {
  const { saved, unexpected } = await openImport(page);
  await importJson(page, {
    tasks: [{ title: 'Both dates', scheduledDate: '2026-09-15', dueDate: '2026-09-20' }, { title: 'Deadline only', dueDate: '2026-09-22' }, { title: 'Planned only', scheduledDate: '2026-09-18' }],
    rhythms: [{ title: 'Month end', frequency: 'monthly', dayOfMonth: 28 }, { title: 'Annual review', frequency: 'annual', month: 11, dayOfMonth: 23 }],
  });
  await expect(page.getByTestId('toast-status')).toContainText('Imported: 3 tasks, 2 rhythms');
  expect(saved.map(w => w.body)).toEqual([
    { title: 'Both dates', scheduledDate: '2026-09-15', dueDate: '2026-09-20' },
    { title: 'Deadline only', dueDate: '2026-09-22' }, { title: 'Planned only', scheduledDate: '2026-09-18' },
    { title: 'Month end', frequency: 'monthly', dayOfMonth: 28 }, { title: 'Annual review', frequency: 'annual', month: 11, dayOfMonth: 23 },
  ]);
  expect(unexpected).toEqual([]);
});

test('E34A-c2: explicit preview distinguishes dates before any write (D14)', async ({ page }) => {
  const { writes } = await openImport(page);
  await page.getByTestId('ai-import-json').fill(JSON.stringify({ tasks: [{ title: 'Review dates', scheduledDate: '2026-09-15', dueDate: '2026-09-20' }], rhythms: [{ title: 'Monthly', frequency: 'monthly', dayOfMonth: 28 }, { title: 'Annual', frequency: 'annual', month: 11, dayOfMonth: 23 }] }));
  await page.getByTestId('ai-import-submit').click();
  await expect(page.getByTestId('ai-import-preview')).toContainText('Planned (scheduledDate): 2026-09-15');
  await expect(page.getByTestId('ai-import-preview')).toContainText('Deadline (dueDate): 2026-09-20');
  await expect(page.getByTestId('ai-import-preview')).toContainText('monthly · day 28');
  await expect(page.getByTestId('ai-import-preview')).toContainText('annual · month 11 · day 23');
  await expect(page.getByTestId('ai-import-preview')).toContainText("Flutter's old deadline import");
  expect(writes).toEqual([]);
  await page.getByTestId('ai-import-dialog').screenshot({ path: test.info().outputPath('date-preview.png') });
});

test('E34A-c3: step rejection retains template and prior steps instead of duplicating them', async ({ page }) => {
  let rejectStep = true;
  const { writes, saved } = await openImport(page, w => w.path.endsWith('/steps') && w.body.title === 'Second' && rejectStep);
  await importJson(page, { projects: [{ name: 'Recovery project', steps: [{ title: 'First', offsetDays: -7 }, { title: 'Second', offsetDays: -2 }, { title: 'Third', offsetDays: 0 }] }] });
  await expect(page.getByTestId('ai-import-partial-error')).toBeVisible();
  expect(saved.map(w => w.body.title ?? w.body.name)).toEqual(['Recovery project', 'First']);
  await expect(page.getByTestId('ai-import-recovery')).toContainText('retained-template');
  await expect(page.getByTestId('ai-import-recovery')).toContainText('Second');
  await expect(page.getByTestId('ai-import-recovery')).toContainText('Third');
  await expect(page.getByTestId('ai-import-json')).toBeDisabled();
  await page.getByTestId('ai-import-dialog').screenshot({ path: test.info().outputPath('retained-template.png') });
  const keys = await page.getByTestId('ai-import-recovery').locator('[data-operation-key]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-operation-key')));
  expect(new Set(keys).size).toBe(keys.length); expect(keys.length).toBeGreaterThan(0);
  // Repeated failure must keep the same local operations, not mint new ones.
  await page.getByTestId('ai-import-retry').click();
  await expect(page.getByTestId('ai-import-retry')).toBeEnabled();
  expect(await page.getByTestId('ai-import-recovery').locator('[data-operation-key]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-operation-key')))).toEqual(keys);
  rejectStep = false;
  await page.getByTestId('ai-import-retry').click();
  await expect(page.getByTestId('toast-status')).toContainText('Imported: 1 template');
  expect(saved.map(w => w.body.title ?? w.body.name)).toEqual(['Recovery project', 'First', 'Second', 'Third']);
  expect(writes.filter(w => w.path === '/project-templates')).toHaveLength(1);
  expect(writes.filter(w => w.body.title === 'First')).toHaveLength(1);
  expect(saved.filter(w => w.path.endsWith('/steps')).every(w => w.path === '/project-templates/retained-template/steps')).toBe(true);
  expect(saved.filter(w => w.path.endsWith('/steps')).map(w => [w.body.offsetDays, w.body.sortOrder])).toEqual([[-7, 0], [-2, 1], [0, 2]]);
  await page.getByTestId('open-ai-import').click(); await page.getByTestId('ai-import-next').click();
  await expect(page.getByTestId('ai-import-json')).toHaveValue('');
});

test('E34A-c4: failed tasks and rhythms retry independently and preserve confirmed successes', async ({ page }) => {
  let failures = new Set(['Task retry', 'Rhythm retry']);
  const { saved, writes } = await openImport(page, w => failures.has(w.body.title));
  await importJson(page, { tasks: [{ title: 'Task success' }, { title: 'Task retry' }], rhythms: [{ title: 'Rhythm success', frequency: 'weekly', dayOfWeek: 2 }, { title: 'Rhythm retry', frequency: 'monthly', dayOfMonth: 19 }] });
  await expect(page.getByTestId('ai-import-partial-error')).toBeVisible();
  failures.delete('Task retry');
  await page.getByTestId('ai-import-retry').click();
  await expect(page.getByTestId('ai-import-recovery')).toContainText('Rhythm retry');
  await expect(page.getByTestId('ai-import-recovery')).not.toContainText('Task retry');
  failures.clear();
  await page.getByTestId('ai-import-retry').click();
  await expect(page.getByTestId('toast-status')).toContainText('Imported: 2 tasks, 2 rhythms');
  expect(saved.map(w => w.body.title)).toEqual(['Task success', 'Rhythm success', 'Task retry', 'Rhythm retry']);
  expect(writes.filter(w => w.body.title === 'Task success')).toHaveLength(1);
  expect(writes.filter(w => w.body.title === 'Rhythm success')).toHaveLength(1);
  expect(writes.filter(w => w.body.title === 'Task retry')).toHaveLength(2);
});

test('E34A-c5: local-only warning and close/reload/abandon semantics never promise exactly once', async ({ page }) => {
  const { writes, saved } = await openImport(page, w => w.body.title === 'Unconfirmed');
  await expect(page.getByTestId('ai-import-retry-warning')).toContainText('API does not provide idempotency');
  await expect(page.getByTestId('ai-import-retry-warning')).toContainText('Reloading or leaving this page loses recovery');
  await expect(page.getByTestId('ai-import-retry-warning')).toContainText('lost response may have created a record');
  await importJson(page, { tasks: [{ title: 'Confirmed' }, { title: 'Unconfirmed' }] });
  await expect(page.getByTestId('ai-import-partial-error')).toBeVisible();
  const key = await page.getByTestId('ai-import-recovery').locator('[data-operation-key]').first().getAttribute('data-operation-key');
  await page.getByTestId('ai-import-cancel').click();
  await page.getByTestId('open-ai-import').click(); await page.getByTestId('ai-import-next').click();
  expect(await page.getByTestId('ai-import-recovery').locator('[data-operation-key]').first().getAttribute('data-operation-key')).toBe(key);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByTestId('ai-import-abandon').click();
  await expect(page.getByTestId('ai-import-recovery')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('ai-import-abandon').click();
  await expect(page.getByTestId('ai-import-json')).toHaveValue('');
  await expect(page.getByTestId('ai-import-recovery')).toHaveCount(0);
  expect(saved.map(w => w.body.title)).toEqual(['Confirmed']); expect(writes).toHaveLength(2);
  await importJson(page, { tasks: [{ title: 'Unconfirmed' }] });
  await expect(page.getByTestId('ai-import-partial-error')).toBeVisible();
  await page.reload(); await page.getByTestId('ai-import-next').click();
  await expect(page.getByTestId('ai-import-json')).toHaveValue('');
  await expect(page.getByTestId('ai-import-recovery')).toHaveCount(0);
  await expect(page.getByTestId('ai-import-retry-warning')).toBeVisible();
  expect(writes).toHaveLength(3);
});
