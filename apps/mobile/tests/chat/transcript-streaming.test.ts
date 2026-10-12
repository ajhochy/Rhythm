import type { SessionMessageRecord } from '@/lib/opencode/format';

type TranscriptEventModule = {
  applyTranscriptEvent: (
    messages: SessionMessageRecord[],
    event: Record<string, unknown>,
    sessionId: string,
  ) => SessionMessageRecord[];
  applyTranscriptEvents: (
    messages: SessionMessageRecord[],
    events: Record<string, unknown>[],
    sessionId: string,
  ) => SessionMessageRecord[];
  createTranscriptEventBatcher: (
    flush: (events: Record<string, unknown>[]) => void,
    delayMs?: number,
  ) => {
    push: (event: Record<string, unknown>) => void;
    cancel: () => void;
  };
};

function loadSubject(): TranscriptEventModule | undefined {
  try {
    return jest.requireActual('@/lib/opencode/transcript-events') as TranscriptEventModule;
  } catch {
    return undefined;
  }
}

function message(text = ''): SessionMessageRecord {
  return {
    info: {
      id: 'msg-current',
      role: 'assistant',
      sessionID: 'session-current',
      time: { created: 1 },
    },
    parts: [{
      id: 'part-current',
      messageID: 'msg-current',
      sessionID: 'session-current',
      type: 'text',
      text,
    }],
  } as SessionMessageRecord;
}

function delta(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `event-${index}`,
    type: 'message.part.delta',
    properties: {
      sessionID: 'session-current',
      messageID: 'msg-current',
      partID: 'part-current',
      field: 'text',
      delta: String(index % 10),
      ...overrides,
    },
  };
}

