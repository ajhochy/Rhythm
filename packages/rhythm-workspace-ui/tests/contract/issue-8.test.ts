import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { RhythmWorkspaceProvider } from '../../src/context';
import { defaultRhythmTokens } from '../../src/host/theme';
import { TasksScreen } from '../../src/screens/TasksScreen';
import { fixtureDomainGateway } from '../test-utils/fixtures';
import { actClick, flush, mount } from '../test-utils/mount';

describe('issue-8 acceptance contract', () => {
  it('issue-8-c4: granular host enables only confirmed completion and rescheduling', async () => {
    // Regression guard: a Hermes host must never regain broad task mutation via tasks.write.
    const gateway = fixtureDomainGateway();
    const host = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { displayName: 'Hermes', initials: 'H', capabilities: ['tasks.complete', 'tasks.reschedule'] as const } };
    const rendered = mount(createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(TasksScreen) }));
    await flush();
    expect((rendered.byTestId('tasks-header-add-task') as HTMLButtonElement).disabled).toBe(true);
    expect(rendered.byTestId('task-reschedule-t1')).toBeTruthy();
    await actClick(rendered.byTestId('task-complete-t1')!);
    await flush();
    expect(rendered.byTestId('task-operation-confirmation')).toBeTruthy();
    rendered.unmount();
  });
});
