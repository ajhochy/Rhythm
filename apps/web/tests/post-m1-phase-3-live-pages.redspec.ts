import { expect, test, type Page } from '@playwright/test';

type Seen = { method: string; path: string; body: unknown };

const cloudCors = {
  'access-control-allow-origin': 'http://127.0.0.1:4176',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

const emptySummary = {
  tasks: { openCount: 0, pastDueCount: 0, pastDeadlineCount: 0, pastDeadlineTasks: [], todayRemainingCount: 0, todayTotalCount: 0, thisWeekRemainingCount: 0, thisWeekTotalCount: 0, unscheduledCount: 0, recent: [], pastDue: [], today: [], thisWeek: [], unscheduled: [] },
  rhythms: { activeCount: 0, items: [] }, projects: { activeCount: 0, items: [] },
  goals: { activeCount: 0, items: [] }, messages: { threadCount: 0, unreadPreviews: [] },
};

function responseFor(path: string): unknown {
  if (path === '/health') return { status: 'ok' };
  if (path === '/global/health') return { healthy: true };
  if (path === '/dashboard/summary') return emptySummary;
  if (path.startsWith('/weekly-plan')) return { weekLabel: '2026-W34', weekStart: '2026-08-17', days: [], backlog: [] };
  if (path === '/integrations/google-calendar/settings') return { calendars: [], selectedCalendarIds: [] };
  if (path === '/integrations/planning-center/task-preferences') return { teamIds: [], positionNames: [] };
  if (path === '/integrations/planning-center/task-options') return { teams: [], positionsByTeamId: {} };
  return [];
}

async function openLive(page: Page, hash: string): Promise<Seen[]> {
  const seen: Seen[] = [];
  const handleApi = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cloudCors });
    seen.push({ method: request.method(), path: `${url.pathname}${url.search}`, body: request.postDataJSON() ?? undefined });
    await route.fulfill({ status: 200, headers: cloudCors, contentType: 'application/json', body: JSON.stringify(responseFor(url.pathname)) });
  };
  await page.route('http://127.0.0.1:4098/**', handleApi);
  await page.route('https://api.vcrcapps.com/**', handleApi);
  await page.route('http://127.0.0.1:4097/**', async (route) => {
    const url = new URL(route.request().url());
    seen.push({ method: route.request().method(), path: `${url.pathname}${url.search}`, body: undefined });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFor(url.pathname)) });
  });
  await page.goto(`/#/${hash}`);
  await expect(page.getByRole('status', { name: 'Environment receipt' })).toContainText('Environment: Live');
  return seen;
}

function expectMethods(value: unknown, names: string[]): void {
  expect(value).toBeTruthy();
  for (const name of names) expect(typeof (value as Record<string, unknown>)[name], `${name} must be a real gateway operation`).toBe('function');
}

async function expectRequest(seen: Seen[], method: string, path: RegExp): Promise<void> {
  await expect.poll(() => seen.some((request) => request.method === method && path.test(request.path))).toBe(true);
}