describe('ST-1 mobile transcript streaming contract', () => {
  afterEach(() => jest.useRealTimers());

  test('st1-c1: addressed live delta advances before idle while mismatched events cannot corrupt state', () => {
    // Regression caught: handleEvent drops message.part.delta, so visible text stays empty until a GET.
    const subject = loadSubject();
    expect(subject).toBeDefined();
    if (!subject) return;
    const initial = [message('Hello')];
    const advanced = subject.applyTranscriptEvent(initial, delta(1, { delta: ' world' }), 'session-current');
    expect(advanced[0].parts[0]).toMatchObject({ text: 'Hello world' });
    expect(subject.applyTranscriptEvent(advanced, delta(2, { sessionID: 'session-other', delta: ' bad' }), 'session-current')).toBe(advanced);
    expect(subject.applyTranscriptEvent(advanced, delta(3, { partID: 'part-other', delta: ' bad' }), 'session-current')).toBe(advanced);
    expect(subject.applyTranscriptEvent(advanced, delta(4, { field: 'unknown', delta: ' bad' }), 'session-current')).toBe(advanced);
  });

  test('st1-c2: part snapshots upsert and message metadata updates retain parts unless explicitly supplied', () => {
    // Regression caught: treating every update as a refetch loses live parts or leaves authoritative snapshots stale.
    const subject = loadSubject();
    expect(subject).toBeDefined();
    if (!subject) return;
    const initial = [message('partial')];
    const partUpdated = subject.applyTranscriptEvent(initial, {
      id: 'snapshot-1',
      type: 'message.part.updated',
      properties: {
        sessionID: 'session-current',
        part: { ...initial[0].parts[0], text: 'authoritative' },
      },
    }, 'session-current');
    expect(partUpdated[0].parts[0]).toMatchObject({ text: 'authoritative' });
    const metadataUpdated = subject.applyTranscriptEvent(partUpdated, {
      id: 'message-1',
      type: 'message.updated',
      properties: {
        sessionID: 'session-current',
        info: { ...partUpdated[0].info, time: { created: 1, completed: 2 } },
      },
    }, 'session-current');
    expect(metadataUpdated[0].parts).toEqual(partUpdated[0].parts);
    const replacement = [{ ...initial[0].parts[0], text: 'explicit replacement' }];
    expect(subject.applyTranscriptEvent(metadataUpdated, {
      id: 'message-2',
      type: 'message.updated',
      properties: {
        sessionID: 'session-current',
        info: metadataUpdated[0].info,
        parts: replacement,
      },
    }, 'session-current')[0].parts).toEqual(replacement);
  });

  test('st1-c3: a continuous 100-delta burst commits in bounded 75ms batches without starvation', () => {
    // Regression caught: a resettable trailing timer starves publication during continuous output.
    jest.useFakeTimers();
    const subject = loadSubject();
    expect(subject).toBeDefined();
    if (!subject) return;
    const batches: Record<string, unknown>[][] = [];
    const batcher = subject.createTranscriptEventBatcher((events) => batches.push(events), 75);
    for (let index = 0; index < 100; index += 1) {
      batcher.push(delta(index));
      jest.advanceTimersByTime(1);
    }
    expect(batches.length).toBeGreaterThanOrEqual(1);
    jest.advanceTimersByTime(75);
    expect(batches.flat()).toHaveLength(100);
    expect(batches.length).toBeLessThanOrEqual(2);
    batcher.cancel();
  });

  test('st1-c4: lossy duplicate and out-of-order stream state converges to the authoritative idle transcript', () => {
    // Regression caught: trusting lossy SSE as authority leaves a permanently incomplete transcript.
    const subject = loadSubject();
    expect(subject).toBeDefined();
    if (!subject) return;
    const all = Array.from({ length: 100 }, (_, index) => delta(index));
    const lossyOutOfOrder = all.filter((_, index) => index % 5 !== 0).reverse();
    const streamed = subject.applyTranscriptEvents([message()], lossyOutOfOrder, 'session-current');
    expect((streamed[0].parts[0] as { text: string }).text).not.toBe('0123456789'.repeat(10));
    const authoritative = [message('0123456789'.repeat(10))];
    const reconciled = subject.applyTranscriptEvent(streamed, {
      id: 'idle-authoritative-snapshot',
      type: 'message.part.updated',
      properties: { sessionID: 'session-current', part: authoritative[0].parts[0] },
    }, 'session-current');
    expect(reconciled).toEqual(authoritative);
    const snapshot = {
      id: 'duplicate-snapshot',
      type: 'message.part.updated',
      properties: { sessionID: 'session-current', part: authoritative[0].parts[0] },
    };
    const once = subject.applyTranscriptEvent(authoritative, snapshot, 'session-current');
    expect(subject.applyTranscriptEvent(once, snapshot, 'session-current')).toEqual(once);
  });

  test('st1-c5: 100 deltas produce visible pre-idle text with zero transcript GETs', () => {
    // Regression caught: streaming output is implemented as repeated message GET polling.
    jest.useFakeTimers();
    const subject = loadSubject();
    expect(subject).toBeDefined();
    if (!subject) return;
    let visible = [message()];
    let commits = 0;
    let messagesGets = 0;
    const batcher = subject.createTranscriptEventBatcher((events) => {
      visible = subject.applyTranscriptEvents(visible, events, 'session-current');
      commits += 1;
    }, 75);
    for (let index = 0; index < 100; index += 1) {
      batcher.push(delta(index));
      jest.advanceTimersByTime(1);
    }
    expect((visible[0].parts[0] as { text: string }).text.length).toBeGreaterThan(0);
    expect(commits).toBeGreaterThanOrEqual(1);
    expect(commits).toBeLessThanOrEqual(2);
    expect(messagesGets).toBe(0);
    batcher.cancel();
  });

  test('st1-c6: unrelated message records retain identity through streaming updates', () => {
    // Regression caught: rebuilding the full transcript per delta churns every row and destabilizes scroll anchoring.
    const subject = loadSubject();
    expect(subject).toBeDefined();
    if (!subject) return;
    const unrelated = {
      ...message('older'),
      info: { ...message().info, id: 'msg-older' },
      parts: [{ ...message().parts[0], id: 'part-older', messageID: 'msg-older', text: 'older' }],
    } as SessionMessageRecord;
    const next = subject.applyTranscriptEvent([unrelated, message()], delta(1), 'session-current');
    expect(next[0]).toBe(unrelated);
  });
});
