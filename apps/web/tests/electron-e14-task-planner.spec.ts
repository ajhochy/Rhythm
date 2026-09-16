import { expect, test, type Page } from '@playwright/test';
import type { Task } from '../src/gateway/planner';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', { configurable: true, value: {
      version: 8,
      gateway: { apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097', productionApiBase: 'https://api.vcrcapps.com' },
      auth: { currentSession: async () => ({ sessionToken: 'e02-synthetic-session-not-a-secret', user: { id: 1, name: 'Synthetic Admin', email: 'admin@example.invalid', role: 'admin', artifactTabIds: [] } }) },
    } });
  });
  await page.routeWebSocket(/.*/, socket => socket.close());
});

const task = (id: string, input: Partial<Task> = {}): Task => ({
  id, title: id, notes: null, dueDate: null, scheduledDate: null, scheduledOrder: null,
  locked: false, status: 'open', sourceType: 'manual', sourceId: null, sourceName: null,
  ownerId: 1, priority: null, tags: [], energy: null, collaborators: [],
  createdAt: '', updatedAt: '', preferredAgent: null, ...input,
});

async function intercept(page: Page, records: Task[]) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const denied: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4176') return route.continue();
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4176', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,PATCH,OPTIONS' };
    const reply = (body: unknown) => route.fulfill({ headers, json: body });
    if (['http://127.0.0.1:4098', 'http://127.0.0.1:4097', 'https://api.vcrcapps.com'].includes(url.origin)) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (request.method() === 'GET') {
        // Authenticated Shell keeps Dashboard mounted; these are outside the Planner under test.
        if (url.pathname === '/dashboard/summary') return route.fulfill({ status: 503, headers, json: {} });
        if (url.pathname === '/project-instances') return reply([]);
        if (url.pathname === '/agents/models/catalog') return reply([]);
        if (url.pathname === '/opencode/auth/accounts') return reply({ accounts: [], defaultId: null });
        if (url.pathname === '/workspaces/me/members') return reply([]);
        if (['/message-threads', '/agent-configs', '/agent-sessions', '/agent-approvals', '/notifications'].includes(url.pathname)) return reply([]);
        if (url.pathname === '/health') return reply({ status: 'ok', healthy: true });
        if (url.pathname === '/tasks') return reply(records);
        if (records.some(record => url.pathname === `/tasks/${record.id}/collaborators`)) return reply([]);
        if (url.pathname === '/weekly-plan') {
          const date = (item: Task) => item.sourceType === 'project_step' ? item.dueDate : item.scheduledDate;
          return reply({ weekLabel: '2026-W37', weekStart: '2026-09-07',
            backlog: records.filter((item) => !date(item)),
            days: Array.from({ length: 7 }, (_, i) => {
              const day = `2026-09-${String(7 + i).padStart(2, '0')}`;
              return { date: day, tasks: records.filter((item) => date(item) === day) };
            }),
          });
        }
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        writes.push({ path: url.pathname, body });
        const record = records.find((item) => url.pathname === (item.sourceType === 'project_step'
          ? `/project-instances/steps/${item.id}` : `/tasks/${item.id}`)
          || (item.sourceType === 'manual' && url.pathname === `/weekly-plan/tasks/${item.id}`));
        if (record) { Object.assign(record, body); return reply(record); }
      }
    }
    denied.push(`${request.method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  return { writes, denied };
}

test('e14-c1: local operative dates classify instead of sending every dated task to week', async ({ page }) => {
  // UTC is already Saturday: bare local Friday must still be Today, not overdue.
  await page.clock.setFixedTime(new Date('2026-09-12T06:30:00Z'));
  const cases = [
    ['yesterday', '2026-09-10', null, 'open', 'past-due'],
    ['today', '2026-09-11', '2026-09-10', 'open', 'today'],
    ['week', '2026-09-13', null, 'open', 'week'],
    ['month', '2026-09-14', null, 'open', 'month'],
    ['future', '2027-01-01', null, 'open', 'month'],
    ['undated', null, null, 'open', 'no-due'],
    ['deadline', null, '2026-09-11', 'open', 'today'],
    ['timestamp', '2026-09-12T06:00:00Z', null, 'open', 'today'],
    ['completed', '2026-09-10', null, 'done', 'completed'],
  ] as const;
  const records = cases.map(([id, scheduledDate, dueDate, status]) => task(id, { scheduledDate, dueDate, status }));
  const { denied } = await intercept(page, records);
  await page.goto('/#/tasks');
  // Exercise the real gateway mapper with only HTTP and clock boundaries intercepted.
  const mapped = await page.evaluate(async () => {
    const { createLiveTasksGateway } = await import('/src/gateway/tasks.ts');
    return (await createLiveTasksGateway('http://127.0.0.1:4098', 'e14-disposable').list()).map(({ id, bucket }) => [id, bucket]);
  });
  expect(mapped).toEqual(cases.map(([id, , , , bucket]) => [id, bucket]));
  await page.getByTestId('tasks-completion-filter').selectOption('all');
  for (const [id, , , , bucket] of cases) {
    await expect(page.getByTestId(`task-group-${bucket}`).getByTestId(`task-row-${id}`)).toBeVisible();
  }
  expect(denied).toEqual([]);
});

test('e14-c2: complete edit and drag address two canonical step IDs, not their shared instance', async ({ page }) => {
  const records = ['step-a', 'step-b'].map((id) => task(id, { sourceType: 'project_step', sourceId: 'instance-1' }));
  expect(records.every((item) => item.id !== item.sourceId)).toBe(true);
  const { writes, denied } = await intercept(page, records);
  await page.goto('/#/planner?week=2026-W37');
  await page.getByRole('button', { name: /^Backlog \d/ }).click();
  for (const record of records) {
    await page.getByTestId(`planner-task-${record.id}`).click();
    await expect(page.getByTestId('planner-edit-scheduled-date')).toHaveCount(0);
    await page.getByTestId('planner-edit-notes').fill(`Notes ${record.id}`);
    await page.getByTestId('planner-edit-due-date').fill('2026-09-11');
    await page.getByTestId('planner-save-task').click();
    await expect.poll(() => writes.at(-1)).toEqual({ path: `/project-instances/steps/${record.id}`, body: { notes: `Notes ${record.id}`, dueDate: '2026-09-11' } });
    await expect(page.getByTestId('planner-day-2026-09-11').getByTestId(`planner-task-${record.id}`)).toBeVisible();
    await page.getByTestId(`planner-task-${record.id}`).click();
    await expect(page.getByTestId('planner-edit-notes')).toHaveValue(`Notes ${record.id}`);
    await page.getByTestId('planner-edit-cancel').click();
    await page.getByTestId(`planner-task-${record.id}`).dragTo(page.getByTestId('planner-day-2026-09-12'));
    await expect(page.getByTestId('planner-day-2026-09-12').getByTestId(`planner-task-${record.id}`)).toBeVisible();
    await page.getByTestId(`planner-complete-${record.id}`).click();
    await expect(page.getByTestId(`planner-task-${record.id}`)).toHaveCount(0);
    await page.getByTestId('planner-filter-all').click();
    await expect(page.getByTestId(`planner-complete-${record.id}`)).toHaveAttribute('aria-label', `Reopen ${record.id}`);
    await page.getByTestId('planner-filter-open').click();
  }
  expect(writes).toEqual(records.flatMap(({ id }) => [
    { path: `/project-instances/steps/${id}`, body: { notes: `Notes ${id}`, dueDate: '2026-09-11' } },
    { path: `/project-instances/steps/${id}`, body: { dueDate: '2026-09-12' } },
    { path: `/project-instances/steps/${id}`, body: { status: 'done' } },
  ]));
  await page.reload();
  await page.getByText('Diagnostics', { exact: true }).click();
  await expect(page.getByTestId('planner-summary-done')).toHaveText('2');
  expect(denied).toEqual([]);
});

test('e14-c3: manual endpoints and calendar read-only behavior remain unchanged', async ({ page }) => {
  const { writes, denied } = await intercept(page, [task('manual'), task('calendar', { sourceType: 'calendar_shadow_event' })]);
  await page.goto('/#/planner?week=2026-W37');
  await page.getByRole('button', { name: /^Backlog \d/ }).click();
  await page.getByTestId('planner-task-manual').click();
  await page.getByTestId('planner-edit-notes').fill('Manual notes');
  await page.getByTestId('planner-edit-scheduled-date').fill('2026-09-11');
  await page.getByTestId('planner-edit-due-date').fill('2026-09-13');
  await page.getByTestId('planner-save-task').click();
  await expect(page.getByTestId('planner-day-2026-09-11').getByTestId('planner-task-manual')).toBeVisible();
  await page.getByTestId('planner-task-manual').dragTo(page.getByTestId('planner-day-2026-09-12'));
  await expect(page.getByTestId('planner-day-2026-09-12').getByTestId('planner-task-manual')).toBeVisible();
  await page.getByTestId('planner-complete-manual').click();
  await expect(page.getByTestId('planner-task-manual')).toHaveCount(0);
  expect(writes).toEqual([
    { path: '/tasks/manual', body: { notes: 'Manual notes', scheduledDate: '2026-09-11', dueDate: '2026-09-13' } },
    { path: '/weekly-plan/tasks/manual', body: { scheduledDate: '2026-09-12' } },
    { path: '/tasks/manual', body: { status: 'done' } },
  ]);
  await page.getByTestId('planner-task-calendar').click();
  await expect(page.getByTestId('planner-save-task')).toHaveCount(0);
  expect(denied).toEqual([]);
});

test('E32: Planner bulk completion, within-day ordering, and calendar times use canonical data', async ({ page }) => {
  const records = [
    task('bulk-a', { scheduledDate: '2026-09-09', scheduledOrder: 10 }),
    task('bulk-b', { scheduledDate: '2026-09-09', scheduledOrder: 20 }),
    task('calendar-time', { sourceType: 'calendar_shadow_event', scheduledDate: '2026-09-09', startsAt: '2026-09-09T16:00:00Z', endsAt: '2026-09-09T17:30:00Z' }),
  ];
  const { writes, denied } = await intercept(page, records);
  await page.goto('/#/planner?week=2026-W37');
  await expect(page).toHaveURL(/\/#\/planner\?week=2026-W37$/);
  await page.getByTestId('planner-task-bulk-a').click();
  await page.getByText('Move task', { exact: true }).click();
  await page.getByRole('button', { name: 'Move bulk-a later' }).click();
  await expect.poll(() => writes.some((write) => write.path === '/tasks/bulk-a' && write.body.scheduledOrder === 21)).toBe(true);
  await page.getByTestId('planner-inspector-close').click();
  await page.getByRole('button', { name: 'Select tasks', exact: true }).click();
  await page.getByTestId('planner-task-select-bulk-a').click();
  await page.getByTestId('planner-task-select-bulk-b').click();
  await page.getByTestId('planner-complete-selected').click();
  await expect.poll(() => writes.filter((write) => write.body.status === 'done').map((write) => write.path).sort()).toEqual(['/tasks/bulk-a', '/tasks/bulk-b']);
  const expectedTime = await page.evaluate(() => `${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date('2026-09-09T16:00:00Z'))}–${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date('2026-09-09T17:30:00Z'))}`);
  await expect(page.getByTestId('planner-task-time-calendar-time')).toHaveText(expectedTime);
  expect(denied).toEqual([]);
});

test('planner-redesign-c5 live: status-only writes survive failure, refresh failure, reopen and dirty close', async ({ page }) => {
  // Regression: write errors replace the board, refresh removes the editor, or Retry repeats a successful PATCH.
  const records = [task('manual', { scheduledDate: '2026-09-09', dueDate: '2026-09-13', notes: 'Stored note' })];
  const { writes } = await intercept(page, records);
  let failWrite = true, failRead = false;
  await page.route('**/tasks/manual', async route => {
    if (route.request().method() === 'PATCH' && failWrite) {
      failWrite = false;
      return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, json: { error: 'Write unavailable' } });
    }
    await route.fallback();
  });
  await page.route('**/weekly-plan?*', async route => {
    if (failRead) return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, json: { error: 'Read unavailable' } });
    await route.fallback();
  });
  await page.goto('/#/planner?week=2026-W37');
  await page.getByTestId('planner-task-manual').click();
  await page.getByTestId('planner-edit-notes').fill('Unsaved note');
  const action = page.getByTestId('planner-detail-complete');
  await expect(action).toHaveText('Complete task');
  await page.getByTestId('planner-save-task').scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 1 });
  await action.click();
  await expect(page.getByTestId('planner-inspector')).toContainText('Update task failed (503)');
  await expect(page.getByTestId('planner-task-manual')).toBeAttached();
  await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved note');
  expect(records[0].status).toBe('open');
  failRead = true;
  await page.getByTestId('planner-inspector').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(action).toHaveText('Reopen task');
  await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved note');
  expect(writes).toEqual([{ path: '/tasks/manual', body: { status: 'done' } }]);
  failRead = false;
  await page.getByTestId('planner-inspector').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('planner-inspector').getByRole('alert')).toHaveCount(0);
  expect(writes).toHaveLength(1);
  await action.click();
  await expect(action).toHaveText('Complete task');
  await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved note');
  expect(writes.at(-1)).toEqual({ path: '/tasks/manual', body: { status: 'open' } });
  await page.getByTestId('planner-inspector-close').click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved note');
  await page.getByTestId('planner-inspector-close').click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.reload();
  await page.getByTestId('planner-task-manual').click();
  await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Stored note');
});

test('planner-redesign-c6 live: native Move preserves manual deadline and canonical step IDs', async ({ page }) => {
  // Regression: keyboard Move changes a manual deadline or mutates the shared project instance.
  const records = [task('manual', { scheduledDate: '2026-09-09', dueDate: '2026-09-13' }), ...['step-a', 'step-b'].map(id => task(id, { sourceType: 'project_step', sourceId: 'instance-1', dueDate: '2026-09-09' }))];
  const { writes, denied } = await intercept(page, records);
  await page.goto('/#/planner?week=2026-W37');
  for (const record of records) {
    await page.getByTestId(`planner-task-${record.id}`).click();
    await page.getByText('Move task', { exact: true }).click();
    await page.getByLabel('Move to date', { exact: true }).fill('2026-09-11');
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(() => writes.at(-1)).toEqual({ path: record.sourceType === 'project_step' ? `/project-instances/steps/${record.id}` : `/weekly-plan/tasks/${record.id}`, body: record.sourceType === 'project_step' ? { dueDate: '2026-09-11' } : { scheduledDate: '2026-09-11' } });
    await page.getByTestId('planner-inspector-close').click();
    await expect(page.getByTestId('planner-day-2026-09-11').getByTestId(`planner-task-${record.id}`)).toBeVisible();
  }
  expect(records[0].dueDate).toBe('2026-09-13');
  expect(denied).toEqual([]);
});

test('planner-redesign-c7: shared completion stays enabled while source-owned and People writes stay unavailable', async ({ page }) => {
  // Regression: non-owner completion is disabled, or production mirrors and collaborator management become editable.
  const { writes } = await intercept(page, [task('manual', { scheduledDate: '2026-09-09', ownerId: 2, isShared: true }), task('mirror', { sourceType: 'prod_mirror', scheduledDate: '2026-09-09' })]);
  await page.goto('/#/planner?week=2026-W37');
  await expect(page.getByTestId('planner-task-mirror')).toHaveAttribute('draggable', 'false');
  await expect(page.getByTestId('planner-complete-mirror')).toHaveCount(0);
  await page.getByTestId('planner-task-mirror').click();
  await expect(page.getByTestId('planner-inspector')).toContainText('Read only · update in source');
  await expect(page.getByTestId('planner-save-task')).toHaveCount(0);
  await page.getByTestId('planner-inspector-close').click();
  await page.getByTestId('planner-task-manual').click();
  await expect(page.getByTestId('planner-collaborator-input')).toBeDisabled();
  await expect(page.getByTestId('planner-inspector')).toContainText('Only the task owner');
  await page.getByTestId('planner-detail-complete').click();
  await expect(page.getByTestId('planner-detail-complete')).toHaveText('Reopen task');
  expect(writes).toEqual([{ path: '/tasks/manual', body: { status: 'done' } }]);
});

test('planner-redesign-c1 live: bulk partial failure retains only the failed selections', async ({ page }) => {
  // Regression: a partial success clears failed selections or reports all records completed.
  const records = [task('bulk-a', { scheduledDate: '2026-09-09' }), task('bulk-b', { scheduledDate: '2026-09-09' })];
  await intercept(page, records);
  await page.route('**/tasks/bulk-b', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, json: {} }) : route.fallback());
  await page.goto('/#/planner?week=2026-W37');
  await page.getByRole('button', { name: 'Select tasks', exact: true }).click();
  for (const id of ['bulk-a', 'bulk-b']) await page.getByTestId(`planner-task-select-${id}`).click();
  await page.getByTestId('planner-complete-selected').click();
  await expect(page.getByTestId('planner-selection-count')).toHaveText('1 selected');
  await expect(page.getByTestId('planner-task-select-bulk-b')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('planner-task-bulk-a')).toHaveCount(0);
  await expect(page.getByTestId('planner-mutation-error')).toContainText('bulk-b');
  expect(records.map(record => record.status)).toEqual(['done', 'open']);
});

test('planner-redesign-c7: failed week navigation remains retryable after a successful initial load', async ({ page }) => {
  // Regression: nonblocking mutation error handling accidentally leaves blocking week navigation stuck loading.
  await intercept(page, [task('manual', { scheduledDate: '2026-09-09' })]);
  let failed = false;
  await page.route('**/weekly-plan?week=2026-W38', async route => {
    if (!failed) { failed = true; return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, json: {} }); }
    await route.fallback();
  });
  await page.goto('/#/planner?week=2026-W37');
  await expect(page.getByTestId('planner-task-manual')).toBeVisible();
  await page.getByTestId('planner-next-week').click();
  await expect(page.getByTestId('page-planner').getByTestId('page-state-server-error')).toBeVisible();
  await page.getByTestId('page-planner').getByTestId('page-retry').click();
  await expect(page.getByRole('region', { name: 'Weekly plan', exact: true })).toBeVisible();
});

test('planner-redesign-c7 sandbox: real API completion and Move preserve the dirty editor and persisted deadline', async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires an explicitly approved isolated sandbox');
  const base = `http://127.0.0.1:${process.env.RHYTHM_SANDBOX_API_PORT ?? '4598'}`;
  const headers = { Authorization: 'Bearer e02-synthetic-session-not-a-secret' };
  const health = await request.get(`${base}/opencode/health`);
  expect((await health.json()).status).toBe('ready');
  const response = await request.post(`${base}/tasks`, { headers, data: { title: 'Planner isolated acceptance', notes: 'Stored note', scheduledDate: '2026-09-09', dueDate: '2026-09-13' } });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  const denied: string[] = [];
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4175') return route.continue();
      if (['http://127.0.0.1:4098', 'http://127.0.0.1:4097', 'https://api.vcrcapps.com'].includes(url.origin)) {
        const cors = { 'access-control-allow-origin': 'http://127.0.0.1:4175', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        // Transport forwarding only: every response and mutation comes from the real isolated backend.
        const real = await route.fetch({ url: `${url.port === '4097' ? `http://127.0.0.1:${process.env.RHYTHM_SANDBOX_ENGINE_PORT ?? '4597'}` : base}${url.pathname}${url.search}`, headers: { ...route.request().headers(), ...headers }, maxRedirects: 0 });
        return route.fulfill({ response: real, headers: { ...real.headers(), ...cors } });
      }
      denied.push(url.origin); await route.abort();
    });
    await page.goto('/#/planner?week=2026-W37');
    // Text-zoom binding on the real live card; the fixture matrix covers all108 seeded titles.
    await page.setViewportSize({ width: 1024, height: 900 });
    const title = page.getByTestId(`planner-task-${created.id}`).locator('strong');
    await expect(title).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await expect(title).toHaveCSS('font-size', '26px');
    const zoom = await title.evaluate(el => ({ visible: el.clientHeight, content: el.scrollHeight }));
    expect(zoom.content).toBeGreaterThan(72);
    expect(zoom.content).toBeLessThanOrEqual(zoom.visible);
    console.log('live text200 title', zoom);
    await page.screenshot({ path: testInfo.outputPath('live-text200.png') });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await expect(title).toHaveCSS('font-size', '13px');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId(`planner-task-${created.id}`).click();
    await page.getByTestId('planner-edit-notes').fill('Unsaved live note');
    // P1: verify the same focus/paint repair on the real live composition, not only fixtures.
    await page.getByTestId('planner-inspector').locator('.dialog-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('planner-edit-scheduled-date')).toBeFocused();
    const focusGeometry = await page.getByTestId('planner-detail-complete').evaluate(button => {
      const b = button.getBoundingClientRect(), block = button.parentElement!.getBoundingClientRect();
      const field = document.activeElement!.getBoundingClientRect();
      return { height: b.height, blockBottom: block.bottom, fieldTop: field.top, overlap: Math.max(0, Math.min(b.bottom, field.bottom) - Math.max(b.top, field.top)), hits: [b.top + 1, b.top + b.height / 2].map(y => button.contains(document.elementFromPoint(b.left + b.width / 2, y))) };
    });
    console.log('live mobile Tab geometry', focusGeometry);
    expect(focusGeometry.height).toBe(44);
    expect(focusGeometry.fieldTop).toBeGreaterThanOrEqual(focusGeometry.blockBottom);
    expect(focusGeometry.overlap).toBe(0);
    expect(focusGeometry.hits).toEqual([true, true]);
    await page.screenshot({ path: testInfo.outputPath('live-mobile-tab.png') });
    await page.getByTestId('planner-detail-complete').click();
    await expect(page.getByTestId('planner-detail-complete')).toHaveText('Reopen task');
    await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved live note');
    let persisted = await (await request.get(`${base}/tasks/${created.id}`, { headers })).json();
    expect(persisted).toMatchObject({ status: 'done', notes: 'Stored note', dueDate: '2026-09-13' });
    await page.getByTestId('planner-detail-complete').click();
    await expect(page.getByTestId('planner-detail-complete')).toHaveText('Complete task');
    await page.getByText('Move task', { exact: true }).click();
    await page.getByLabel('Move to date', { exact: true }).fill('2026-09-11');
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${base}/tasks/${created.id}`, { headers })).json()).scheduledDate).toBe('2026-09-11');
    persisted = await (await request.get(`${base}/tasks/${created.id}`, { headers })).json();
    expect(persisted).toMatchObject({ status: 'open', notes: 'Stored note', dueDate: '2026-09-13' });
    await expect(page.getByTestId('planner-edit-notes')).toHaveValue('Unsaved live note');
    expect(denied).toEqual([]);
  } finally { expect((await request.delete(`${base}/tasks/${created.id}`, { headers })).ok()).toBe(true); }
});
