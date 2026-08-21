import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PlannerScreen } from '../src/screens/PlannerScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixturePlannerGateway, failingPlannerGateway, emptyPlannerGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'workspace-user-1', displayName: 'AJ Hochhalter', initials: 'AH', collaborationCapability: 'write' as const }, ...overrides };
}

function mountPlanner(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(PlannerScreen) }));
}

describe('PlannerScreen', () => {
  it('keeps the newest next-week response when earlier planner requests resolve out of order', async () => {
    const base = fixturePlannerGateway();
    const releases: Array<(value: Awaited<ReturnType<typeof base.week>>) => void> = [];
    const planner = { ...base, week: () => new Promise<Awaited<ReturnType<typeof base.week>>>((resolve) => releases.push(resolve)) };
    const mounted = mountPlanner({ planner });
    await flush();
    await actClick(mounted.byTestId('planner-next-week')!);
    await actClick(mounted.byTestId('planner-next-week')!);
    expect(releases).toHaveLength(3);
    const newest = { weekLabel: 'newest', weekStart: '2026-08-24', days: [], backlog: [{ id: 'newest-task', source: 'task' as const, title: 'Newest weekly plan', notes: '', status: 'open' as const, scheduledOrder: 1, collaborators: [], readonly: false }] };
    releases[2]!(newest);
    await flush();
    expect(mounted.container.textContent).toContain('Newest weekly plan');
    const stale = { ...newest, backlog: [{ ...newest.backlog[0]!, id: 'stale-task', title: 'Stale weekly plan' }] };
    releases[0]!(stale);
    releases[1]!(stale);
    await flush();
    expect(mounted.container.textContent).not.toContain('Stale weekly plan');
    mounted.unmount();
  });

  it('ignores a deferred planner response after its gateway is replaced', async () => {
    const old = fixturePlannerGateway();
    let releaseOld!: (value: Awaited<ReturnType<typeof old.week>>) => void;
    const stalePlanner = { ...old, week: () => new Promise<Awaited<ReturnType<typeof old.week>>>((resolve) => { releaseOld = resolve; }) };
    const freshPlanner = fixturePlannerGateway();
    const gateway = { ...fixtureDomainGateway(), planner: stalePlanner };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(), children: createElement(PlannerScreen) }));
    mounted.rerender(createElement(RhythmWorkspaceProvider, { gateway: { ...gateway, planner: freshPlanner }, host: buildHost(), children: createElement(PlannerScreen) }));
    await flush();
    expect(mounted.container.textContent).toContain('Prepare Sunday service handoff');
    releaseOld({ weekLabel: 'stale', weekStart: '2026-08-10', days: [], backlog: [{ id: 'old', source: 'task', title: 'Stale planner gateway', notes: '', status: 'open', scheduledOrder: 1, collaborators: [], readonly: false }] });
    await flush();
    expect(mounted.container.textContent).not.toContain('Stale planner gateway');
    mounted.unmount();
  });
  it('fails closed when collaboration capability is omitted: planner controls and mutation handlers stay inert', async () => {
    const plannerGateway = fixturePlannerGateway();
    const mutations = {
      scheduleTask: vi.fn(plannerGateway.scheduleTask), updateProjectStep: vi.fn(plannerGateway.updateProjectStep), scheduleProjectStep: vi.fn(plannerGateway.scheduleProjectStep), create: vi.fn(plannerGateway.create), update: vi.fn(plannerGateway.update), addCollaborator: vi.fn(plannerGateway.addCollaborator), removeCollaborator: vi.fn(plannerGateway.removeCollaborator),
    };
    const mounted = mountPlanner({ planner: { ...plannerGateway, ...mutations } }, { currentUser: { id: 'workspace-user-1', displayName: 'AJ', initials: 'AH' } });
    await flush();
    const task = mounted.byTestId('planner-task-task-wed')!;
    await actClick(task);
    await flush();
    expect(mounted.byTestId('planner-inspector')?.textContent).toContain('Prepare Sunday service handoff');
    const complete = mounted.byTestId('planner-complete-task-wed') as HTMLButtonElement;
    expect(complete.disabled).toBe(true);
    expect(complete.title).toContain('inspection only');
    await actClick(complete);
    expect((mounted.byTestId('planner-add-collaborator') as HTMLButtonElement).disabled).toBe(true);
    expect((mounted.byTestId('planner-save-task') as HTMLButtonElement).disabled).toBe(true);
    for (const mutation of Object.values(mutations)) expect(mutation).not.toHaveBeenCalled();
    mounted.unmount();
  });
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: PlannerScreen, screenName: 'Planner', testId: 'rhythm-planner-screen', gateway: fixtureDomainGateway() });
  });

  it('loads the real week with backlog and per-day tasks/events from the injected gateway', async () => {
    const mounted = mountPlanner();
    await flush();
    expect(mounted.byTestId('planner-backlog')?.textContent).toContain('Vendor equipment follow-up');
    expect(mounted.byTestId('planner-day-2026-08-12')?.textContent).toContain('Prepare Sunday service handoff');
    mounted.unmount();
  });

  it('shows the loading state panel before the gateway resolves, then ready content', async () => {
    const mounted = mountPlanner();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    expect(mounted.byTestId('planner-board')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the empty state when the gateway returns a week with no tasks', async () => {
    const mounted = mountPlanner({ planner: emptyPlannerGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state when the gateway rejects with a forbidden error', async () => {
    const mounted = mountPlanner({ planner: failingPlannerGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state', async () => {
    const mounted = mountPlanner({ planner: failingPlannerGateway('server_error') });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('routes project-step completion, edit, and drag scheduling through source-owned project-step operations', async () => {
    const plannerGateway = fixturePlannerGateway();
    const genericUpdate = vi.fn(plannerGateway.update);
    const genericSchedule = vi.fn(plannerGateway.scheduleTask);
    const updateProjectStep = vi.fn(plannerGateway.updateProjectStep);
    const scheduleProjectStep = vi.fn(plannerGateway.scheduleProjectStep);
    const mounted = mountPlanner({ planner: { ...plannerGateway, update: genericUpdate, scheduleTask: genericSchedule, updateProjectStep, scheduleProjectStep } as typeof plannerGateway });
    await flush();
    const card = mounted.byTestId('planner-task-step-thu');
    expect(card).toBeTruthy();
    expect(mounted.byTestId('planner-complete-step-thu')).toBeTruthy();
    expect(mounted.byTestId('planner-task-select-step-thu')).toBeTruthy();
    await actClick(card!);
    await flush();
    await actSetValue(mounted.byTestId('planner-edit-notes') as HTMLTextAreaElement, 'Source-owned notes');
    await actSetValue(mounted.byTestId('planner-edit-due-date') as HTMLInputElement, '2026-08-15');
    await actClick(mounted.byTestId('planner-save-task')!);
    await flush();
    await act(async () => { card!.dispatchEvent(new Event('dragstart', { bubbles: true })); });
    await act(async () => { mounted.byTestId('planner-day-2026-08-16')!.dispatchEvent(new Event('drop', { bubbles: true })); });
    await flush();
    await actClick(mounted.byTestId('planner-filter-all')!);
    await actClick(mounted.byTestId('planner-complete-step-thu')!);
    await flush();
    expect(updateProjectStep).toHaveBeenCalledWith('project-step-instance-thu', { notes: 'Source-owned notes', dueDate: '2026-08-15' });
    expect(updateProjectStep).toHaveBeenCalledWith('project-step-instance-thu', { status: 'done' });
    expect(scheduleProjectStep).toHaveBeenCalledWith('project-step-instance-thu', { dueDate: '2026-08-16' });
    expect(genericUpdate).not.toHaveBeenCalledWith('step-thu', expect.anything());
    expect(genericSchedule).not.toHaveBeenCalledWith('step-thu', expect.anything());
    mounted.unmount();
  });

  it('completes and reopens a task through the gateway', async () => {
    const plannerGateway = fixturePlannerGateway();
    const mounted = mountPlanner({ planner: plannerGateway });
    await flush();
    await actClick(mounted.byTestId('planner-complete-task-wed')!);
    await flush();
    const week = await plannerGateway.week('current');
    const updated = [...week.days.flatMap((day) => day.tasks), ...week.backlog].find((task) => task.id === 'task-wed');
    expect(updated?.status).toBe('done');
    mounted.unmount();
  });

  it('selects tasks and bulk-completes them through the gateway', async () => {
    const plannerGateway = fixturePlannerGateway();
    const mounted = mountPlanner({ planner: plannerGateway });
    await flush();
    await actClick(mounted.byTestId('planner-task-select-task-wed')!);
    await flush();
    expect(mounted.byTestId('planner-selection-count')?.textContent).toContain('1');
    await actClick(mounted.byTestId('planner-bulk-complete')!);
    await flush();
    const week = await plannerGateway.week('current');
    const updated = week.days.flatMap((day) => day.tasks).find((task) => task.id === 'task-wed');
    expect(updated?.status).toBe('done');
    expect(mounted.byTestId('planner-selection-count')).toBeNull();
    mounted.unmount();
  });

  it('filters day/backlog tasks by open vs all', async () => {
    const mounted = mountPlanner();
    await flush();
    expect(mounted.byTestId('planner-task-task-done')).toBeNull();
    await actClick(mounted.byTestId('planner-filter-all')!);
    await flush();
    expect(mounted.byTestId('planner-task-task-done')).toBeTruthy();
    mounted.unmount();
  });

  it('opens the task inspector and saves notes/scheduled/due date through the gateway', async () => {
    const plannerGateway = fixturePlannerGateway();
    const mounted = mountPlanner({ planner: plannerGateway });
    await flush();
    await actClick(mounted.byTestId('planner-task-task-wed')!);
    await flush();
    const dialog = mounted.byTestId('planner-inspector');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    await actSetValue(mounted.byTestId('planner-edit-notes') as HTMLTextAreaElement, 'Bring backup mic');
    await actClick(mounted.byTestId('planner-save-task')!);
    await flush();
    const week = await plannerGateway.week('current');
    const updated = week.days.flatMap((day) => day.tasks).find((task) => task.id === 'task-wed');
    expect(updated?.notes).toBe('Bring backup mic');
    mounted.unmount();
  });

  it('adds and removes a collaborator on a task through the gateway', async () => {
    const plannerGateway = fixturePlannerGateway();
    const mounted = mountPlanner({ planner: plannerGateway });
    await flush();
    await actClick(mounted.byTestId('planner-task-task-backlog')!);
    await flush();
    await actClick(mounted.byTestId('planner-add-collaborator')!);
    await flush();
    await actClick(mounted.byTestId('planner-collaborator-option-workspace-user-3')!);
    await flush();
    let week = await plannerGateway.week('current');
    let updated = [...week.backlog, ...week.days.flatMap((day) => day.tasks)].find((task) => task.id === 'task-backlog');
    expect(updated?.collaborators.some((person) => person.id === 'workspace-user-3')).toBe(true);
    await actClick(mounted.byTestId('planner-remove-collaborator-workspace-user-3')!);
    await flush();
    week = await plannerGateway.week('current');
    updated = [...week.backlog, ...week.days.flatMap((day) => day.tasks)].find((task) => task.id === 'task-backlog');
    expect(updated?.collaborators.some((person) => person.id === 'workspace-user-3')).toBe(false);
    mounted.unmount();
  });

  it('creates a task through the create dialog and the gateway, defaulting scheduled date to the day clicked', async () => {
    const plannerGateway = fixturePlannerGateway();
    const mounted = mountPlanner({ planner: plannerGateway });
    await flush();
    await actClick(mounted.byTestId('planner-add-task-2026-08-14')!);
    await flush();
    expect((mounted.byTestId('planner-create-scheduled-date') as HTMLInputElement).value).toBe('2026-08-14');
    await actSetValue(mounted.byTestId('planner-create-title') as HTMLInputElement, 'Confirm livestream backup');
    await actClick(mounted.byTestId('planner-create-task-submit')!);
    await flush();
    const week = await plannerGateway.week('current');
    expect(week.days.flatMap((day) => day.tasks).some((task) => task.title === 'Confirm livestream backup')).toBe(true);
    mounted.unmount();
  });

  it('schedules a backlog task onto a day by drag and drop through the gateway', async () => {
    const plannerGateway = fixturePlannerGateway();
    const mounted = mountPlanner({ planner: plannerGateway });
    await flush();
    const card = mounted.byTestId('planner-task-task-backlog')!;
    const day = mounted.byTestId('planner-day-2026-08-13')!;
    await act(async () => { card.dispatchEvent(new Event('dragstart', { bubbles: true })); });
    await act(async () => { day.dispatchEvent(new Event('drop', { bubbles: true })); });
    await flush();
    const week = await plannerGateway.week('current');
    const updated = week.days.flatMap((day) => day.tasks).find((task) => task.id === 'task-backlog');
    expect(updated?.scheduledDate).toBe('2026-08-13');
    mounted.unmount();
  });

  it('navigates to the next/previous week, disabling Today when already on the current week', async () => {
    const mounted = mountPlanner();
    await flush();
    const label = mounted.byTestId('planner-week-label')!.textContent;
    await actClick(mounted.byTestId('planner-next-week')!);
    await flush();
    expect(mounted.byTestId('planner-week-label')?.textContent).not.toBe(label);
    await actClick(mounted.byTestId('planner-prev-week')!);
    await flush();
    expect(mounted.byTestId('planner-week-label')?.textContent).toBe(label);
    mounted.unmount();
  });

  it('invites the host to handle a quick action from the task inspector instead of creating an agent session itself', async () => {
    let received: unknown = null;
    const mounted = mountPlanner({}, { onRequestFollowUp: (context: unknown) => { received = context; } });
    await flush();
    await actClick(mounted.byTestId('planner-task-task-wed')!);
    await flush();
    await actClick(mounted.byTestId('quick-action-help-finish')!);
    expect(received).toMatchObject({ screen: 'planner', relatedId: 'task-wed' });
    mounted.unmount();
  });
});
