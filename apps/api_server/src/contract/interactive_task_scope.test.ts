import { describe, expect, it, vi } from 'vitest';

import {
  INTERACTIVE_TASK_PERMISSION,
  OpencodeClientService,
  isInteractiveChatSession,
} from '../services/opencode_client_service';

// AJ 2026-09-29: interactive chats must reach named Rhythm profiles only via
// rhythm_delegate_async; `task` stays for explore/general. Headless unchanged.
// The fork evaluates agent rules then session rules with findLast, so the task
// rules must be the LAST entries on the session ruleset.

const TASK_RULES = [
  { permission: 'task', pattern: '*', action: 'deny' },
  { permission: 'task', pattern: 'explore', action: 'allow' },
  { permission: 'task', pattern: 'general', action: 'allow' },
];

function serviceWithCreate(): { service: OpencodeClientService; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({ data: { id: 'ses-1' } });
  const service = new OpencodeClientService();
  (service as unknown as { client: unknown }).client = { session: { create } };
  (service as unknown as { status: string }).status = 'ready';
  return { service, create };
}

describe('interactive task scope — createSession body', () => {
  it('interactive default-mode session ends with exactly the three task rules, in order', async () => {
    const { service, create } = serviceWithCreate();
    await service.createSession('s', '/tmp', undefined, undefined, undefined, undefined, 'default', true);
    expect(create.mock.calls[0][0].body.permission).toEqual(TASK_RULES);
  });

  it('interactive bypassPermissions session puts the task rules AFTER the wildcard allow', async () => {
    const { service, create } = serviceWithCreate();
    await service.createSession('s', '/tmp', undefined, undefined, undefined, undefined, 'bypassPermissions', true);
    expect(create.mock.calls[0][0].body.permission).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'bash', pattern: '*', action: 'ask' },
      ...TASK_RULES,
    ]);
  });

  it('interactive plan session keeps the bash deny and appends the task rules last', async () => {
    const { service, create } = serviceWithCreate();
    await service.createSession('s', '/tmp', undefined, undefined, undefined, undefined, 'plan', true);
    expect(create.mock.calls[0][0].body.permission).toEqual([
      { permission: 'bash', pattern: '*', action: 'deny' },
      ...TASK_RULES,
    ]);
  });

  it('headless/scheduled session (flag omitted) carries NO task rules', async () => {
    const { service, create } = serviceWithCreate();
    await service.createSession('s', '/tmp');
    await service.createSession('s', '/tmp', undefined, undefined, undefined, undefined, 'bypassPermissions');
    expect(create.mock.calls[0][0].body).not.toHaveProperty('permission');
    expect(create.mock.calls[1][0].body.permission).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'bash', pattern: '*', action: 'ask' },
    ]);
  });

  it('exported constant is the three rules in findLast-safe order', () => {
    expect(INTERACTIVE_TASK_PERMISSION).toEqual(TASK_RULES);
  });
});

describe('interactive task scope — updateSessionPermissionMode', () => {
  // The engine APPENDS a PATCHed ruleset, so a bypass switch would re-open
  // task unless the task rules are re-sent after the mode rules.
  it('re-appends the task rules after bypass mode rules for interactive sessions only', async () => {
    const svc = new OpencodeClientService();
    const update = vi.fn().mockResolvedValue({ data: {} });
    (svc as unknown as Record<string, unknown>)['v2Client'] = vi.fn().mockResolvedValue({ session: { update } });

    await svc.updateSessionPermissionMode('sdk-i', 'bypassPermissions', true);
    await svc.updateSessionPermissionMode('sdk-h', 'bypassPermissions');

    expect(update).toHaveBeenNthCalledWith(1, {
      sessionID: 'sdk-i',
      permission: [
        { permission: '*', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: '*', action: 'ask' },
        ...TASK_RULES,
      ],
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      sessionID: 'sdk-h',
      permission: [
        { permission: '*', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: '*', action: 'ask' },
      ],
    });
  });
});

describe('interactive task scope — predicate matches the async-delegation gate', () => {
  const base = { category: 'chat' as const, isSystem: false, scheduledTaskId: null };
  it.each([
    ['interactive chat', base, true],
    ['system row', { ...base, isSystem: true }, false],
    ['scheduled row', { ...base, scheduledTaskId: 'sched-1' }, false],
    ['scheduled category', { ...base, category: 'scheduled' as const }, false],
    ['self_improvement category', { ...base, category: 'self_improvement' as const }, false],
    ['missing row', null, false],
  ])('%s → %s', (_label, row, expected) => {
    expect(isInteractiveChatSession(row)).toBe(expected);
  });
});
