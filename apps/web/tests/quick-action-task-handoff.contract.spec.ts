import { expect, test } from '@playwright/test';
import {
  launchQuickActionSession,
  quickActionPresets,
  type QuickActionTaskContext,
} from '../src/components/quickActions';
import type { SessionGateway } from '../src/gateway/sessions';

function harness() {
  const created: Array<Record<string, unknown>> = [];
  const sent: Array<Record<string, unknown>> = [];
  const sessions = {
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      return { id: `session-${created.length}` };
    },
    connect: () => ({
      send: (frame: Record<string, unknown>) => sent.push(frame),
      close: () => undefined,
    }),
  } as unknown as SessionGateway;
  return { sessions, created, sent };
}

const authorizedWorkspace = async () => '/Users/AJ/Authorized Task Workspace';

test('all presets bind the hosted task id, retained title, authorized cwd, and exact-id read in the first turn', async () => {
  for (const preset of quickActionPresets) {
    const { sessions, created, sent } = harness();
    const task: QuickActionTaskContext = {
      id: `hosted/${preset.id} "exact"`,
      title: 'Same visible title',
    };

    await launchQuickActionSession(
      sessions,
      preset.id,
      task,
      undefined,
      authorizedWorkspace,
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      profileId: 'secretary',
      mcpRole: 'secretary',
      cwd: '/Users/AJ/Authorized Task Workspace',
      taskId: task.id,
      taskTitle: task.title,
      isolateWorktree: false,
    });
    expect(created[0]?.cwd).not.toBe('/workspace/rhythm');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      v: 1,
      type: 'session.input',
      id: 'session-1',
    });
    const prompt = String(sent[0]?.data);
    expect(prompt).toContain(preset.prompt);
    expect(prompt).toContain('rhythm_list_tasks');
    expect(prompt).toContain(JSON.stringify({ id: task.id }));
    expect(prompt).toContain('Do not change the task or any source-owned record without separate user authorization');
  }
});

test('duplicate titles never select by title or spill one task id into another session', async () => {
  const first = harness();
  const second = harness();
  const title = 'Duplicate title';

  await launchQuickActionSession(first.sessions, 'help-finish', { id: 'task-A', title }, undefined, authorizedWorkspace);
  await launchQuickActionSession(second.sessions, 'help-finish', { id: 'task-B', title }, undefined, authorizedWorkspace);

  expect(String(first.sent[0]?.data)).toContain('{"id":"task-A"}');
  expect(String(first.sent[0]?.data)).not.toContain('{"id":"task-B"}');
  expect(String(second.sent[0]?.data)).toContain('{"id":"task-B"}');
  expect(String(second.sent[0]?.data)).not.toContain('{"id":"task-A"}');
});

test('missing task or working directory fails before session creation and before the first turn', async () => {
  const missingTask = harness();
  await expect(
    launchQuickActionSession(missingTask.sessions, 'help-finish', null, undefined, authorizedWorkspace),
  ).rejects.toThrow('Select a task');
  expect(missingTask.created).toEqual([]);
  expect(missingTask.sent).toEqual([]);

  const invalidCwd = harness();
  await expect(
    launchQuickActionSession(
      invalidCwd.sessions,
      'help-finish',
      { id: 'task-1', title: 'Task' },
      undefined,
      async () => '   ',
    ),
  ).rejects.toThrow('working directory');
  expect(invalidCwd.created).toEqual([]);
  expect(invalidCwd.sent).toEqual([]);
});

test('preserves the host-validated working-directory bytes, including a trailing space', async () => {
  const { sessions, created } = harness();
  const canonicalPathWithTrailingSpace = '/Users/AJ/Authorized Task Workspace ';

  await launchQuickActionSession(
    sessions,
    'help-finish',
    { id: 'task-trailing-space', title: 'Trailing-space workspace' },
    undefined,
    async () => canonicalPathWithTrailingSpace,
  );

  expect(created[0]?.cwd).toBe(canonicalPathWithTrailingSpace);
});

test('follow-up persistence completes before the session binds the newly created task', async () => {
  const { sessions, created, sent } = harness();
  const events: string[] = [];
  const createFollowUp = async () => {
    events.push('task-created');
    return { id: 'new-follow-up', title: 'New follow-up' };
  };

  const originalCreate = sessions.create.bind(sessions);
  sessions.create = async (input) => {
    events.push('session-created');
    return originalCreate(input);
  };

  await launchQuickActionSession(
    sessions,
    'follow-up-tasks',
    { id: 'source-task', title: 'Source task' },
    createFollowUp,
    authorizedWorkspace,
  );

  expect(events).toEqual(['task-created', 'session-created']);
  expect(created[0]).toMatchObject({ taskId: 'new-follow-up', taskTitle: 'New follow-up' });
  expect(String(sent[0]?.data)).toContain('{"id":"new-follow-up"}');
});
