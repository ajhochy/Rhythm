import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = resolve(__dirname, '..');
const read = (relative: string) => readFileSync(resolve(src, relative), 'utf8');
const compact = (value: string) => value.replace(/\s+/g, '');

function expectRoute(file: string, expression: RegExp): void {
  expect(read(`routes/${file}`)).toMatch(expression);
}

describe('post-M1 Phase 3 API boundary prerequisites', () => {
  it('post-m1-p3-api-c2a: dashboard, task, project-step, collaborator, and message routes exist', () => {
    // Regression caught: the renderer contract targets a route absent from the API declaration.
    expectRoute('dashboard_routes.ts', /dashboardRouter\.get\('\/summary'/);
    expectRoute('tasks_routes.ts', /tasksRouter\.(?:post|patch)\('\/(?:'|:id')/);
    expectRoute('tasks_routes.ts', /tasksRouter\.post\('\/:id\/collaborators'/);
    expectRoute('project_instances_routes.ts', /projectInstancesRouter\.patch\('\/steps\/:stepId'/);
    expectRoute('messages_routes.ts', /messagesRouter\.get\('\/'/);
  });

  it('post-m1-p3-api-c2b: weekly plan and its canonical persisted task fields exist', () => {
    expectRoute('weekly_plan_routes.ts', /weeklyPlanRouter\.get\('\/'/);
    expectRoute('weekly_plan_routes.ts', /weeklyPlanRouter\.patch\('\/tasks\/:id'/);
    const model = read('models/task.ts');
    for (const field of ['scheduledDate', 'scheduledOrder', 'locked', 'sourceType']) expect(model).toContain(`${field}:`);
  });

  it('post-m1-p3-api-c2c: task collaborator routes use numeric userId vocabulary', () => {
    expectRoute('tasks_routes.ts', /get\('\/:id\/collaborators'/);
    expectRoute('tasks_routes.ts', /post\('\/:id\/collaborators'/);
    expectRoute('tasks_routes.ts', /delete\('\/:id\/collaborators\/:userId'/);
    expect(read('models/task.ts')).toMatch(/userId: number;/);
  });

  it('post-m1-p3-api-c2d: recurring-rule CRUD, steps, collaborators, and canonical frequencies exist', () => {
    const routes = read('routes/recurring_rules_routes.ts');
    for (const fragment of [".get('/',", ".post('/',", ".patch('/:id',", ".delete('/:id',", ".post('/:id/steps',", ".get('/:id/collaborators',", ".post('/:id/collaborators',", ".delete('/:id/collaborators/:userId',"]) expect(compact(routes)).toContain(fragment);
    expect(read('models/recurring_task_rule.ts')).toMatch(/frequency: 'weekly' \| 'monthly' \| 'annual'/);
  });

  it('post-m1-p3-api-c2e: project template, instance, step, milestone, and collaborator routes exist', () => {
    const templates = read('routes/project_templates_routes.ts');
    const instances = read('routes/project_instances_routes.ts');
    for (const fragment of [".post('/',", ".patch('/:id',", ".delete('/:id',", ".post('/:id/steps',", ".patch('/:id/steps/:stepId',", ".delete('/:id/steps/:stepId',", ".post('/:id/generate',"]) expect(compact(templates)).toContain(fragment);
    for (const fragment of [".post('/',", ".patch('/:id',", ".patch('/steps/:stepId',", ".post('/:id/milestones',", ".post('/:id/collaborators',", ".delete('/:id',"]) expect(compact(instances)).toContain(fragment);
    expect(read('models/project_instance.ts')).toMatch(/assigneeId: number \| null;/);
    expect(read('models/project_instance.ts')).toMatch(/ownerId: number \| null;/);
  });

  it('post-m1-p3-api-c2f: message routes preserve numeric IDs and direct/group thread vocabulary', () => {
    const routes = read('routes/messages_routes.ts');
    for (const fragment of [".get('/',", ".post('/',", ".get('/:id/messages',", ".post('/:id/messages',", ".post('/:id/read',", ".post('/:id/unread',"]) expect(compact(routes)).toContain(fragment);
    const model = read('models/message.ts');
    expect(model).toMatch(/id: number;/);
    expect(model).toMatch(/threadType: 'direct' \| 'group'/);
    expect(model).toMatch(/participantIds: number\[\]/);
  });

  it('post-m1-p3-api-c2g: facility CRUD, reservation series, conflicts, and cleanup routes use canonical vocabulary', () => {
    const routes = read('routes/facilities_routes.ts');
    for (const fragment of [".get('/',", ".post('/',", ".get('/reservations',", ".post('/:id/reservations',", ".post('/:id/reservation-series',", ".patch('/:id/reservation-series/:seriesId',", ".delete('/:id/reservation-series/:seriesId',", ".get('/automation-reservations/preview',", ".delete('/automation-reservations',"]) expect(compact(routes)).toContain(fragment);
    const model = read('models/facility.ts');
    expect(model).toMatch(/recurrence_type: ReservationSeries\['recurrenceType'\]/);
    expect(model).toMatch(/recurrenceType: 'weekly' \| 'biweekly' \| 'monthly' \| 'custom'/);
    for (const field of ['facility_ids', 'requester_name', 'start_time', 'end_time']) expect(model).toContain(field);
  });

  it('post-m1-p3-api-c2h: automation catalogs/rules and exact persisted literals exist', () => {
    const catalog = read('routes/automation_catalog_routes.ts');
    const rules = read('routes/automation_rules_routes.ts');
    for (const fragment of [".get('/triggers',", ".get('/actions',", ".get('/providers',"]) expect(compact(catalog)).toContain(fragment);
    for (const fragment of [".get('/',", ".get('/:id',", ".get('/:id/preview',", ".post('/:id/resync',", ".post('/',", ".patch('/:id',", ".delete('/:id',"]) expect(compact(rules)).toContain(fragment);
    const model = read('models/automation_rule.ts');
    for (const literal of ["'auto_schedule'", "'planning_center.plan_person_declined'", "'google_calendar.event_matching_filter'", "'gmail.message_matching_filter'"]) expect(model).toContain(literal);
    expect(model).toContain('sourceAccountId');
    expect(model).not.toContain("'auto_schedule_task'");
  });

  it('post-m1-p3-api-c2i: integration auth, account, sync, signal, option, and preference routes exist', () => {
    const auth = read('routes/auth_routes.ts');
    const routes = read('routes/integrations_routes.ts');
    expect(compact(auth)).toContain(".get('/google/begin',");
    expect(compact(auth)).toContain("'/planning-center/begin',");
    for (const fragment of [".get('/accounts',", ".post('/google-calendar/sync',", ".post('/sync-all',", ".put('/google-calendar/preferences',", ".post('/gmail/sync',", ".get('/gmail/signals',", ".post('/planning-center/sync',", ".get('/planning-center/task-options',", ".put('/planning-center/task-preferences',"]) expect(compact(routes)).toContain(fragment);
    const account = read('models/integration_account.ts');
    for (const literal of ["'google_calendar'", "'gmail'", "'planning_center'"]) expect(account).toContain(literal);
  });

  it('post-m1-p3-api-c2j: Secretary quick actions have real session-create and session.input boundaries', () => {
    expectRoute('agent_sessions_routes.ts', /agentSessionsRouter\.post\('\/'/);
    const controller = read('controllers/agent_sessions_controller.ts');
    for (const field of ['profileId', 'taskId', 'mcpRole']) expect(controller).toContain(field);
    const ws = read('services/ws_gateway.ts');
    expect(ws).toContain("case 'session.input'");
    expect(ws).toContain('handleInputFrame');
  });
});
