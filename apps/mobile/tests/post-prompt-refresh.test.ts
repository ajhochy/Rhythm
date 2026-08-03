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
