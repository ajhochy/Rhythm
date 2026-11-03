import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { OpencodeProvider, useOpencode } from '@/providers/opencode-provider';

const PROJECT = '/projects/streaming';
const SESSION = 'session-streaming';
const MESSAGE = 'message-streaming';
const PART = 'part-streaming';
const SECOND_SESSION = 'session-second';
const SECOND_MESSAGE = 'message-second';
const SECOND_PART = 'part-second';
let mockAuthoritativeText = '';
let mockIncompleteText: string | undefined;
let mockToolOnlyOutcome = false;
let mockMessagesGets = 0;
let transcriptCommits = 0;
let latest: ReturnType<typeof useOpencode> | undefined;

const mockInitialMessage = (
  sessionId = SESSION,
  messageId = MESSAGE,
  partId = PART,
) => ({
  info: { id: messageId, role: 'assistant', sessionID: sessionId, time: { created: 1 } as { created: number; completed?: number } },
  parts: [{ id: partId, messageID: messageId, sessionID: sessionId, type: 'text', text: '' }],
});
const mockSession = {
  id: SESSION,
  projectID: PROJECT,
  directory: PROJECT,
  title: 'Streaming',
  time: { created: 1, updated: 1 },
};
const mockSecondSession = {
  ...mockSession,
  id: SECOND_SESSION,
  title: 'Second streaming session',
  time: { created: 2, updated: 2 },
};
const mockPairedClient = {
  origin: () => 'https://paired.invalid',
  request: jest.fn(async () => ({ macOnline: true })),
};
const mockPairedHost = { deviceId: 'phone', hostId: 'mac', rhythmUserId: 1 };
const mockRefreshPairedHost = jest.fn(async () => ({ state: 'connected' }));