test('post-m1-p3-c2a: live Dashboard consumes its real gateway instead of fixture state', async ({ page }) => {
  // Regression caught: Dashboard keeps rendering fixture summary/actions while live readiness is green; the GET assertion fails.
  const module = await import('../src/gateway/dashboard').catch(() => null);
  expect(module, 'Dashboard live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLiveDashboardGateway('http://127.0.0.1:4098', 'test-token', async () => new Response(JSON.stringify(emptySummary)));
  expectMethods(gateway, ['summary', 'projectInstances', 'createTask', 'updateTask', 'updateProjectStep', 'taskCollaborators', 'addTaskCollaborator', 'removeTaskCollaborator', 'messageThreads', 'messages']);
  const seen = await openLive(page, 'dashboard');
  await expectRequest(seen, 'GET', /^\/dashboard\/summary$/);
  expect(await page.getByText(/Local preview · no request sent/i).count()).toBe(0);
});

test('production repair: live Dashboard completion preserves the workspace while silently revalidating', async ({ page }) => {
  let status: 'open' | 'done' = 'open';
  let summaryLoads = 0;
  let releaseRevalidation: (() => void) | undefined;
  const revalidationGate = new Promise<void>((resolve) => { releaseRevalidation = resolve; });
  const task = () => ({ id: 'dashboard-live-task', title: 'Keep the dashboard mounted', status, scheduledDate: '2026-08-21', dueDate: null, notes: '', sourceType: 'task' });
  const summary = () => ({
    ...emptySummary,
    tasks: {
      ...emptySummary.tasks,
      openCount: status === 'open' ? 1 : 0,
      todayRemainingCount: status === 'open' ? 1 : 0,
      todayTotalCount: 1,
      thisWeekRemainingCount: status === 'open' ? 1 : 0,
      thisWeekTotalCount: 1,
      recent: [task()],
      today: status === 'open' ? [task()] : [],
      thisWeek: [],
    },
  });

  const handleDashboard = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cloudCors });
    if (url.pathname === '/dashboard/summary') {
      summaryLoads += 1;
      if (summaryLoads > 1) await revalidationGate;
      await route.fulfill({ status: 200, headers: cloudCors, contentType: 'application/json', body: JSON.stringify(summary()) });
      return;
    }
    if (url.pathname === '/project-instances') {
      await route.fulfill({ status: 200, headers: cloudCors, contentType: 'application/json', body: '[]' });
      return;
    }
    if (url.pathname === '/tasks/dashboard-live-task' && request.method() === 'PATCH') {
      status = 'done';
      await route.fulfill({ status: 200, headers: cloudCors, contentType: 'application/json', body: JSON.stringify(task()) });
      return;
    }
    await route.fulfill({ status: 200, headers: cloudCors, contentType: 'application/json', body: JSON.stringify(responseFor(url.pathname)) });
  };
  await page.route('http://127.0.0.1:4098/**', handleDashboard);
  await page.route('https://api.vcrcapps.com/**', handleDashboard);
  await page.route('http://127.0.0.1:4097/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"healthy":true}' }));
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('task-row-dashboard-live-task')).toBeVisible();

  await page.getByTestId('task-toggle-dashboard-live-task').click();
  await expect.poll(() => summaryLoads).toBeGreaterThan(1);
  await expect(page.getByTestId('page-state-loading')).toHaveCount(0);
  await expect(page.getByTestId('planning-today')).toBeVisible();
  await expect(page.getByTestId('task-row-dashboard-live-task')).toHaveCount(0);
  releaseRevalidation?.();
});

test('post-m1-p3-c2b: live Planner preserves WeeklyPlan and every persisted scheduling boundary', async ({ page }) => {
  // Regression caught: Planner drag/edit/create/collaborator controls mutate fixtures and never load the requested canonical week.
  const module = await import('../src/gateway/planner').catch(() => null);
  expect(module, 'Planner live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLivePlannerGateway('http://127.0.0.1:4098', 'test-token', async () => new Response('[]'));
  expectMethods(gateway, ['plan', 'scheduleTask', 'createTask', 'updateTask', 'updateProjectStep', 'taskCollaborators', 'addTaskCollaborator', 'removeTaskCollaborator']);
  const seen = await openLive(page, 'planner');
  await expectRequest(seen, 'GET', /^\/weekly-plan\?week=\d{4}-W\d{2}$/);
});

test('production repair: live Planner defaults to Open and completes in place without replacing the board', async ({ page }) => {
  let status: 'open' | 'done' = 'open';
  let planLoads = 0;
  let releaseRevalidation: (() => void) | undefined;
  const revalidationGate = new Promise<void>((resolve) => { releaseRevalidation = resolve; });
  const weeklyPlan = () => ({
    weekLabel: '2026-W34',
    weekStart: '2026-08-17',
    backlog: [],
    days: [{
      date: '2026-08-17',
      tasks: [
        { id: 'live-open', title: 'Ship usable Electron client', status, scheduledDate: '2026-08-17', energy: 'medium', sourceType: 'task' },
        { id: 'live-done', title: 'Completed history', status: 'done', scheduledDate: '2026-08-17', energy: 'low', sourceType: 'task' },
      ],
    }],
  });

  const handlePlanner = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cloudCors });
    if (url.pathname === '/weekly-plan') {
      planLoads += 1;
      if (planLoads > 1) await revalidationGate;
      await route.fulfill({ status: 200, headers: cloudCors, contentType: 'application/json', body: JSON.stringify(weeklyPlan()) });
      return;
    }
    if (url.pathname === '/tasks/live-open' && request.method() === 'PATCH') {
      status = 'done';
      await route.fulfill({ status: 200, headers: cloudCors, contentType: 'application/json', body: JSON.stringify({ ...weeklyPlan().days[0].tasks[0], status }) });
      return;
    }
    await route.fulfill({ status: 200, headers: cloudCors, contentType: 'application/json', body: JSON.stringify(responseFor(url.pathname)) });
  };
  await page.route('http://127.0.0.1:4098/**', handlePlanner);
  await page.route('https://api.vcrcapps.com/**', handlePlanner);
  await page.route('http://127.0.0.1:4097/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"healthy":true}' }));
  await page.goto('/#/planner');

  await expect(page.getByTestId('planner-filter-open')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('planner-task-live-open')).toBeVisible();
  await expect(page.getByTestId('planner-task-live-done')).toHaveCount(0);
  await page.getByTestId('planner-filter-all').click();
  await expect(page.getByTestId('planner-task-live-done')).toBeVisible();
  await page.getByTestId('planner-filter-open').click();

  await page.getByTestId('planner-complete-live-open').click();
  await expect.poll(() => planLoads).toBeGreaterThan(1);
  await expect(page.getByTestId('page-state-loading')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Weekly plan' })).toBeVisible();
  await expect(page.getByTestId('planner-task-live-open')).toHaveCount(0);
  releaseRevalidation?.();
});

