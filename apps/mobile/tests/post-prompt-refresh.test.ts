import { pollForNewAssistantTurn } from '@/providers/services/post-prompt-refresh';

describe('post-prompt response refresh', () => {
  test('issue-1285-c20: polls past the accepted user turn until assistant text appears', async () => {
    const sleep = jest.fn(async () => undefined);
    const refreshMessages = jest
      .fn()
      .mockResolvedValueOnce([message('user-new', 'user', 'Respond ok')])
      .mockResolvedValueOnce([
        message('user-new', 'user', 'Respond ok'),
        message('assistant-new', 'assistant', 'ok'),
      ]);

    await expect(pollForNewAssistantTurn({
      baselineAssistantMessageIds: new Set(['assistant-old']),
      delaysMs: [1, 2, 3],
      refreshMessages,
      sleep,
    })).resolves.toBe(true);

    expect(refreshMessages).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('task-chat-convergence-c1: transient refresh failures consume bounded attempts until assistant text appears', async () => {
    // Regression caught: one transient transcript read rejection terminates the
    // convergence poll and leaves an accepted response permanently stale.
    const sleep = jest.fn(async () => undefined);
    const refreshMessages = jest
      .fn()
      .mockRejectedValueOnce(new Error('relay restarting'))
      .mockRejectedValueOnce(new Error('gateway warming'))
      .mockResolvedValueOnce([
        message('user-new', 'user', 'Respond ok'),
        message('assistant-new', 'assistant', 'ok'),
      ]);

    await expect(pollForNewAssistantTurn({
      baselineAssistantMessageIds: new Set(['assistant-old']),
      delaysMs: [1, 2, 3, 4],
      refreshMessages,
      sleep,
    })).resolves.toBe(true);

    expect(refreshMessages).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  test('task-chat-convergence-c2: failed refreshes stop after the configured finite delays', async () => {
    // Regression caught: transient-error recovery accidentally installs an
    // unbounded retry timer instead of respecting the existing attempt list.
    const sleep = jest.fn(async () => undefined);
    const refreshMessages = jest.fn(async () => {
      throw new Error('still unavailable');
    });

    await expect(pollForNewAssistantTurn({
      baselineAssistantMessageIds: new Set(),
      delaysMs: [1, 2, 3],
      refreshMessages,
      sleep,
    })).resolves.toBe(false);
    expect(refreshMessages).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(3);
  });
});

function message(id: string, role: 'user' | 'assistant', text: string) {
  return {
    info: {
      id,
      role,
      time: { created: 1 },
      ...(role === 'assistant'
        ? {
            agent: 'test',
            cost: 0,
            finish: 'stop' as const,
            mode: 'test',
            modelID: 'model',
            parentID: 'user-new',
            path: { cwd: '/', root: '/' },
            providerID: 'provider',
            tokens: {
              cache: { read: 0, write: 0 },
              input: 0,
              output: 1,
              reasoning: 0,
              total: 1,
            },
          }
        : {
            agent: 'test',
            model: { modelID: 'model', providerID: 'provider' },
            summary: { diffs: [] },
          }),
    },
    parts: [{
      id: `${id}-text`,
      messageID: id,
      sessionID: 'session',
      text,
      type: 'text' as const,
    }],
  };
}
