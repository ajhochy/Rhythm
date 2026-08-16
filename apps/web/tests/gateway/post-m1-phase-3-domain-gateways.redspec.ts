import { expect, test } from '@playwright/test';
import { createFixtureDashboardGateway, createLiveDashboardGateway } from '../../src/gateway/dashboard';
import { createFixturePlannerGateway, createLivePlannerGateway } from '../../src/gateway/planner';
import { createFixtureRhythmsGateway, createLiveRhythmsGateway } from '../../src/gateway/rhythms';
import { createFixtureProjectsGateway, createLiveProjectsGateway } from '../../src/gateway/projects';
import { createFixtureMessagesGateway, createLiveMessagesGateway } from '../../src/gateway/messages';
import { createFixtureFacilitiesGateway, createLiveFacilitiesGateway } from '../../src/gateway/facilities';
import { createFixtureAutomationsGateway, createLiveAutomationsGateway } from '../../src/gateway/automations';
import { createFixtureIntegrationsGateway, createLiveIntegrationsGateway } from '../../src/gateway/integrations';

const apiBase = 'http://127.0.0.1:4098';
const token = 'phase-3-redaction-canary-secret';

type SeenRequest = { url: string; method: string; authorization: string | null; body: unknown };

function jsonFetch(responses: unknown[], seen: SeenRequest[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const value = responses.shift();
    return new Response(value === undefined ? null : JSON.stringify(value), {
      status: value === undefined ? 204 : 200,
      headers: value === undefined ? undefined : { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test('post-m1-p3-gateway-dashboard: canonical summary and cross-domain mutations use declared routes', async () => {
  const seen: SeenRequest[] = [];
  const summary = { tasks: { openCount: 2 }, rhythms: { activeCount: 1 }, projects: { activeCount: 1 }, goals: { activeCount: 0 }, messages: { threadCount: 1 } };
  const gateway = createLiveDashboardGateway(apiBase, token, jsonFetch([summary, { id: 'step-1', status: 'done' }, [{ userId: 7, name: 'Ada', photoUrl: null }], [{ id: 4, threadType: 'direct' }]], seen));

  await expect(gateway.summary()).resolves.toEqual(summary);
  await gateway.updateProjectStep('step-1', { status: 'done', scheduledDate: '2026-08-17' });
  await gateway.addTaskCollaborator('task-1', 7);
  await gateway.messageThreads('task-1');

  expect(seen).toEqual([
    { url: `${apiBase}/dashboard/summary`, method: 'GET', authorization: `Bearer ${token}`, body: undefined },
    { url: `${apiBase}/project-instances/steps/step-1`, method: 'PATCH', authorization: `Bearer ${token}`, body: { status: 'done', scheduledDate: '2026-08-17' } },
    { url: `${apiBase}/tasks/task-1/collaborators`, method: 'POST', authorization: `Bearer ${token}`, body: { userId: 7 } },
    { url: `${apiBase}/message-threads?task_id=task-1`, method: 'GET', authorization: `Bearer ${token}`, body: undefined },
  ]);
});

test('post-m1-p3-gateway-planner: canonical week, scheduling, and source-owned step shapes are preserved', async () => {
  const seen: SeenRequest[] = [];
  const plan = { weekLabel: '2026-W34', weekStart: '2026-08-17', days: [], backlog: [{ id: 'shadow-1', sourceType: 'calendar_shadow_event', scheduledOrder: null, locked: true }] };
  const gateway = createLivePlannerGateway(apiBase, token, jsonFetch([plan, { id: 'task-1', scheduledDate: '2026-08-18', locked: true }, { id: 'task-1', scheduledOrder: 3 }, { id: 'step-1', scheduledDate: '2026-08-19' }], seen));

  await expect(gateway.plan('2026-W34')).resolves.toEqual(plan);
  await gateway.scheduleTask('task-1', { scheduledDate: '2026-08-18', locked: true });
  await gateway.updateTask('task-1', { scheduledOrder: 3 });
  await gateway.updateProjectStep('step-1', { scheduledDate: '2026-08-19' });

  expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
    { url: `${apiBase}/weekly-plan?week=2026-W34`, method: 'GET', body: undefined },
    { url: `${apiBase}/weekly-plan/tasks/task-1`, method: 'PATCH', body: { scheduledDate: '2026-08-18', locked: true } },
    { url: `${apiBase}/tasks/task-1`, method: 'PATCH', body: { scheduledOrder: 3 } },
    { url: `${apiBase}/project-instances/steps/step-1`, method: 'PATCH', body: { scheduledDate: '2026-08-19' } },
  ]);
});

test('post-m1-p3-gateway-rhythms: canonical frequencies, steps, and numeric collaborators round-trip', async () => {
  const seen: SeenRequest[] = [];
  const rule = { id: 'rule-1', title: 'Annual review', frequency: 'annual', dayOfWeek: null, dayOfMonth: 15, month: 8, enabled: true, sequential: true, ownerId: 3, steps: [], collaborators: [], createdAt: '2026-08-15T00:00:00Z' };
  const gateway = createLiveRhythmsGateway(apiBase, token, jsonFetch([rule, { id: 'step-1', title: 'Draft', assigneeId: 7 }, [{ userId: 7, name: 'Ada' }]], seen));

  await expect(gateway.create({ title: 'Annual review', frequency: 'annual', dayOfMonth: 15, month: 8, sequential: true })).resolves.toEqual(rule);
  await gateway.addStep('rule-1', { title: 'Draft', assigneeId: 7, dayOfMonth: 15, month: 8 });
  await gateway.addCollaborator('rule-1', 7);

  expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
    { url: `${apiBase}/recurring-rules`, method: 'POST', body: { title: 'Annual review', frequency: 'annual', dayOfMonth: 15, month: 8, sequential: true } },
    { url: `${apiBase}/recurring-rules/rule-1/steps`, method: 'POST', body: { title: 'Draft', assigneeId: 7, dayOfMonth: 15, month: 8 } },
    { url: `${apiBase}/recurring-rules/rule-1/collaborators`, method: 'POST', body: { userId: 7 } },
  ]);
});

test('post-m1-p3-gateway-projects: template, instance, milestone, and collaborator vocabulary stays canonical', async () => {
  const seen: SeenRequest[] = [];
  const template = { id: 'tpl-1', name: 'Launch', description: null, anchorType: 'date', ownerId: 3, createdAt: '2026-08-15T00:00:00Z', steps: [] };
  const gateway = createLiveProjectsGateway(apiBase, token, jsonFetch([template, { id: 'step-1', templateId: 'tpl-1', offsetDays: -7, sortOrder: 0, assigneeId: 7 }, { id: 'instance-1', templateId: 'tpl-1', anchorDate: '2026-09-01' }, { id: 'milestone-1', instanceId: 'instance-1', sortOrder: 1 }, [{ userId: 7, name: 'Ada' }]], seen));

  await gateway.createTemplate({ name: 'Launch', description: null, anchorType: 'date', ownerId: 3 });
  await gateway.addTemplateStep('tpl-1', { title: 'Prepare', offsetDays: -7, offsetDescription: null, sortOrder: 0, assigneeId: 7 });
  await gateway.generateInstance('tpl-1', { anchorDate: '2026-09-01', name: 'Fall launch', goalId: null });
  await gateway.createMilestone('instance-1', { title: 'Ready', dueDate: '2026-08-28', color: '#112233', sortOrder: 1 });
  await gateway.addCollaborator('instance-1', 7);

  expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
    { url: `${apiBase}/project-templates`, method: 'POST', body: { name: 'Launch', description: null, anchorType: 'date', ownerId: 3 } },
    { url: `${apiBase}/project-templates/tpl-1/steps`, method: 'POST', body: { title: 'Prepare', offsetDays: -7, offsetDescription: null, sortOrder: 0, assigneeId: 7 } },
    { url: `${apiBase}/project-templates/tpl-1/generate`, method: 'POST', body: { anchorDate: '2026-09-01', name: 'Fall launch', goalId: null } },
    { url: `${apiBase}/project-instances/instance-1/milestones`, method: 'POST', body: { title: 'Ready', dueDate: '2026-08-28', color: '#112233', sortOrder: 1 } },
    { url: `${apiBase}/project-instances/instance-1/collaborators`, method: 'POST', body: { userId: 7 } },
  ]);
});

