import {
  getSessionDiff,
  getSessionMessages,
  MOBILE_SESSION_MESSAGE_PAGE_SIZE,
} from '@/providers/services/session-service';

describe('mobile session transcript loading', () => {
  test('requests a bounded recent message page', async () => {
    const messages = jest.fn().mockResolvedValue({ data: [] });
    const client = { session: { messages } } as never;

    await getSessionMessages(client, 'ses-large');

    expect(messages).toHaveBeenCalledWith({
      sessionID: 'ses-large',
      limit: MOBILE_SESSION_MESSAGE_PAGE_SIZE,
    });
    expect(MOBILE_SESSION_MESSAGE_PAGE_SIZE).toBeLessThanOrEqual(20);
  });

  test('derives the diff anchor from already-loaded messages', async () => {
    const messages = jest.fn();
    const diff = jest.fn().mockResolvedValue({ data: [] });
    const client = { session: { messages, diff } } as never;
    const loaded = [
      { info: { id: 'msg-user', role: 'user' }, parts: [] },
      { info: { id: 'msg-assistant', role: 'assistant' }, parts: [] },
    ] as never;

    await getSessionDiff(client, 'ses-large', loaded);

    expect(messages).not.toHaveBeenCalled();
    expect(diff).toHaveBeenCalledWith({
      sessionID: 'ses-large',
      messageID: 'msg-user',
    });
  });
});