test('post-m1-p3-c2c: live Tasks round-trips numeric collaborators and truthful source metadata', async ({ page }) => {
  // Regression caught: basic CRUD is live but collaborators remain local, createdBy is invented, and sourceType is coerced.
  const module = await import('../src/gateway/tasks').catch(() => null);
  expect(module, 'Tasks live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLiveTasksGateway('http://127.0.0.1:4098', 'test-token', async () => new Response('[]'));
  expectMethods(gateway, ['list', 'create', 'update', 'delete', 'collaborators', 'addCollaborator', 'removeCollaborator']);
  const seen = await openLive(page, 'tasks/task/task-contract');
  await expectRequest(seen, 'GET', /^\/tasks\/task-contract\/collaborators$/);
  expect(await page.getByText('Task owner', { exact: true }).count()).toBe(0);
});

test('post-m1-p3-c2d: live Rhythms exposes complete recurring-rule operations', async ({ page }) => {
  // Regression caught: Rhythms presents CRUD/steps/collaborators but never calls the authenticated rule boundary.
  const module = await import('../src/gateway/rhythms').catch(() => null);
  expect(module, 'Rhythms live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLiveRhythmsGateway('http://127.0.0.1:4098', 'test-token', async () => new Response('[]'));
  expectMethods(gateway, ['list', 'detail', 'create', 'update', 'delete', 'addStep', 'collaborators', 'addCollaborator', 'removeCollaborator']);
  const seen = await openLive(page, 'rhythms');
  await expectRequest(seen, 'GET', /^\/recurring-rules\/?$/);
});

test('post-m1-p3-c2e: live Projects exposes template, instance, step, milestone, and collaborator operations', async ({ page }) => {
  // Regression caught: Projects keeps every equivalent-looking mutation in component memory and never loads server templates/instances.
  const module = await import('../src/gateway/projects').catch(() => null);
  expect(module, 'Projects live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLiveProjectsGateway('http://127.0.0.1:4098', 'test-token', async () => new Response('[]'));
  expectMethods(gateway, ['templates', 'template', 'createTemplate', 'updateTemplate', 'deleteTemplate', 'addTemplateStep', 'updateTemplateStep', 'deleteTemplateStep', 'generateInstance', 'instances', 'createInstance', 'updateInstanceGoal', 'deleteInstance', 'updateInstanceStep', 'milestones', 'createMilestone', 'updateMilestone', 'deleteMilestone', 'collaborators', 'addCollaborator', 'removeCollaborator']);
  const seen = await openLive(page, 'projects');
  await expectRequest(seen, 'GET', /^\/project-templates\/?$/);
  await expectRequest(seen, 'GET', /^\/project-instances\/?$/);
});

test('post-m1-p3-c2f: live Messages uses numeric persisted IDs for complete thread/message operations', async ({ page }) => {
  // Regression caught: Message controls update seeded arrays while no authorized thread request reaches the gateway.
  const module = await import('../src/gateway/messages').catch(() => null);
  expect(module, 'Messages live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLiveMessagesGateway('http://127.0.0.1:4098', 'test-token', async () => new Response('[]'));
  expectMethods(gateway, ['threads', 'createThread', 'messages', 'sendMessage', 'markRead', 'markUnread']);
  const seen = await openLive(page, 'messages');
  await expectRequest(seen, 'GET', /^\/message-threads\/?$/);
});

test('production repair: live Messages uses truthful unread state and the usable two-pane interaction contract', async ({ page }) => {
  const threads = [
    { id: 41, title: 'Production handoff', threadType: 'group', taskId: null, createdBy: 1, createdAt: '2026-08-21T20:00:00.000Z', updatedAt: '2026-08-21T22:04:00.000Z', lastMessage: 'Everything is read.', unreadCount: 0, isUnread: false, participants: [{ id: 2, name: 'Morgan Lee', email: 'morgan@example.test' }] },
    { id: 42, title: 'Facilities', threadType: 'direct', taskId: null, createdBy: 2, createdAt: '2026-08-20T20:00:00.000Z', updatedAt: '2026-08-20T21:00:00.000Z', lastMessage: 'Doors are locked.', unreadCount: 0, isUnread: false, participants: [{ id: 3, name: 'Sam Rivera', email: 'sam@example.test' }] },
  ];
  const messageRequests: string[] = [];
  const handleMessages = async (route: import('@playwright/test').Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    messageRequests.push(`${method} ${url.origin}${url.pathname}`);
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cloudCors });
    if (url.pathname === '/health') return route.fulfill({ status: 200, headers: cloudCors, json: { status: 'ok' } });
    if (url.pathname === '/message-threads' && method === 'GET') return route.fulfill({ status: 200, headers: cloudCors, json: threads });
    if (url.pathname === '/users') return route.fulfill({ status: 200, headers: cloudCors, json: [] });
    if (url.pathname === '/message-threads/41/messages' && method === 'GET') return route.fulfill({ status: 200, headers: cloudCors, json: [{ id: 101, threadId: 41, senderId: 2, senderName: 'Morgan Lee', body: 'Everything is read.', createdAt: '2026-08-21T22:04:00.000Z' }] });
    if (url.pathname === '/message-threads/41/unread' && method === 'POST') { threads[0].unreadCount = 1; threads[0].isUnread = true; return route.fulfill({ status: 204, headers: cloudCors }); }
    if (url.pathname === '/message-threads/41/read' && method === 'POST') { threads[0].unreadCount = 0; threads[0].isUnread = false; return route.fulfill({ status: 204, headers: cloudCors }); }
    return route.fulfill({ status: 200, headers: cloudCors, json: responseFor(url.pathname) });
  };
  await page.route('http://127.0.0.1:4098/**', handleMessages);
  await page.route('https://api.vcrcapps.com/**', handleMessages);
  await page.route('http://127.0.0.1:4097/**', (route) => route.fulfill({ status: 200, json: { healthy: true } }));
  await page.goto('/#/messages');

  const nav = page.getByTestId('nav-messages');
  await expect(page.getByTestId('messages-unread-total')).toHaveText('0 unread threads');
  await expect(nav.locator('.unread-badge')).toHaveCount(0);
  await expect(page.getByTestId('messages-thread-search')).toBeVisible();
  expect(messageRequests, JSON.stringify(messageRequests)).toContain('GET https://api.vcrcapps.com/message-threads');
  await expect(page.getByTestId('messages-thread-41').locator('.messages-thread-avatar')).toBeVisible();
  await expect(page.getByTestId('messages-thread-41').locator('time')).toBeVisible();

  await page.getByTestId('messages-thread-search').fill('Facilities');
  await expect(page.getByTestId('messages-thread-41')).toHaveCount(0);
  await expect(page.getByTestId('messages-thread-42')).toBeVisible();
  await page.getByTestId('messages-thread-search').fill('');
  await page.getByTestId('messages-thread-actions-41').click();
  await page.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await expect(nav.locator('.unread-badge')).toHaveText('1');

  await page.getByTestId('messages-thread-41').click();
  await expect(page.getByTestId('messages-subject')).toHaveText('Production handoff');
  await expect(page.getByTestId('messages-transcript').locator('.messages-message')).toHaveCount(1);
  await expect(nav.locator('.unread-badge')).toHaveCount(0);

  threads[1].unreadCount = 2;
  threads[1].isUnread = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('messages-unread-total')).toHaveText('1 unread thread');
  await expect(nav.locator('.unread-badge')).toHaveText('1');
});

test('post-m1-p3-c2g: live Facilities exposes canonical CRUD, recurrence, conflicts, and automation cleanup', async ({ page }) => {
  // Regression caught: reservation UI sends view-model names or remains local instead of using snake_case request DTOs and camelCase responses.
  const module = await import('../src/gateway/facilities').catch(() => null);
  expect(module, 'Facilities live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLiveFacilitiesGateway('http://127.0.0.1:4098', 'test-token', async () => new Response('[]'));
  expectMethods(gateway, ['facilities', 'createFacility', 'updateFacility', 'deleteFacility', 'reservations', 'reservationGroups', 'facilityReservations', 'createReservation', 'updateReservation', 'deleteReservation', 'reservationSeries', 'reservationSeriesDetail', 'createReservationSeries', 'updateReservationSeries', 'deleteReservationSeries', 'previewAutomationReservations', 'deleteAutomationReservations']);
  const seen = await openLive(page, 'facilities');
  await expectRequest(seen, 'GET', /^\/facilities\/?$/);
  await expectRequest(seen, 'GET', /^\/facilities\/reservations(?:\?|$)/);
});

test('post-m1-p3-c2h: live Automations uses server catalogs and rejects every invalid fixture literal', async ({ page }) => {
  // Regression caught: Automation builder remains fixture-backed and submits auto_schedule_task or shortened provider trigger keys.
  const module = await import('../src/gateway/automations').catch(() => null);
  expect(module, 'Automations live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLiveAutomationsGateway('http://127.0.0.1:4098', 'test-token', async () => new Response('[]'));
  expectMethods(gateway, ['triggers', 'actions', 'providers', 'rules', 'detail', 'preview', 'create', 'update', 'delete', 'resync']);
  const seen = await openLive(page, 'automations');
  for (const path of [/^\/automation-catalog\/triggers$/, /^\/automation-catalog\/actions$/, /^\/automation-catalog\/providers$/, /^\/automation-rules\/?$/]) await expectRequest(seen, 'GET', path);
  expect(JSON.stringify(seen)).not.toMatch(/auto_schedule_task|pco\.volunteer_declined|google_calendar\.event_matches|gmail\.message_matches/);
});

test('post-m1-p3-c2i: live Integrations exposes authorization, sync, signals, preferences, options, and imports', async ({ page }) => {
  // Regression caught: provider cards show fixture handoffs and local preferences while no canonical account request occurs.
  const module = await import('../src/gateway/integrations').catch(() => null);
  expect(module, 'Integrations live gateway module must load').not.toBeNull();
  if (!module) return;
  const gateway = module.createLiveIntegrationsGateway('http://127.0.0.1:4098', 'test-token', async () => new Response('[]'));
  expectMethods(gateway, ['accounts', 'authorizationUrl', 'syncGoogleCalendar', 'syncGmail', 'syncPlanningCenter', 'syncAll', 'googleCalendarSettings', 'saveGoogleCalendarPreferences', 'gmailSignals', 'gmailLabels', 'planningCenterTaskPreferences', 'savePlanningCenterTaskPreferences', 'planningCenterTaskOptions', 'importTask', 'importRhythm', 'importProjectTemplate', 'addImportedProjectStep']);
  const seen = await openLive(page, 'integrations');
  await expectRequest(seen, 'GET', /^\/integrations\/accounts$/);
  expect(await page.getByText(/FIXTURE HANDOFF/i).count()).toBe(0);
});

test('post-m1-p3-c2j: operational quick actions create Secretary sessions and send the preset prompt', async ({ page }) => {
  // Regression caught: Dashboard/Planner/Tasks create fixture sessions, omit Secretary scope, or launch follow-up before persisting its task.
  const seen = await openLive(page, 'dashboard');
  await page.getByTestId('quick-action-help-finish').click();
  await expectRequest(seen, 'POST', /^\/agent-sessions$/);
  const create = seen.find((request) => request.method === 'POST' && request.path === '/agent-sessions');
  expect(create?.body).toMatchObject({ profileId: 'secretary', mcpRole: 'secretary' });
  expect(await page.getByText(/Local preview · no request sent/i).count()).toBe(0);
});
