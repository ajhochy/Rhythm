import {
  dedupeRecoveryEvents,
  getStableRecoveryEventId,
} from '@/providers/services/agent-chat-service';

const delta = (text: string, id?: string) => ({
  ...(id ? { id } : {}),
  type: 'message.part.delta',
  properties: {
    sessionID: 'session-current',
    messageID: 'message-current',
    partID: 'part-current',
    field: 'text',
    delta: text,
  },
});

test('st1-r1: exact SDK delta payloads without event IDs never collapse by message or part ID', () => {
  // Regression caught: getStableRecoveryEventId used messageID as an event ID,
  // so every delta after the first for one message was silently discarded.
  const events = [delta('first'), delta('second'), delta('second')];
  expect(events.every((event) => !('id' in event))).toBe(true);
  expect(events.map(getStableRecoveryEventId)).toEqual([null, null, null]);
  expect(dedupeRecoveryEvents(events)).toEqual(events);
});

test('st1-r2: explicitly identified deltas and unrelated stable recovery events still dedupe', () => {
  // Regression caught: fixing anonymous deltas by disabling recovery dedupe
  // globally would replay events that do carry trustworthy identities.
  const identified = delta('same', 'event-1');
  expect(dedupeRecoveryEvents([identified, identified])).toEqual([identified]);
  const removed = {
    type: 'message.removed',
    properties: { sessionID: 'session-current', messageID: 'message-current' },
  };
  expect(getStableRecoveryEventId(removed)).toBe(
    'message.removed:session-current:message-current',
  );
  expect(dedupeRecoveryEvents([removed, removed])).toEqual([removed]);
});
