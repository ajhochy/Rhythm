import { expect, test, type Page } from '@playwright/test';
import type { Task } from '../src/gateway/planner';

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
        if (url.pathname === '/agents/models/catalog') return reply([]);
        if (url.pathname === '/opencode/auth/accounts') return reply({ accounts: [], defaultId: null });
        if (['/message-threads', '/agent-configs', '/agent-sessions', '/agent-approvals', '/notifications'].includes(url.pathname)) return reply([]);
        if (url.pathname === '/health') return reply({ status: 'ok', healthy: true });
        if (url.pathname === '/tasks') return reply(records);
        if (url.pathname === '/tasks/manual/collaborators') return reply([]);
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
  await expect(page.getByTestId('planner-summary-done')).toHaveText('2');
  expect(denied).toEqual([]);
});

test('e14-c3: manual endpoints and calendar read-only behavior remain unchanged', async ({ page }) => {
  const { writes, denied } = await intercept(page, [task('manual'), task('calendar', { sourceType: 'calendar_shadow_event' })]);
  await page.goto('/#/planner?week=2026-W37');
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
