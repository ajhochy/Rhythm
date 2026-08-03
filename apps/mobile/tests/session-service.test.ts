import {
  resolveOwnerDiscoveredSession,
  getSessionDiff,
  getSessionMessages,
  MOBILE_SESSION_MESSAGE_PAGE_SIZE,
} from '@/providers/services/session-service';

describe('mobile session transcript loading', () => {
  test('resolves one owner-authorized session outside the selected catalog', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [{ id: 'ses-projectless', title: 'Desktop chat' }],
    });
    const client = { experimental: { session: { list } } } as never;

    await expect(
      resolveOwnerDiscoveredSession(client, 'ses-projectless'),
    ).resolves.toMatchObject({ id: 'ses-projectless' });
    expect(list).toHaveBeenCalledWith(
      { archived: false, search: 'ses-projectless', limit: 1 },
      {
        headers: {
          'x-rhythm-session-discovery': 'owner-unscoped',
        },
      },
    );
  });

  test('requests a bounded recent message page', async () => {
    const messages = jest.fn().mockResolvedValue({ data: [] });
    const client = { session: { messages } } as never;

    await expect(getSessionMessages(client, 'ses-large')).resolves.toEqual({
      records: [],
      nextCursor: undefined,
    });

    expect(messages).toHaveBeenCalledWith({
      sessionID: 'ses-large',
      limit: MOBILE_SESSION_MESSAGE_PAGE_SIZE,
    });
    expect(MOBILE_SESSION_MESSAGE_PAGE_SIZE).toBeLessThanOrEqual(20);
  });

  test('requests an older page before the supplied message cursor', async () => {
    const records = Array.from(
      { length: MOBILE_SESSION_MESSAGE_PAGE_SIZE },
      (_, index) => ({ info: { id: `message-${index}` }, parts: [] }),
    );
    const messages = jest.fn().mockResolvedValue({ data: records });
    const client = { session: { messages } } as never;

    await expect(
      getSessionMessages(client, 'ses-large', { cursor: 'message-20' }),
    ).resolves.toMatchObject({
      records,
      nextCursor: 'message-0',
    });
    expect(messages).toHaveBeenCalledWith({
      sessionID: 'ses-large',
      limit: MOBILE_SESSION_MESSAGE_PAGE_SIZE,
      before: 'message-20',
    });
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