type Envelope = { directory: string; payload: Record<string, unknown> };
type MockStream = {
  queue: Envelope[];
  waiting?: (value: IteratorResult<Envelope>) => void;
};
const mockStreams = new Set<MockStream>();
function emit(payload: Record<string, unknown>) {
  const envelope = { directory: PROJECT, payload };
  for (const stream of mockStreams) {
    if (stream.waiting) {
      const resolve = stream.waiting;
      stream.waiting = undefined;
      resolve({ done: false, value: envelope });
    } else stream.queue.push(envelope);
  }
}

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
jest.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: jest.fn(() => ({
    app: { skills: jest.fn(async () => ({ data: [] })) },
    global: { event: jest.fn(async () => ({ stream: [] })) },
    path: { get: jest.fn(async () => ({ data: { directory: PROJECT } })) },
    permission: { list: jest.fn(async () => ({ data: [] })) },
    project: { current: jest.fn(), list: jest.fn(async () => ({ data: [] })) },
    question: { list: jest.fn(async () => ({ data: [] })) },
    session: { list: jest.fn(async () => ({ data: [] })), status: jest.fn(async () => ({ data: {} })) },
  })),
}), { virtual: true });
jest.mock('@/providers/services/mobile-gateway-service', () => ({
  createMobileGatewaySession: jest.fn(),
  listMobileGatewayProfiles: jest.fn(async () => []),
  listMobileGatewayProjects: jest.fn(async () => [{ id: PROJECT, name: 'Streaming' }]),
  updateMobileSessionProfileState: jest.fn(),
}));
jest.mock('@/providers/services/session-service', () => ({
  archiveSession: jest.fn(), deleteSession: jest.fn(), deleteSessionMessage: jest.fn(),
  deleteSessionPart: jest.fn(), executeCommand: jest.fn(), forkSession: jest.fn(),
  getSessionChildren: jest.fn(async () => []), getSessionDiff: jest.fn(async () => []),
  getSessionMessages: jest.fn(async (_client, sessionId: string) => {
    mockMessagesGets += 1;
    const record = sessionId === SECOND_SESSION
      ? mockInitialMessage(SECOND_SESSION, SECOND_MESSAGE, SECOND_PART)
      : mockInitialMessage();
    if (sessionId === SESSION && mockToolOnlyOutcome) {
      return { records: [{ ...record, info: { ...record.info, time: { created: 1, completed: 2 } }, parts: [{
        id: PART, messageID: MESSAGE, sessionID: SESSION, type: 'tool' as const,
        callID: 'tool-call', tool: 'read', state: {
          status: 'completed' as const, input: {}, output: 'Done', title: 'Read', metadata: {},
          time: { start: 1, end: 2 },
        },
      }] }], nextCursor: undefined };
    }
    if (sessionId === SESSION) {
      record.parts[0].text = mockIncompleteText ?? mockAuthoritativeText;
      if (mockIncompleteText === undefined && mockAuthoritativeText) {
        record.info.time = { created: 1, completed: 2 };
      }
    }
    return { records: [record], nextCursor: undefined };
  }),
  getSessionTodos: jest.fn(async () => []), initializeSession: jest.fn(),
  listArchivedSessions: jest.fn(async () => []), listCommands: jest.fn(async () => []),
  listSessions: jest.fn(async () => ({ sessions: [mockSession, mockSecondSession], statuses: {} })),
  listSessionsAcrossProjects: jest.fn(async () => [mockSession, mockSecondSession]),
  resolveExactSession: jest.fn(async (_client, _projectId, sessionId: string) =>
    sessionId === SECOND_SESSION ? mockSecondSession : mockSession), restoreSession: jest.fn(),
  revertSession: jest.fn(), runSessionShell: jest.fn(), unrevertSession: jest.fn(),
  updateSessionPart: jest.fn(), updateSessionTitle: jest.fn(),
}));
jest.mock('@/providers/services/workspace-service', () => ({
  applyVcsPatch: jest.fn(), archiveSession: jest.fn(), createWorktree: jest.fn(),
  findFiles: jest.fn(async () => []), findSymbols: jest.fn(async () => []), findText: jest.fn(async () => []),
  getFileStatus: jest.fn(async () => []), getRawVcsDiff: jest.fn(async () => ''), getVcsDiff: jest.fn(async () => []),
  getVcsInfo: jest.fn(async () => undefined), getVcsStatus: jest.fn(async () => []), listFiles: jest.fn(async () => []),
  listWorktrees: jest.fn(async () => []), loadWorkspaceCatalog: jest.fn(), readFile: jest.fn(),
  removeWorktree: jest.fn(), resetWorktree: jest.fn(),
}));
jest.mock('@/providers/services/mcp-service', () => ({
  addMcpServer: jest.fn(), completeMcpOAuth: jest.fn(), connectMcpServer: jest.fn(), disconnectMcpServer: jest.fn(),
  getMcpStatus: jest.fn(async () => ({})), removeMcpOAuth: jest.fn(), setMcpServerEnabled: jest.fn(),
  startMcpOAuth: jest.fn(),
}));
jest.mock('@/providers/services/terminal-service', () => ({
  closeTerminal: jest.fn(), createTerminal: jest.fn(), createTerminalConnectToken: jest.fn(), getTerminal: jest.fn(),
  getTerminalWebSocketUrl: jest.fn(), listShells: jest.fn(async () => []), listTerminals: jest.fn(async () => []),
  removeTerminal: jest.fn(), updateTerminal: jest.fn(),
}));
jest.mock('@/providers/services/diagnostics-service', () => ({ loadDiagnostics: jest.fn(async () => ({})) }));
jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({
    client: mockPairedClient,
    host: mockPairedHost,
    message: 'Connected', refresh: mockRefreshPairedHost, refreshRevision: 0, state: 'connected',
  }),
}));
jest.mock('@/providers/rhythm-account-provider', () => ({ useRhythmAccount: () => ({ user: { id: 1 } }) }));
jest.mock('@/providers/use-opencode-persistence', () => ({ useOpencodePersistence: () => ({ isHydrated: true }) }));
jest.mock('@/lib/opencode/global-event-stream', () => ({
  streamDirectGlobalEvents: jest.fn(),
  streamPairedGlobalEvents: jest.fn((_client, _project, signal: AbortSignal) => {
    const stream: MockStream = { queue: [] };
    mockStreams.add(stream);
    signal.addEventListener('abort', () => {
      mockStreams.delete(stream);
      stream.waiting?.({ done: true, value: undefined });
      stream.waiting = undefined;
    }, { once: true });
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            const next = stream.queue.shift();
            if (next) return Promise.resolve({ done: false, value: next });
            return new Promise<IteratorResult<Envelope>>((resolve) => {
              stream.waiting = resolve;
            });
          },
        };
      },
    };
  }),
}));
jest.mock('@/lib/notifications', () => ({
  clearPendingTaskFinishedNotification: jest.fn(async () => undefined), notifyQuestionRequired: jest.fn(async () => undefined),
  notifyTaskFinished: jest.fn(async () => undefined), trackPendingTaskFinishedNotification: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/speech-output', () => ({ speakText: jest.fn(async () => false), stopSpeaking: jest.fn(async () => undefined) }));
jest.mock('@/lib/voice/working-sound', () => ({
  startWorkingSoundAsync: jest.fn(async () => undefined), stopWorkingSoundAsync: jest.fn(async () => undefined),
  unloadWorkingSoundAsync: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/use-speech-input', () => ({
  useSpeechInput: () => ({ abort: jest.fn(), isAvailable: false, isListening: false, isStarting: false, level: 0,
    start: jest.fn(), stop: jest.fn(), supportsLocalRecognition: false }),
}));
jest.mock('@/providers/use-conversation-keep-awake', () => ({ useConversationKeepAwake: jest.fn() }));
jest.mock('@/providers/use-conversation-screen-dim', () => ({ useConversationScreenDim: jest.fn() }));

function Probe() {
  const value = useOpencode();
  const text = value.currentTranscript.map((entry) => entry.text).join('');
  useEffect(() => { latest = value; }, [value]);
  useEffect(() => { if (text) transcriptCommits += 1; }, [text]);
  return null;
}

async function waitForLiveEventStream() {
  emit({ type: 'server.connected', properties: {} });
  await waitFor(() => expect(latest?.eventStreamStatus).toBe('connected'));
}

describe('ST-1 provider streaming performance', () => {
  test('m1-c1: idle before same-ID final persistence retries until the final is consumed', async () => {
    // Regression: the only GET occurs before persistence, leaving an empty final forever.
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    mockMessagesGets = 0;
    emit({ type: 'session.idle', properties: { sessionID: SESSION } });
    await waitFor(() => expect(mockMessagesGets).toBeGreaterThanOrEqual(1));
    const authoritativeAt = Date.now();
    mockAuthoritativeText = 'late persisted same-ID final';
    await waitFor(() => expect(latest?.currentTranscript[0]?.text).toBe(mockAuthoritativeText), { timeout: 1000 });
    expect(Date.now() - authoritativeAt).toBeLessThan(1000);
    expect(latest?.currentMessages.map((record) => record.info.id)).toEqual([MESSAGE]);
  });

  test('m1-c3: empty completion stops automatically and exposes a working manual retry', async () => {
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    await waitFor(() => expect(mockMessagesGets).toBeGreaterThanOrEqual(2));
    mockMessagesGets = 0;
    emit({ type: 'session.status', properties: { sessionID: SESSION, status: { type: 'idle' } } });
    await waitFor(() => expect(latest?.completionSyncStatus).toBe('retry'), { timeout: 1500 });
    const automaticGets = mockMessagesGets;
    expect(automaticGets).toBeGreaterThanOrEqual(6);
    expect(automaticGets).toBeLessThanOrEqual(7);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(mockMessagesGets).toBe(automaticGets);
    mockAuthoritativeText = 'final after manual retry';
    act(() => { latest!.retryCompletionSync(SESSION); });
    await waitFor(() => expect(latest?.currentTranscript[0]?.text).toBe(mockAuthoritativeText));
    await waitFor(() => expect(latest?.completionSyncStatus).toBeUndefined());
    expect(mockMessagesGets).toBe(automaticGets + 1);
  });

  test('m1-c4: an early empty GET does not erase a richer streamed same-ID reply', async () => {
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    await waitFor(() => expect(mockMessagesGets).toBeGreaterThanOrEqual(2));
    mockMessagesGets = 0;
    emit({ type: 'session.status', properties: { sessionID: SESSION, status: { type: 'busy' } } });
    await waitFor(() => expect(latest?.sessionStatuses[SESSION]).toEqual({ type: 'busy' }));
    emit({ type: 'message.part.updated', properties: {
      sessionID: SESSION, part: { ...mockInitialMessage().parts[0], text: 'streamed reply' }, time: 1,
    } });
    await waitFor(() => expect(latest?.currentTranscript[0]?.text).toBe('streamed reply'));
    emit({ type: 'session.idle', properties: { sessionID: SESSION } });
    await waitFor(() => expect(mockMessagesGets).toBeGreaterThanOrEqual(1));
    expect(latest?.currentTranscript[0]?.text).toBe('streamed reply');
    mockAuthoritativeText = 'authoritative final';
    await waitFor(() => {
      expect(latest?.currentTranscript[0]?.text).toBe('authoritative final');
      expect(latest?.completionSyncStatus).toBeUndefined();
    }, { timeout: 1000 });
    expect(latest?.currentMessages.map((record) => record.info.id)).toEqual([MESSAGE]);
  });

  test('m1-c1: an early nonempty incomplete same-ID snapshot cannot settle or shorten a streamed reply', async () => {
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    emit({ type: 'session.status', properties: { sessionID: SESSION, status: { type: 'busy' } } });
    await waitFor(() => expect(latest?.sessionStatuses[SESSION]).toEqual({ type: 'busy' }));
    emit({ type: 'message.part.updated', properties: {
      sessionID: SESSION, part: { ...mockInitialMessage().parts[0], text: 'streamed reply still arriving' }, time: 1,
    } });
    await waitFor(() => expect(latest?.currentTranscript[0]?.text).toBe('streamed reply still arriving'));
    mockIncompleteText = 'streamed';
    emit({ type: 'session.idle', properties: { sessionID: SESSION } });
    await waitFor(() => expect(latest?.completionSyncStatus).toBe('syncing'));
    await waitFor(() => expect(mockMessagesGets).toBeGreaterThanOrEqual(2));
    expect(latest?.currentTranscript[0]?.text).toBe('streamed reply still arriving');
    mockIncompleteText = undefined;
    mockAuthoritativeText = 'authoritative completed reply';
    await waitFor(() => expect(latest?.currentTranscript[0]?.text).toBe(mockAuthoritativeText), { timeout: 1000 });
    await waitFor(() => expect(latest?.completionSyncStatus).toBeUndefined());
  });

  test('m1-c1: a discarded overlapping GET cannot settle completion sync', async () => {
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    mockIncompleteText = 'short persisted text';
    const getMessages = (jest.requireMock('@/providers/services/session-service') as {
      getSessionMessages: jest.Mock;
    }).getSessionMessages;
    let releaseOlder!: (value: unknown) => void;
    const olderResponse = new Promise((resolve) => { releaseOlder = resolve; });
    getMessages.mockImplementationOnce(() => olderResponse);

    emit({ type: 'session.idle', properties: { sessionID: SESSION } });
    await waitFor(() => expect(latest?.completionSyncStatus).toBe('syncing'));
    // A manual refresh starts a newer fetch while the completion poll is held.
    await act(async () => { await latest!.refreshCurrentSession(true); });
    const olderRecord = mockInitialMessage();
    olderRecord.info.time = { created: 1, completed: 2 };
    olderRecord.parts[0].text = 'discarded completed text';
    await act(async () => {
      releaseOlder({ records: [olderRecord], nextCursor: undefined });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(latest?.completionSyncStatus).toBe('syncing');
    expect(latest?.currentTranscript[0]?.text).not.toBe('discarded completed text');

    mockIncompleteText = undefined;
    mockAuthoritativeText = 'latest completed text';
    await waitFor(() => expect(latest?.currentTranscript[0]?.text).toBe(mockAuthoritativeText), { timeout: 1000 });
    await waitFor(() => expect(latest?.completionSyncStatus).toBeUndefined());
  });

  test('m1-c4: a persisted tool-only terminal turn does not wait for text', async () => {
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    mockToolOnlyOutcome = true;
    mockMessagesGets = 0;
    emit({ type: 'session.idle', properties: { sessionID: SESSION } });
    await waitFor(() => expect(latest?.completionSyncStatus).toBeUndefined());
    await waitFor(() => expect(latest?.currentMessages[0]?.parts[0]?.type).toBe('tool'));
    expect(mockMessagesGets).toBeGreaterThanOrEqual(1);
    expect(mockMessagesGets).toBeLessThanOrEqual(2);
  });

  beforeEach(() => {
    mockAuthoritativeText = '';
    mockIncompleteText = undefined;
    mockToolOnlyOutcome = false;
    mockMessagesGets = 0;
    transcriptCommits = 0;
    latest = undefined;
    mockStreams.clear();
    jest.clearAllMocks();
  });
  afterEach(cleanup);

  test('100 live deltas advance before idle with bounded commits and no pre-idle messages GET', async () => {
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(latest?.activeProjectPath).toBe(PROJECT);
    mockMessagesGets = 0;
    transcriptCommits = 0;
    const started = Date.now();
    emit({
      id: 'snapshot', type: 'message.part.updated',
      properties: { sessionID: SESSION, part: mockInitialMessage().parts[0], time: 1 },
    });
    emit({
      id: 'working', type: 'session.status',
      properties: { sessionID: SESSION, status: { type: 'working' } },
    });
    await waitFor(() => expect(latest?.sessionStatuses[SESSION]).toEqual({ type: 'working' }));
    for (let index = 0; index < 100; index += 1) {
      emit({
        type: 'message.part.delta',
        properties: { sessionID: SESSION, messageID: MESSAGE, partID: PART, field: 'text', delta: String(index % 10) },
      });
    }
    const baseline = process.env.ST_PROVIDER_REVISION === 'baseline';
    if (baseline) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
      expect(latest?.currentTranscript[0]?.text ?? '').toBe('');
      expect(mockMessagesGets).toBe(1);
      expect(transcriptCommits).toBe(0);
    } else {
      await waitFor(() => expect(latest?.currentTranscript[0]?.text.length).toBe(100));
      expect(mockMessagesGets).toBe(0);
      expect(transcriptCommits).toBeGreaterThanOrEqual(1);
      expect(transcriptCommits).toBeLessThanOrEqual(2);
    }
    const firstVisibleMs = baseline ? null : Date.now() - started;
    const preIdleGets = mockMessagesGets;
    const preIdleCommits = transcriptCommits;

    mockAuthoritativeText = 'authoritative final';
    emit({ id: 'idle', type: 'session.idle', properties: { sessionID: SESSION } });
    await waitFor(() => expect(latest?.currentTranscript[0]?.text).toBe(mockAuthoritativeText));
    expect(mockMessagesGets).toBe(preIdleGets + 1);
    console.info(`ST-1 provider ${baseline ? 'baseline' : 'post'}: first-visible-ms=${firstVisibleMs ?? 'none'}, first-visible-event=${baseline ? 'none' : 100}, commits=${preIdleCommits}, pre-idle-messages-get=${preIdleGets}, reconciled=true`);
  });

  test('st1-r3: 20% lossy out-of-order anonymous deltas reconcile deeply on idle', async () => {
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    mockMessagesGets = 0;
    emit({
      id: 'lossy-snapshot', type: 'message.part.updated',
      properties: { sessionID: SESSION, part: mockInitialMessage().parts[0], time: 1 },
    });
    emit({
      id: 'lossy-working', type: 'session.status',
      properties: { sessionID: SESSION, status: { type: 'working' } },
    });
    await waitFor(() => expect(latest?.sessionStatuses[SESSION]).toEqual({ type: 'working' }));
    const delivered = Array.from({ length: 100 }, (_, index) => index)
      .filter((index) => index % 5 !== 0)
      .reverse();
    for (const index of delivered) {
      emit({
        type: 'message.part.delta',
        properties: { sessionID: SESSION, messageID: MESSAGE, partID: PART, field: 'text', delta: String(index % 10) },
      });
    }
    await waitFor(() => expect(latest?.currentTranscript[0]?.text.length).toBe(80));
    expect(mockMessagesGets).toBe(0);
    mockAuthoritativeText = '0123456789'.repeat(10);
    emit({ type: 'session.idle', properties: { sessionID: SESSION } });
    const authoritative = mockInitialMessage();
    authoritative.parts[0].text = mockAuthoritativeText;
    authoritative.info.time = { created: 1, completed: 2 };
    await waitFor(() => expect(latest?.currentMessages).toEqual([authoritative]));
    expect(mockMessagesGets).toBe(1);
  });

  test('st1-r4: queued transcript batches stay session-keyed across a session switch', async () => {
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    const firstSnapshot = mockInitialMessage();
    firstSnapshot.parts[0].text = 'seed';
    emit({
      id: 'first-snapshot', type: 'message.part.updated',
      properties: { sessionID: SESSION, part: firstSnapshot.parts[0], time: 1 },
    });
    emit({
      id: 'first-working', type: 'session.status',
      properties: { sessionID: SESSION, status: { type: 'working' } },
    });
    await waitFor(() => expect(latest?.sessionStatuses[SESSION]).toEqual({ type: 'working' }));
    await waitFor(() => expect(latest?.currentTranscript[0]?.text).toBe('seed'));
    emit({
      type: 'message.part.delta',
      properties: { sessionID: SESSION, messageID: MESSAGE, partID: PART, field: 'text', delta: '-first' },
    });
    await act(async () => { await latest!.openProjectSession(PROJECT, SECOND_SESSION); });
    expect(latest?.currentSessionId).toBe(SECOND_SESSION);
    expect(latest?.currentTranscript[0]?.text).toBe('');
    await waitFor(() => expect(latest?.sessionPreviewById[SESSION]).toBe('-first'));
  });

  test('st1-r5: unmount cancels a queued transcript batch before it can publish', async () => {
    const screen = render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await act(async () => { await latest!.openProjectSession(PROJECT, SESSION); });
    await waitForLiveEventStream();
    transcriptCommits = 0;
    emit({
      type: 'message.part.delta',
      properties: { sessionID: SESSION, messageID: MESSAGE, partID: PART, field: 'text', delta: 'late' },
    });
    await act(async () => { await Promise.resolve(); });
    screen.unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(transcriptCommits).toBe(0);
  });
});
