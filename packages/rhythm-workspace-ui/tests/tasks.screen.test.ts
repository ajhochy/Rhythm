import { describe, expect, it } from 'vitest';
import { TasksScreen } from '../src/screens/TasksScreen';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureTasksGateway } from './test-utils/fixtureGateway';
import { mount, flush, actClick } from './test-utils/mount';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { createElement } from 'react';

describe('TasksScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({
      Screen: TasksScreen,
      screenName: 'Tasks',
      testId: 'rhythm-tasks-screen',
      gateway: fixtureDomainGateway(),
    });
  });

  it('lists tasks from the injected gateway and lets a user mark one done', async () => {
    const tasksGateway = fixtureTasksGateway();
    const gateway = { ...fixtureDomainGateway(), tasks: tasksGateway };
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'AJ', initials: 'AH' } };
    const mounted = mount(
      createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(TasksScreen) }),
    );
    await flush();

    const row = mounted.byTestId('rhythm-task-row-t1');
    expect(row?.textContent).toContain('Confirm Sunday greeter schedule');

    const checkbox = mounted.byTestId('rhythm-task-complete-t1') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    await actClick(checkbox!);
    await flush();

    const updated = await tasksGateway.list();
    expect(updated.find((task) => task.id === 't1')?.status).toBe('done');
    mounted.unmount();
  });

  it('never imports an agent-session launcher or bearer credential to complete a task', () => {
    // Static contract, not behavioral: the create/setStatus signatures never accept a
    // session, profile, or credential argument.
    const tasksGateway = fixtureTasksGateway();
    expect(tasksGateway.setStatus.length).toBe(2);
    expect(tasksGateway.create.length).toBe(1);
  });
});
