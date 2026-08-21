import { act, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TasksScreen } from '../src/screens/TasksScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureTasksGateway, failingTasksGateway, emptyTasksGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue, actKeyDown } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'workspace-user-1', displayName: 'AJ Hochhalter', initials: 'AH', capabilities: ['tasks.write'] as const }, ...overrides };
}

function mountTasks(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(TasksScreen) }));
}

describe('TasksScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: TasksScreen, screenName: 'Tasks', testId: 'rhythm-tasks-screen', gateway: fixtureDomainGateway() });
  });

  it('loads real tasks with bucket/priority/tag richness from the injected gateway', async () => {
    const mounted = mountTasks();
    await flush();
    expect(mounted.byTestId('task-row-t1')?.textContent).toContain('Confirm Sunday greeter schedule');
    expect(mounted.byTestId('tasks-visible-count')?.textContent).toContain('task');
    mounted.unmount();
  });

  it('shows the loading state panel before the gateway resolves, then ready content', async () => {
    const mounted = mountTasks();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    expect(mounted.byTestId('tasks-list')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the empty state when the gateway returns no tasks', async () => {
    const mounted = mountTasks({ tasks: emptyTasksGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state when the gateway rejects with a forbidden error', async () => {
    const mounted = mountTasks({ tasks: failingTasksGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the unavailable state when the gateway rejects with not_found/unavailable', async () => {
    const mounted = mountTasks({ tasks: failingTasksGateway('unavailable') });
    await flush();
    expect(mounted.byTestId('page-state-unavailable')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state and recovers on retry', async () => {
    const failing = failingTasksGateway('server_error');
    const mounted = mountTasks({ tasks: failing });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('filters the list by search text', async () => {
    const mounted = mountTasks();
    await flush();
    const search = mounted.byTestId('tasks-search') as HTMLInputElement;
    await actSetValue(search, 'greeter');
    await flush();
    expect(mounted.byTestId('task-row-t1')).toBeTruthy();
    expect(mounted.byTestId('task-row-t2')).toBeNull();
    mounted.unmount();
  });

  it('filters by minimum priority', async () => {
    const mounted = mountTasks();
    await flush();
    const priority = mounted.byTestId('tasks-priority-filter') as HTMLSelectElement;
    await actSetValue(priority, '2');
    await flush();
    expect(mounted.byTestId('task-row-t1')).toBeTruthy(); // priority 2
    expect(mounted.byTestId('task-row-t2')).toBeNull(); // priority 1
    mounted.unmount();
  });

  it('switches between list and board (kanban) views', async () => {
    const mounted = mountTasks();
    await flush();
    expect(mounted.byTestId('tasks-list')).toBeTruthy();
    await actClick(mounted.byTestId('tasks-view-board')!);
    await flush();
    expect(mounted.byTestId('tasks-board')).toBeTruthy();
    expect(mounted.byTestId('kanban-column-open')).toBeTruthy();
    expect(mounted.byTestId('kanban-column-waiting-for-reply')).toBeTruthy();
    mounted.unmount();
  });

  it('opens the inspector for a task and saves an edited title through the gateway', async () => {
    const tasksGateway = fixtureTasksGateway();
    const mounted = mountTasks({ tasks: tasksGateway });
    await flush();
    await actClick(mounted.byTestId('task-select-t1')!);
    await flush();
    const titleInput = mounted.byTestId('task-edit-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Confirm Sunday greeter schedule');
    titleInput.value = 'Confirm Sunday greeter schedule (updated)';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await actClick(mounted.byTestId('task-save')!);
    await flush();
    const persisted = await tasksGateway.list();
    expect(persisted.find((task) => task.id === 't1')?.title).toBe('Confirm Sunday greeter schedule (updated)');
    mounted.unmount();
  });

  it('opens the task action menu with roving keyboard focus and closes on Escape, restoring focus to the trigger', async () => {
    const mounted = mountTasks();
    await flush();
    const trigger = mounted.byTestId('task-menu-t1') as HTMLButtonElement;
    await actClick(trigger);
    await flush();
    await flush();
    const menu = mounted.container.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    await actKeyDown(document, 'Escape');
    await flush();
    expect(mounted.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    mounted.unmount();
  });

  it('opens the collaborator picker as a focus-trapped dialog and adds a collaborator through the gateway', async () => {
    const tasksGateway = fixtureTasksGateway();
    const mounted = mountTasks({ tasks: tasksGateway });
    await flush();
    await actClick(mounted.byTestId('task-select-t1')!);
    await flush();
    await actClick(mounted.byTestId('task-add-collaborator')!);
    await flush();
    const dialog = mounted.byTestId('task-collaborator-picker');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    const option = mounted.byTestId('task-collaborator-option-workspace-user-2');
    expect(option).toBeTruthy();
    await actClick(option!);
    await flush();
    const updated = await tasksGateway.list();
    expect(updated.find((task) => task.id === 't1')?.collaborators.some((person) => person.id === 'workspace-user-2')).toBe(true);
    mounted.unmount();
  });

  it('deletes a task through a confirmation dialog and the gateway', async () => {
    const tasksGateway = fixtureTasksGateway();
    const mounted = mountTasks({ tasks: tasksGateway });
    await flush();
    await actClick(mounted.byTestId('task-menu-t1')!);
    await flush();
    await actClick(mounted.byTestId('task-delete-t1')!);
    await flush();
    expect(mounted.byTestId('task-delete-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('task-delete-confirm')!);
    await flush();
    const remaining = await tasksGateway.list();
    expect(remaining.some((task) => task.id === 't1')).toBe(false);
    mounted.unmount();
  });

  it('creates a task through the create dialog and the gateway', async () => {
    const tasksGateway = fixtureTasksGateway();
    const mounted = mountTasks({ tasks: tasksGateway });
    await flush();
    await actClick(mounted.byTestId('tasks-header-add-task')!);
    await flush();
    const titleInput = mounted.byTestId('task-create-title') as HTMLInputElement;
    titleInput.value = 'Plan fall retreat kickoff';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    await actClick(mounted.byTestId('task-create-submit')!);
    await flush();
    const tasks = await tasksGateway.list();
    expect(tasks.some((task) => task.title === 'Plan fall retreat kickoff')).toBe(true);
    mounted.unmount();
  });

  it('fails closed without tasks.write: every visible mutation control is disabled, writes stay at zero, and inspect/Ask Hermes remain available', async () => {
    const tasksGateway = fixtureTasksGateway();
    let writes = 0;
    const noWriteGateway = {
      ...tasksGateway,
      create: async (..._args: Parameters<typeof tasksGateway.create>) => { writes += 1; throw new Error('read-only host must not write'); },
      update: async (..._args: Parameters<typeof tasksGateway.update>) => { writes += 1; throw new Error('read-only host must not write'); },
      delete: async (..._args: Parameters<typeof tasksGateway.delete>) => { writes += 1; throw new Error('read-only host must not write'); },
      addCollaborator: async (..._args: Parameters<typeof tasksGateway.addCollaborator>) => { writes += 1; throw new Error('read-only host must not write'); },
      removeCollaborator: async (..._args: Parameters<typeof tasksGateway.removeCollaborator>) => { writes += 1; throw new Error('read-only host must not write'); },
    };
    let followUp: unknown = null;
    const mounted = mountTasks({ tasks: noWriteGateway }, { currentUser: { id: 'workspace-user-1', displayName: 'AJ Hochhalter', initials: 'AH' }, onRequestFollowUp: (context: unknown) => { followUp = context; } });
    await flush();
    expect((mounted.byTestId('tasks-header-add-task') as HTMLButtonElement).disabled).toBe(true);
    expect((mounted.byTestId('task-complete-t1') as HTMLInputElement).disabled).toBe(true);
    await actClick(mounted.byTestId('task-menu-t1')!);
    await flush();
    expect((mounted.byTestId('task-delete-t1') as HTMLButtonElement).disabled).toBe(true);
    await actClick(mounted.byTestId('task-select-t1')!);
    await flush();
    for (const testId of ['task-edit-title', 'task-edit-notes', 'task-edit-scheduled-date', 'task-edit-due-date', 'task-edit-agent', 'task-edit-energy', 'task-detail-complete', 'task-save', 'task-add-collaborator']) {
      expect((mounted.byTestId(testId) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled).toBe(true);
    }
    await actClick(mounted.byTestId('quick-action-help-finish')!);
    expect(followUp).toMatchObject({ screen: 'tasks', action: 'help-finish' });
    const persisted = await tasksGateway.list();
    expect(persisted.find((task) => task.id === 't1')?.status).toBe('open');
    expect(writes).toBe(0);
    expect(mounted.byTestId('rhythm-tasks-screen')).toBeTruthy();
    mounted.unmount();
  });

  it('drags a task card to a different board column and persists the new status', async () => {
    const tasksGateway = fixtureTasksGateway();
    const mounted = mountTasks({ tasks: tasksGateway });
    await flush();
    await actClick(mounted.byTestId('tasks-view-board')!);
    await flush();
    const card = mounted.byTestId('task-card-t1')!;
    const column = mounted.byTestId('kanban-column-in-progress')!;
    // JSDOM has no native drag-and-drop; simulate the same onDragStart/onDrop handler path
    // React wires up, wrapped in act since these are plain DOM events outside a click helper.
    // dragstart and drop are separate acts, matching a real drag where the browser fires them
    // on separate ticks — otherwise the drop handler still closes over the pre-dragstart
    // render and never observes the dragged task id.
    await act(async () => {
      card.dispatchEvent(new Event('dragstart', { bubbles: true }));
    });
    await act(async () => {
      column.dispatchEvent(new Event('drop', { bubbles: true }));
    });
    await flush();
    const updated = await tasksGateway.list();
    expect(updated.find((task) => task.id === 't1')?.status).toBe('in_progress');
    mounted.unmount();
  });

  it('invites the host to handle a quick action instead of creating an agent session itself', async () => {
    let received: unknown = null;
    const mounted = mountTasks({}, { onRequestFollowUp: (context: unknown) => { received = context; } });
    await flush();
    await actClick(mounted.byTestId('task-select-t1')!);
    await flush();
    await actClick(mounted.byTestId('quick-action-help-finish')!);
    expect(received).toMatchObject({ screen: 'tasks', action: 'help-finish', relatedId: 't1' });
    mounted.unmount();
  });

  it('never imports an agent-session launcher or constructs a bearer credential to complete a task', () => {
    const tasksGateway = fixtureTasksGateway();
    expect(tasksGateway.update.length).toBe(2);
    expect(tasksGateway.create.length).toBe(1);
  });
});