test('post-m1-p3-gateway-messages: persisted numeric IDs and direct/group request shapes are retained', async () => {
  const seen: SeenRequest[] = [];
  const thread = { id: 42, title: 'Leads', threadType: 'group', taskId: null, createdBy: 3, unreadCount: 0, isUnread: false, participants: [] };
  const gateway = createLiveMessagesGateway(apiBase, token, jsonFetch([thread, { id: 9, threadId: 42, senderId: 3, senderName: 'AJ', body: 'Ready', createdAt: '2026-08-15T00:00:00Z' }, undefined], seen));

  await expect(gateway.createThread({ participantIds: [7, 8], threadType: 'group', title: 'Leads', taskId: null })).resolves.toEqual(thread);
  await gateway.sendMessage(42, { body: 'Ready' });
  await gateway.markRead(42);

  expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
    { url: `${apiBase}/message-threads`, method: 'POST', body: { participantIds: [7, 8], threadType: 'group', title: 'Leads', taskId: null } },
    { url: `${apiBase}/message-threads/42/messages`, method: 'POST', body: { body: 'Ready' } },
    { url: `${apiBase}/message-threads/42/read`, method: 'POST', body: undefined },
  ]);
});

test('post-m1-p3-gateway-facilities: snake_case mutations and camelCase responses are not converted to fixture vocabulary', async () => {
  const seen: SeenRequest[] = [];
  const reservation = { id: 5, facilityId: 2, seriesId: null, groupId: null, requesterName: 'Ada', requesterUserId: 7, createdByUserId: 3, startTime: '2026-08-17T10:00:00Z', endTime: '2026-08-17T11:00:00Z', externalEventId: null, externalSource: null, createdByRhythm: false, isConflicted: false, conflictReason: null };
  const gateway = createLiveFacilitiesGateway(apiBase, token, jsonFetch([reservation, { series: { id: 'series-1', recurrenceType: 'biweekly' }, createdGroups: [], createdReservations: [], conflicts: [] }], seen));

  await expect(gateway.createReservation(2, { title: 'Review', facility_ids: [2, 3], requester_name: 'Ada', requester_user_id: 7, start_time: '2026-08-17T10:00:00Z', end_time: '2026-08-17T11:00:00Z' })).resolves.toEqual(reservation);
  await gateway.createReservationSeries(2, { facility_id: 2, facility_ids: [2, 3], title: 'Review', requester_name: 'Ada', recurrence_type: 'biweekly', start_time: '2026-08-17T10:00:00Z', end_time: '2026-08-17T11:00:00Z', start_date: '2026-08-17' });

  expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
    { url: `${apiBase}/facilities/2/reservations`, method: 'POST', body: { title: 'Review', facility_ids: [2, 3], requester_name: 'Ada', requester_user_id: 7, start_time: '2026-08-17T10:00:00Z', end_time: '2026-08-17T11:00:00Z' } },
    { url: `${apiBase}/facilities/2/reservation-series`, method: 'POST', body: { facility_id: 2, facility_ids: [2, 3], title: 'Review', requester_name: 'Ada', recurrence_type: 'biweekly', start_time: '2026-08-17T10:00:00Z', end_time: '2026-08-17T11:00:00Z', start_date: '2026-08-17' } },
  ]);
});

