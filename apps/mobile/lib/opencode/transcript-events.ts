import type { GlobalEvent } from '@opencode-ai/sdk/v2/client';

import type { SessionMessageRecord } from '@/lib/opencode/format';

export type TranscriptEvent = Extract<
  GlobalEvent['payload'],
  { type: 'message.updated' | 'message.part.updated' | 'message.part.delta' }
>;

type MessageUpdatedWithParts = Extract<TranscriptEvent, { type: 'message.updated' }> & {
  properties: { parts?: SessionMessageRecord['parts'] };
};

function sessionMatches(
  eventSessionId: string,
  recordSessionId: unknown,
  sessionId: string,
) {
  return eventSessionId === sessionId
    && (typeof recordSessionId !== 'string' || recordSessionId === sessionId);
}

export function applyTranscriptEvent(
  messages: SessionMessageRecord[],
  event: TranscriptEvent,
  sessionId: string,
): SessionMessageRecord[] {
  if (event.type === 'message.updated') {
    const properties = (event as MessageUpdatedWithParts).properties;
    if (!sessionMatches(properties.sessionID, properties.info.sessionID, sessionId)) return messages;
    const index = messages.findIndex((message) => message.info.id === properties.info.id);
    const parts = properties.parts ?? (index >= 0 ? messages[index].parts : []);
    const next = { info: properties.info, parts };
    if (index < 0) return [...messages, next];
    if (messages[index].info === next.info && messages[index].parts === next.parts) return messages;
    const updated = messages.slice();
    updated[index] = next;
    return updated;
  }

  if (event.type === 'message.part.updated') {
    const { part, sessionID } = event.properties;
    if (!sessionMatches(sessionID, part.sessionID, sessionId)) return messages;
    const messageIndex = messages.findIndex((message) => message.info.id === part.messageID);
    if (messageIndex < 0) return messages;
    const message = messages[messageIndex];
    const partIndex = message.parts.findIndex((candidate) => candidate.id === part.id);
    if (partIndex >= 0 && message.parts[partIndex] === part) return messages;
    const parts = message.parts.slice();
    if (partIndex < 0) parts.push(part);
    else parts[partIndex] = part;
    const updated = messages.slice();
    updated[messageIndex] = { ...message, parts };
    return updated;
  }

  const { sessionID, messageID, partID, field, delta } = event.properties;
  if (sessionID !== sessionId || !delta) return messages;
  const messageIndex = messages.findIndex((message) => message.info.id === messageID);
  if (messageIndex < 0) return messages;
  const message = messages[messageIndex];
  const partIndex = message.parts.findIndex((part) => part.id === partID);
  if (partIndex < 0) return messages;
  const part = message.parts[partIndex] as unknown as Record<string, unknown>;
  if (typeof part[field] !== 'string') return messages;
  const parts = message.parts.slice();
  parts[partIndex] = {
    ...part,
    [field]: part[field] + delta,
  } as SessionMessageRecord['parts'][number];
  const updated = messages.slice();
  updated[messageIndex] = { ...message, parts };
  return updated;
}

export function applyTranscriptEvents(
  messages: SessionMessageRecord[],
  events: TranscriptEvent[],
  sessionId: string,
) {
  return events.reduce(
    (current, event) => applyTranscriptEvent(current, event, sessionId),
    messages,
  );
}

export function createTranscriptEventBatcher(
  onFlush: (events: TranscriptEvent[]) => void,
  delayMs = 75,
) {
  let pending: TranscriptEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pending.length === 0) return;
    const events = pending;
    pending = [];
    onFlush(events);
  };

  return {
    push(event: TranscriptEvent) {
      pending.push(event);
      timer ??= setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = [];
    },
  };
}
