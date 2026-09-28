import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { DashboardScreen } from '../src/screens/DashboardScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureDashboardGateway, failingDashboardGateway, emptyDashboardGateway } from './test-utils/fixtures';
import { mount, flush, actClick } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'workspace-user-1', displayName: 'AJ Hochhalter', initials: 'AH', capabilities: ['dashboard.write'] as const }, ...overrides };
}

function mountDashboard(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(DashboardScreen) }));
}

describe('DashboardScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: DashboardScreen, screenName: 'Dashboard', testId: 'rhythm-dashboard-screen', gateway: fixtureDomainGateway() });
  });

  it('renders the focus-for-the-week cards and planning grid from the injected gateway summary', async () => {
    const mounted = mountDashboard();
    await flush();
    expect(mounted.byTestId('today-progress')).toBeTruthy();
    expect(mounted.byTestId('planning-past-due')?.textContent).toContain('Review AV inventory');
    expect(mounted.byTestId('planning-handoffs')?.textContent).toContain('Riley Chen');
    expect(mounted.byTestId('project-progress')?.textContent).toContain('Weekend service');
    mounted.unmount();
  });

  it('shows the loading, then ready, state', async () => {
    const mounted = mountDashboard();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    mounted.unmount();
  });

  it('shows the empty state when the gateway has no tasks or project', async () => {
    const mounted = mountDashboard({ dashboard: emptyDashboardGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state on a forbidden gateway error', async () => {
    const mounted = mountDashboard({ dashboard: failingDashboardGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state', async () => {
    const mounted = mountDashboard({ dashboard: failingDashboardGateway('server_error') });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('toggles a task complete/reopen through the gateway', async () => {
    const dashboardGateway = fixtureDashboardGateway();
    const mounted = mountDashboard({ dashboard: dashboardGateway });
    await flush();
    await actClick(mounted.byTestId('task-toggle-task-team-briefing')!);
    await flush();
    const summary = await dashboardGateway.summary();
    expect(summary.tasks.find((task) => task.id === 'task-team-briefing')?.status).toBe('done');
    mounted.unmount();
  });

  it('opens the task inspector dialog (focus-trapped) and saves an edit through the gateway', async () => {
    const dashboardGateway = fixtureDashboardGateway();
    const mounted = mountDashboard({ dashboard: dashboardGateway });
    await flush();
    await actClick(mounted.byTestId('task-row-task-review-av-inventory')!);
    await flush();
    const dialog = mounted.byTestId('task-inspector');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    const titleInput = mounted.byTestId('task-inspector-title') as HTMLInputElement;
    titleInput.value = 'Review AV inventory (urgent)';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await actClick(mounted.byTestId('task-inspector-save')!);
    await flush();
    const summary = await dashboardGateway.summary();
    expect(summary.tasks.find((task) => task.id === 'task-review-av-inventory')?.title).toBe('Review AV inventory (urgent)');
    mounted.unmount();
  });

  it('creates a task through the create dialog and the gateway', async () => {
    const dashboardGateway = fixtureDashboardGateway();
    const mounted = mountDashboard({ dashboard: dashboardGateway });
    await flush();
    await actClick(mounted.byTestId('dashboard-header-add-task')!);
    await flush();
    const titleInput = mounted.byTestId('task-title') as HTMLInputElement;
    titleInput.value = 'Draft volunteer thank-you note';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await actClick(mounted.byTestId('task-add')!);
    await flush();
    const summary = await dashboardGateway.summary();
    expect(summary.tasks.some((task) => task.title === 'Draft volunteer thank-you note')).toBe(true);
    mounted.unmount();
  });

  it('fails closed without dashboard.write: every visible mutation control is disabled, writes stay at zero, and inspect/Ask Hermes remain available', async () => {
    const dashboardGateway = fixtureDashboardGateway();
    let writes = 0;
    const noWriteGateway = {
      ...dashboardGateway,
      createTask: async (..._args: Parameters<typeof dashboardGateway.createTask>) => { writes += 1; throw new Error('read-only host must not write'); },
      updateTask: async (..._args: Parameters<typeof dashboardGateway.updateTask>) => { writes += 1; throw new Error('read-only host must not write'); },
      updateProjectStep: async (..._args: Parameters<typeof dashboardGateway.updateProjectStep>) => { writes += 1; throw new Error('read-only host must not write'); },
    };
    let followUp: unknown = null;
    const mounted = mountDashboard({ dashboard: noWriteGateway }, { currentUser: { id: 'workspace-user-1', displayName: 'AJ Hochhalter', initials: 'AH' }, onRequestFollowUp: (context: unknown) => { followUp = context; } });
    await flush();

    for (const testId of ['dashboard-header-add-task', 'task-toggle-task-team-briefing', 'task-toggle-task-review-av-inventory', 'project-step-toggle-step-volunteer-check-in']) {
      expect((mounted.byTestId(testId) as HTMLButtonElement).disabled).toBe(true);
    }
    await actClick(mounted.byTestId('task-row-task-review-av-inventory')!);
    await flush();
    for (const testId of ['task-inspector-title', 'task-inspector-notes', 'task-inspector-scheduled', 'task-inspector-due', 'task-inspector-collaborator-add', 'task-inspector-save']) {
      expect((mounted.byTestId(testId) as HTMLInputElement | HTMLButtonElement).disabled).toBe(true);
    }
    await actClick(mounted.byTestId('quick-action-help-me-finish-this')!);
    expect(followUp).toMatchObject({ screen: 'dashboard' });
    const summary = await dashboardGateway.summary();
    expect(summary.tasks.find((task) => task.id === 'task-team-briefing')?.status).toBe('open');
    expect(writes).toBe(0);
    expect(mounted.byTestId('rhythm-dashboard-screen')).toBeTruthy();
    mounted.unmount();
  });

  it('asks the host to navigate to a sibling screen instead of routing itself', async () => {
    let navigated: unknown = null;
    const mounted = mountDashboard({}, { onNavigateToScreen: (screenId: string, context?: unknown) => { navigated = { screenId, context }; } });
    await flush();
    await actClick(mounted.byTestId('open-planner')!);
    expect(navigated).toMatchObject({ screenId: 'planner' });
    mounted.unmount();
  });

  it('invites the host to handle a quick action rather than creating an agent session itself', async () => {
    let received: unknown = null;
    const mounted = mountDashboard({}, { onRequestFollowUp: (context: unknown) => { received = context; } });
    await flush();
    await actClick(mounted.byTestId('quick-action-help-me-finish-this')!);
    expect(received).toMatchObject({ screen: 'dashboard' });
    mounted.unmount();
  });
});
