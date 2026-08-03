import type { SessionMessageRecord } from '@/lib/opencode/format';
import {
  createSessionFetchTracker,
  mergeSessionMessages,
  pruneSessionMessage,
} from '@/lib/opencode/messages';

function message(id: string, created: number, text = id) {
  return {
    info: { id, role: 'user', time: { created } },
    parts: [
      {
        id: `${id}-part`,
        messageID: id,
        sessionID: 'session',
        text,
        type: 'text',
      },
    ],
  } as SessionMessageRecord;
}

describe('session message merging', () => {
  test('a one-message refresh cannot shrink a hydrated transcript', () => {
    const hydrated = Array.from({ length: 20 }, (_, index) =>
      message(`message-${index}`, index),
    );

    expect(
      mergeSessionMessages(hydrated, [message('message-19', 19, 'updated')]),
    ).toHaveLength(20);
  });

  test('deduplicates by id, lets incoming win, and preserves chronology', () => {
    const result = mergeSessionMessages(
      [message('later', 20), message('same', 10, 'old')],
      [message('same', 10, 'new'), message('earlier', 1)],
    );

    expect(result.map((record) => record.info.id)).toEqual([
      'earlier',
      'same',
      'later',
    ]);
    expect(result[1].parts[0]).toMatchObject({ text: 'new' });
  });

  test('rejects a stale out-of-order response after a newer fetch starts', () => {
    const tracker = createSessionFetchTracker();
    const oldRequest = tracker.start('session');
    const newRequest = tracker.start('session');

    expect(tracker.isLatest('session', oldRequest)).toBe(false);
    expect(tracker.isLatest('session', newRequest)).toBe(true);
  });

  test('prunes a removed message without disturbing the rest', () => {
    expect(
      pruneSessionMessage(
        [message('one', 1), message('two', 2), message('three', 3)],
        'two',
      ).map((record) => record.info.id),
    ).toEqual(['one', 'three']);
  });
});