test('post-m1-p3-gateway-automations: server literals replace known-invalid React literals', async () => {
  const seen: SeenRequest[] = [];
  const triggers = [{ key: 'planning_center.plan_person_declined', source: 'planning_center' }, { key: 'google_calendar.event_matching_filter', source: 'google_calendar' }, { key: 'gmail.message_matching_filter', source: 'gmail' }];
  const gateway = createLiveAutomationsGateway(apiBase, token, jsonFetch([triggers, { id: 'rule-1', actionType: 'auto_schedule', sourceAccountId: 'acct-1' }], seen));

  await expect(gateway.triggers()).resolves.toEqual(triggers);
  await gateway.create({ name: 'Schedule declines', source: 'planning_center', triggerKey: 'planning_center.plan_person_declined', actionType: 'auto_schedule', sourceAccountId: 'acct-1', conditions: [{ field: 'team', operator: 'not_equals', value: 'Band' }] });

  expect(seen[1].body).toEqual({ name: 'Schedule declines', source: 'planning_center', triggerKey: 'planning_center.plan_person_declined', actionType: 'auto_schedule', sourceAccountId: 'acct-1', conditions: [{ field: 'team', operator: 'not_equals', value: 'Band' }] });
  expect(JSON.stringify(seen)).not.toMatch(/auto_schedule_task|pco\.volunteer_declined|event_matches|message_matches/);
});

