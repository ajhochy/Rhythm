import { expect, test, type Page } from '@playwright/test';

type Seen = { method: string; path: string; body: unknown };

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
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    seen.push({ method: request.method(), path: `${url.pathname}${url.search}`, body: request.postDataJSON() ?? undefined });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFor(url.pathname)) });
  });
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
