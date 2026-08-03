import type { SessionMessageRecord } from '@/lib/opencode/format';

export function mergeSessionMessages(
  existing: SessionMessageRecord[],
  incoming: SessionMessageRecord[],
): SessionMessageRecord[] {
  const records = new Map<
    string,
    { message: SessionMessageRecord; order: number }
  >();

  existing.forEach((message, order) => {
    records.set(message.info.id, { message, order });
  });
  incoming.forEach((message, incomingIndex) => {
    const previous = records.get(message.info.id);
    records.set(message.info.id, {
      message,
      order: previous?.order ?? existing.length + incomingIndex,
    });
  });

  return [...records.values()]
    .sort((left, right) => {
      const leftCreated = left.message.info.time?.created;
      const rightCreated = right.message.info.time?.created;
      if (leftCreated !== undefined && rightCreated !== undefined) {
        return leftCreated - rightCreated || left.order - right.order;
      }
      return left.order - right.order;
    })
    .map(({ message }) => message);
}

export function pruneSessionMessage(
  messages: SessionMessageRecord[],
  messageId: string,
): SessionMessageRecord[] {
  return messages.filter((message) => message.info.id !== messageId);
}

export type SessionFetchTracker = {
  start(sessionId: string): number;
  isLatest(sessionId: string, token: number): boolean;
};

export function createSessionFetchTracker(): SessionFetchTracker {
  const sequences = new Map<string, number>();
  return {
    start(sessionId) {
      const next = (sequences.get(sessionId) ?? 0) + 1;
      sequences.set(sessionId, next);
      return next;
    },
    isLatest(sessionId, token) {
      return sequences.get(sessionId) === token;
    },
  };
}