test('post-m1-p3-gateway-integrations: provider, preference, OAuth, and import routes remain canonical', async () => {
  const seen: SeenRequest[] = [];
  const accounts = [{ id: 'acct-1', provider: 'google_calendar', status: 'connected', needsReauth: false }];
  const gateway = createLiveIntegrationsGateway(apiBase, token, jsonFetch([accounts, { selectedCalendarIds: ['cal-1'] }, { teamIds: ['team-1'], positionNames: ['Leader'] }, { id: 'task-1' }, { id: 'rule-1' }, { id: 'tpl-1' }, { id: 'step-1' }], seen));

  await expect(gateway.accounts()).resolves.toEqual(accounts);
  expect(gateway.authorizationUrl('google')).toBe(`${apiBase}/auth/google/begin?sessionToken=${encodeURIComponent(token)}`);
  expect(gateway.authorizationUrl('google_agent')).toBe(`${apiBase}/auth/google/begin?sessionToken=${encodeURIComponent(token)}&intent=agent`);
  expect(gateway.authorizationUrl('planning_center')).toBe(`${apiBase}/auth/planning-center/begin?sessionToken=${encodeURIComponent(token)}`);
  await gateway.saveGoogleCalendarPreferences({ selectedCalendarIds: ['cal-1'] });
  await gateway.savePlanningCenterTaskPreferences({ teamIds: ['team-1'], positionNames: ['Leader'] });
  await gateway.importTask({ title: 'Imported task' });
  await gateway.importRhythm({ title: 'Imported rhythm', frequency: 'weekly', dayOfWeek: 1 });
  await gateway.importProjectTemplate({ name: 'Imported project', description: null });
  await gateway.addImportedProjectStep('tpl-1', { title: 'Prepare', offsetDays: -3, sortOrder: 0, assigneeId: null });

  expect(seen.slice(1).map(({ url, method, body }) => ({ url, method, body }))).toEqual([
    { url: `${apiBase}/integrations/google-calendar/preferences`, method: 'PUT', body: { selectedCalendarIds: ['cal-1'] } },
    { url: `${apiBase}/integrations/planning-center/task-preferences`, method: 'PUT', body: { teamIds: ['team-1'], positionNames: ['Leader'] } },
    { url: `${apiBase}/tasks`, method: 'POST', body: { title: 'Imported task' } },
    { url: `${apiBase}/recurring-rules`, method: 'POST', body: { title: 'Imported rhythm', frequency: 'weekly', dayOfWeek: 1 } },
    { url: `${apiBase}/project-templates`, method: 'POST', body: { name: 'Imported project', description: null } },
    { url: `${apiBase}/project-templates/tpl-1/steps`, method: 'POST', body: { title: 'Prepare', offsetDays: -3, sortOrder: 0, assigneeId: null } },
  ]);
});

test('post-m1-p3-gateways: fixture mode makes zero live calls', async () => {
  let calls = 0;
  const forbidden = (async () => { calls += 1; throw new Error('network forbidden'); }) as typeof fetch;
  const fixtures = [
    [createFixtureDashboardGateway(forbidden), 'summary'],
    [createFixturePlannerGateway(forbidden), 'plan'],
    [createFixtureRhythmsGateway(forbidden), 'list'],
    [createFixtureProjectsGateway(forbidden), 'templates'],
    [createFixtureMessagesGateway(forbidden), 'threads'],
    [createFixtureFacilitiesGateway(forbidden), 'facilities'],
    [createFixtureAutomationsGateway(forbidden), 'rules'],
    [createFixtureIntegrationsGateway(forbidden), 'accounts'],
  ] as const;

  for (const [gateway, method] of fixtures) {
    const call = (gateway as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method];
    await expect(call('2026-W34')).rejects.toThrow(/fixture .* gateway is unsupported/i);
  }
  expect(calls).toBe(0);
});

test('post-m1-p3-gateways: live failures are bounded and redact bodies, tokens, stacks, and paths', async () => {
  const secretBody = `upstream ${token} /Users/private/secret.ts\nstack trace`;
  const failing = (async () => new Response(secretBody, { status: 500 })) as typeof fetch;
  const calls = [
    () => createLiveDashboardGateway(apiBase, token, failing).summary(),
    () => createLivePlannerGateway(apiBase, token, failing).plan('2026-W34'),
    () => createLiveRhythmsGateway(apiBase, token, failing).list(),
    () => createLiveProjectsGateway(apiBase, token, failing).templates(),
    () => createLiveMessagesGateway(apiBase, token, failing).threads(),
    () => createLiveFacilitiesGateway(apiBase, token, failing).facilities(),
    () => createLiveAutomationsGateway(apiBase, token, failing).rules(),
    () => createLiveIntegrationsGateway(apiBase, token, failing).accounts(),
  ];

  for (const call of calls) {
    const error = await call().then(() => null, (value: unknown) => value as Error & { status?: number });
    expect(error?.status).toBe(500);
    expect(error?.message).toMatch(/failed \(500\)/i);
    expect(error?.message.length).toBeLessThan(120);
    expect(error?.message).not.toContain(token);
    expect(error?.message).not.toContain(secretBody);
    expect(error?.message).not.toContain('/Users/');
    expect(error?.message.toLowerCase()).not.toContain('stack');
  }
});
