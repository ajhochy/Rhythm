import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import React, { useEffect } from 'react';

import {
  AgentChatProvider,
  useAgentChat,
} from '@/providers/agent-chat-provider';
import {
  OpencodeProvider,
  useOpencode,
  type AgentOption,
  type ChatPreferences,
} from '@/providers/opencode-provider';

const ACTIVE_PROJECT = '/projects/active';
const TARGET_PROJECT = '/projects/target';
const SESSION_ID = 'session-created-empty';
const requestLog: string[] = [];
type NetworkPhase =
  | 'profile'
  | 'create'
  | 'preference-patch'
  | 'catalog-sweep'
  | 'session-refresh'
  | 'exact-session'
  | 'messages';
type PendingRequest = {
  phase: NetworkPhase;
  resolve: () => void;
};
const pendingRequests: PendingRequest[] = [];
let controlNetwork = false;

function networkRequest<T>(phase: NetworkPhase, line: string, value: T): Promise<T> {
  requestLog.push(line);
  if (!controlNetwork) return Promise.resolve(value);
  return new Promise<T>((resolve) => {
    pendingRequests.push({ phase, resolve: () => resolve(value) });
  });
}
const PROFILE = {
  profileId: 'profile-build',
  opencodeAgentId: 'build',
  name: 'Build',
  label: 'Build',
  defaults: {
    providerId: 'openai',
    modelId: 'gpt-5',
    reasoningEffort: 'high',
    approvalMode: 'default',
  },
  display: { icon: 'terminal', color: null },
};
const CREATED = {
  id: SESSION_ID,
  projectID: TARGET_PROJECT,
  directory: TARGET_PROJECT,
  title: 'New chat',
  time: { created: 1, updated: 1 },
};

const mockListProfiles = jest.fn((_client, projectId: string) =>
  networkRequest('profile', `GET profiles ${projectId}`, [PROFILE]));
const mockCreateMobileSession = jest.fn((_client, projectId: string) =>
  networkRequest('create', `POST session ${projectId}`, CREATED));
const mockUpdateProfileState = jest.fn((
  _client,
  projectId: string,
  sessionId: string,
  body: Record<string, unknown>,
) => networkRequest('preference-patch', `PATCH session ${projectId}/${sessionId}`, {
    profileId: body.profileId,
    opencodeAgentId: body.opencodeAgentId,
    providerId: body.providerId,
    modelId: body.modelId,
    thinkingBudget: body.thinkingBudget,
    permissionMode: body.permissionMode,
  }));
const mockResolveExactSession = jest.fn(() =>
  networkRequest('exact-session', `GET exact-session ${TARGET_PROJECT}/${SESSION_ID}`, CREATED));
const mockGetMessages = jest.fn(() =>
  networkRequest('messages', `GET messages ${TARGET_PROJECT}/${SESSION_ID}`, { records: [], nextCursor: undefined }));
const mockListSessions = jest.fn(() =>
  networkRequest('session-refresh', `GET sessions ${ACTIVE_PROJECT}`, { sessions: [], statuses: {} }));
const mockListSessionsAcrossProjects = jest.fn(() =>
  networkRequest('catalog-sweep', 'GET catalog-sweep', []));
const mockPairedClient = {
  origin: () => 'https://paired.invalid',
  request: jest.fn(async () => ({ macOnline: true })),
};
const mockPairedHost = {
  deviceId: 'phone',
  hostId: 'mac',
  rhythmUserId: 1585,
};
const mockRefreshPairedHost = jest.fn(async () => ({ state: 'connected' }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

async function observeAwaitedPhases<T>(operation: Promise<T>) {
  const awaited: NetworkPhase[] = [];
  let settled = false;
  let result: T | undefined;
  let failure: unknown;
  void operation.then(
    (value) => { result = value; settled = true; },
    (error) => { failure = error; settled = true; },
  );

  for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
    await act(async () => { await Promise.resolve(); });
    if (settled) break;
    const pending = pendingRequests.shift();
    if (pending) {
      awaited.push(pending.phase);
      await act(async () => { pending.resolve(); await Promise.resolve(); });
    } else {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
  }
  if (!settled) throw new Error('Public provider flow did not settle after all observed requests were released.');
  if (failure) throw failure;
  return { awaited, result: result as T };
}

async function releaseBackgroundRequests() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => { await Promise.resolve(); });
    const pending = pendingRequests.shift();
    if (!pending) return;
    await act(async () => { pending.resolve(); await Promise.resolve(); });
  }
  throw new Error('Background provider requests did not drain.');
}

jest.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: jest.fn(() => ({
    app: { skills: jest.fn(async () => ({ data: [] })) },
    global: { event: jest.fn(async () => ({ stream: [] })) },
    path: { get: jest.fn(async () => ({ data: { directory: ACTIVE_PROJECT } })) },
    permission: { list: jest.fn(async () => ({ data: [] })) },
    project: { current: jest.fn(), list: jest.fn(async () => ({ data: [] })) },
    question: { list: jest.fn(async () => ({ data: [] })) },
    session: { list: jest.fn(async () => ({ data: [] })), status: jest.fn(async () => ({ data: {} })) },
  })),
}), { virtual: true });

jest.mock('@/providers/services/mobile-gateway-service', () => ({
  createMobileGatewaySession: (...args: Parameters<typeof mockCreateMobileSession>) => mockCreateMobileSession(...args),
  listMobileGatewayProfiles: (...args: Parameters<typeof mockListProfiles>) => mockListProfiles(...args),
  listMobileGatewayProjects: jest.fn(async () => [
    { id: ACTIVE_PROJECT, name: 'Active' },
    { id: TARGET_PROJECT, name: 'Target' },
  ]),
  updateMobileSessionProfileState: (...args: Parameters<typeof mockUpdateProfileState>) => mockUpdateProfileState(...args),
}));

jest.mock('@/providers/services/session-service', () => ({
  archiveSession: jest.fn(),
  deleteSession: jest.fn(),
  deleteSessionMessage: jest.fn(),
  deleteSessionPart: jest.fn(),
  executeCommand: jest.fn(),
  forkSession: jest.fn(),
  getSessionChildren: jest.fn(async () => []),
  getSessionDiff: jest.fn(async () => []),
  getSessionMessages: (...args: Parameters<typeof mockGetMessages>) => mockGetMessages(...args),
  getSessionTodos: jest.fn(async () => []),
  initializeSession: jest.fn(),
  listArchivedSessions: jest.fn(async () => []),
  listCommands: jest.fn(async () => []),
  listSessions: (...args: Parameters<typeof mockListSessions>) => mockListSessions(...args),
  listSessionsAcrossProjects: (...args: Parameters<typeof mockListSessionsAcrossProjects>) => mockListSessionsAcrossProjects(...args),
  resolveExactSession: (...args: Parameters<typeof mockResolveExactSession>) => mockResolveExactSession(...args),
  restoreSession: jest.fn(),
  revertSession: jest.fn(),
  runSessionShell: jest.fn(),
  unrevertSession: jest.fn(),
  updateSessionPart: jest.fn(),
  updateSessionTitle: jest.fn(),
}));

jest.mock('@/providers/services/workspace-service', () => ({
  applyVcsPatch: jest.fn(),
  archiveSession: jest.fn(),
  createWorktree: jest.fn(),
  findFiles: jest.fn(async () => []),
  findSymbols: jest.fn(async () => []),
  findText: jest.fn(async () => []),
  getFileStatus: jest.fn(async () => []),
  getRawVcsDiff: jest.fn(async () => ''),
  getVcsDiff: jest.fn(async () => []),
  getVcsInfo: jest.fn(async () => undefined),
  getVcsStatus: jest.fn(async () => []),
  listFiles: jest.fn(async () => []),
  listWorktrees: jest.fn(async () => []),
  loadWorkspaceCatalog: jest.fn(),
  readFile: jest.fn(),
  removeWorktree: jest.fn(),
  resetWorktree: jest.fn(),
}));

jest.mock('@/providers/services/mcp-service', () => ({
  addMcpServer: jest.fn(), completeMcpOAuth: jest.fn(), connectMcpServer: jest.fn(),
  disconnectMcpServer: jest.fn(), getMcpStatus: jest.fn(async () => ({})),
  removeMcpOAuth: jest.fn(), setMcpServerEnabled: jest.fn(), startMcpOAuth: jest.fn(),
}));

jest.mock('@/providers/services/terminal-service', () => ({
  closeTerminal: jest.fn(), createTerminal: jest.fn(), createTerminalConnectToken: jest.fn(),
  getTerminal: jest.fn(), getTerminalWebSocketUrl: jest.fn(), listShells: jest.fn(async () => []),
  listTerminals: jest.fn(async () => []), removeTerminal: jest.fn(), updateTerminal: jest.fn(),
}));

jest.mock('@/providers/services/diagnostics-service', () => ({
  loadDiagnostics: jest.fn(async () => ({})),
}));

jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({
    client: mockPairedClient,
    host: mockPairedHost,
    message: 'Connected',
    refresh: mockRefreshPairedHost,
    refreshRevision: 0,
    state: 'connected',
  }),
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => ({ user: { id: 1585 } }),
}));

jest.mock('@/providers/use-opencode-persistence', () => ({
  useOpencodePersistence: () => ({ isHydrated: true }),
}));

jest.mock('@/lib/opencode/global-event-stream', () => ({
  streamDirectGlobalEvents: jest.fn(),
  streamPairedGlobalEvents: jest.fn((_client, _project, signal: AbortSignal) => ({
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => resolve({ done: true, value: undefined }),
            { once: true },
          );
        }),
      };
    },
  })),
}));

jest.mock('@/lib/notifications', () => ({
  clearPendingTaskFinishedNotification: jest.fn(async () => undefined),
  notifyQuestionRequired: jest.fn(async () => undefined),
  notifyTaskFinished: jest.fn(async () => undefined),
  trackPendingTaskFinishedNotification: jest.fn(async () => undefined),
}));

jest.mock('@/lib/voice/speech-output', () => ({
  speakText: jest.fn(async () => false),
  stopSpeaking: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/working-sound', () => ({
  startWorkingSoundAsync: jest.fn(async () => undefined),
  stopWorkingSoundAsync: jest.fn(async () => undefined),
  unloadWorkingSoundAsync: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/use-speech-input', () => ({
  useSpeechInput: () => ({ abort: jest.fn(), isAvailable: false, isListening: false, isStarting: false, level: 0, start: jest.fn(), stop: jest.fn(), supportsLocalRecognition: false }),
}));
jest.mock('@/providers/use-conversation-keep-awake', () => ({ useConversationKeepAwake: jest.fn() }));
jest.mock('@/providers/use-conversation-screen-dim', () => ({ useConversationScreenDim: jest.fn() }));

let latest: ReturnType<typeof useOpencode> | undefined;
let latestChat: ReturnType<typeof useAgentChat> | undefined;
function Probe() {
  const value = useOpencode();
  useEffect(() => { latest = value; }, [value]);
  return null;
}
function ChatProbe() {
  const value = useAgentChat();
  useEffect(() => { latestChat = value; }, [value]);
  return null;
}

describe('PR #1585 created-session provider cache', () => {
  beforeEach(() => {
    latest = undefined;
    latestChat = undefined;
    requestLog.length = 0;
    pendingRequests.length = 0;
    controlNetwork = false;
    jest.clearAllMocks();
  });
  afterEach(() => {
    controlNetwork = false;
    pendingRequests.splice(0).forEach((request) => request.resolve());
    cleanup();
  });

  test('NC-1/NC-2: one catalog read and zero blocking cold-open reads', async () => {
    // Regression caught: the sheet catalog was fetched again during preference
    // persistence, then the known-empty session paid exact + messages reads.
    try {
      render(<OpencodeProvider><Probe /></OpencodeProvider>);
    } catch (error) {
      if (error instanceof AggregateError && error.errors[0]) throw error.errors[0];
      throw error;
    }
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));

    let profiles: AgentOption[] = [];
    await act(async () => {
      profiles = await latest!.loadSessionProfiles(TARGET_PROJECT);
    });
    const preferences = {
      ...latest!.chatPreferences,
      profileId: PROFILE.profileId,
      mode: PROFILE.opencodeAgentId,
      providerId: 'openai',
      modelId: 'openai/gpt-5',
      reasoning: 'high' as const,
      permissionMode: 'default' as const,
      autoApprove: false,
    } as ChatPreferences;
    expect(profiles[0].profileId).toBe(PROFILE.profileId);
    let criticalPathLog: string[] = [];
    await act(async () => {
      await expect(latest!.createSession('New chat', {
        projectId: TARGET_PROJECT,
        preferences,
      })).resolves.toEqual(expect.objectContaining({ id: SESSION_ID }));
      await expect(latest!.openProjectSession(TARGET_PROJECT, SESSION_ID)).resolves.toEqual(
        expect.objectContaining({ kind: 'ready' }),
      );
      criticalPathLog = [...requestLog];
    });

    expect(requestLog.filter((line) => line === `GET profiles ${TARGET_PROJECT}`)).toHaveLength(1);
    expect(criticalPathLog.filter((line) => line.startsWith('GET exact-session'))).toHaveLength(0);
    expect(criticalPathLog.filter((line) => line.startsWith('GET messages'))).toHaveLength(0);
    await waitFor(() => {
      expect(requestLog.filter((line) => line.startsWith('GET messages')).length).toBeGreaterThanOrEqual(1);
    });
    expect(mockUpdateProfileState).toHaveBeenCalledWith(
      expect.anything(),
      TARGET_PROJECT,
      SESSION_ID,
      expect.objectContaining({
        profileId: PROFILE.profileId,
        opencodeAgentId: PROFILE.opencodeAgentId,
        providerId: 'openai',
        modelId: 'gpt-5',
        thinkingBudget: 8192,
        permissionMode: 'default',
      }),
    );
  });

  test('NC-1/NC-2 perf: awaited network phases fall from baseline 6 to post-change 2', async () => {
    // Regression caught: a hand-authored baseline sequence can prove any
    // desired count. This test observes whichever requests the real provider
    // public create/open promises actually await and releases them generically.
    render(
      <OpencodeProvider>
        <AgentChatProvider>
          <Probe />
          <ChatProbe />
        </AgentChatProvider>
      </OpencodeProvider>,
    );
    await waitFor(() => {
      expect(latest?.connection.status).toBe('connected');
      expect(latestChat).toBeDefined();
      expect(latestChat?.isLoading).toBe(false);
    });
    requestLog.length = 0;
    controlNetwork = true;

    const profileLoad = observeAwaitedPhases(latest!.loadSessionProfiles(TARGET_PROJECT));
    const loaded = await profileLoad;
    const profiles = loaded.result;
    expect(profiles[0].profileId).toBe(PROFILE.profileId);

    const preferences = {
      ...latest!.chatPreferences,
      profileId: profiles[0].profileId,
      mode: profiles[0].opencodeAgentId,
    } as ChatPreferences;
    const create = await observeAwaitedPhases(
      latestChat!.createChat(TARGET_PROJECT, 'New chat', preferences),
    );
    await releaseBackgroundRequests();
    const open = await observeAwaitedPhases(
      latest!.openProjectSession(TARGET_PROJECT, SESSION_ID),
    );
    const awaitedPhases = [...create.awaited, ...open.awaited];
    const profileGets = requestLog.filter((line) => line.startsWith('GET profiles')).length;
    const blockingOpenGets = awaitedPhases.filter(
      (phase) => phase === 'exact-session' || phase === 'messages',
    ).length;
    const expected = process.env.NC_PROVIDER_REVISION === 'baseline'
      ? { awaited: 6, blockingOpen: 2, profiles: 2 }
      : { awaited: 2, blockingOpen: 0, profiles: 1 };

    console.info(
      `NC provider ${process.env.NC_PROVIDER_REVISION ?? 'post'}: awaited=${awaitedPhases.length}, profiles=${profileGets}, blocking-open=${blockingOpenGets}`,
    );
    expect(awaitedPhases).toHaveLength(expected.awaited);
    expect(profileGets).toBe(expected.profiles);
    expect(blockingOpenGets).toBe(expected.blockingOpen);
    await releaseBackgroundRequests();
  });

  test('NC-2: an unseeded direct open still performs authoritative reads', async () => {
    // Regression caught: broadening the empty-message cache rule would let a
    // reconnect/deep link bypass exact-session and transcript authority.
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));

    let criticalPathLog: string[] = [];
    await act(async () => {
      await expect(latest!.openProjectSession(TARGET_PROJECT, SESSION_ID)).resolves.toEqual(
        expect.objectContaining({ kind: 'ready' }),
      );
      criticalPathLog = [...requestLog];
    });

    expect(criticalPathLog.filter((line) => line.startsWith('GET exact-session'))).toHaveLength(1);
    expect(criticalPathLog.filter((line) => line.startsWith('GET messages'))).toHaveLength(1);
  });

  test('NC-1: active-project create does not await its session-list refresh', async () => {
    // Regression caught: the lower-level createSession still awaited an
    // active-project list refresh even after AgentChatProvider was unblocked.
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    const profiles = await latest!.loadSessionProfiles(ACTIVE_PROJECT);
    const refresh = deferred<{ sessions: never[]; statuses: Record<string, never> }>();
    mockListSessions.mockImplementationOnce(() => refresh.promise);
    let created: { id: string } | undefined;

    await act(async () => {
      void latest!.createSession('New chat', {
        projectId: ACTIVE_PROJECT,
        preferences: {
          ...latest!.chatPreferences,
          profileId: profiles[0].profileId,
          mode: profiles[0].opencodeAgentId,
        },
      }).then((value) => { created = value; });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(created).toEqual(expect.objectContaining({ id: SESSION_ID }));
    await act(async () => refresh.resolve({ sessions: [], statuses: {} }));
  });

  test('NC-1: preference persistence errors reject create and do not seed fast-open', async () => {
    // Regression caught: seeding before the required PATCH could navigate to
    // a session whose requested profile/model/permission state was not durable.
    mockUpdateProfileState.mockRejectedValueOnce(new Error('preference PATCH failed'));
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    let profiles: AgentOption[] = [];
    await act(async () => {
      profiles = await latest!.loadSessionProfiles(TARGET_PROJECT);
    });
    const preferences = {
      ...latest!.chatPreferences,
      profileId: profiles[0].profileId,
      mode: profiles[0].opencodeAgentId,
    } as ChatPreferences;

    await act(async () => {
      await expect(latest!.createSession('New chat', {
        projectId: TARGET_PROJECT,
        preferences,
      })).rejects.toThrow('preference PATCH failed');
    });
    requestLog.length = 0;
    await act(async () => {
      await latest!.openProjectSession(TARGET_PROJECT, SESSION_ID);
    });
    expect(requestLog.filter((line) => line.startsWith('GET exact-session'))).toHaveLength(1);
  });

  test('NC-1: durable create POST failure rejects and publishes or seeds nothing', async () => {
    // Regression caught: a rejected durable create must not publish a row or
    // seed the fast-open cache before a server session exists.
    mockCreateMobileSession.mockRejectedValueOnce(new Error('create POST failed'));
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    const profiles = await latest!.loadSessionProfiles(TARGET_PROJECT);

    await act(async () => {
      await expect(latest!.createSession('New chat', {
        projectId: TARGET_PROJECT,
        preferences: {
          ...latest!.chatPreferences,
          profileId: profiles[0].profileId,
          mode: profiles[0].opencodeAgentId,
        } as ChatPreferences,
      })).rejects.toThrow('create POST failed');
    });
    expect(mockUpdateProfileState).not.toHaveBeenCalled();
    expect(latest!.sessions.some((session) => session.id === SESSION_ID)).toBe(false);

    requestLog.length = 0;
    await act(async () => {
      await latest!.openProjectSession(TARGET_PROJECT, SESSION_ID);
    });
    expect(requestLog.filter((line) => line.startsWith('GET exact-session'))).toHaveLength(1);
    expect(requestLog.filter((line) => line.startsWith('GET messages')).length).toBeGreaterThanOrEqual(1);
  });

  test('NC-1: lower-level background refreshSessions rejection is handled', async () => {
    // Regression caught: active-project create returned successfully but its
    // fire-and-forget refreshSessions rejection escaped as unhandled.
    const unhandledRejections: unknown[] = [];
    const captureUnhandled = (reason: unknown) => { unhandledRejections.push(reason); };
    process.on('unhandledRejection', captureUnhandled);
    try {
      render(<OpencodeProvider><Probe /></OpencodeProvider>);
      await waitFor(() => expect(latest?.connection.status).toBe('connected'));
      const profiles = await latest!.loadSessionProfiles(ACTIVE_PROJECT);
      mockListSessions.mockRejectedValueOnce(new Error('refreshSessions failed'));

      await act(async () => {
        await expect(latest!.createSession('New chat', {
          projectId: ACTIVE_PROJECT,
          preferences: {
            ...latest!.chatPreferences,
            profileId: profiles[0].profileId,
            mode: profiles[0].opencodeAgentId,
          } as ChatPreferences,
        })).resolves.toEqual(expect.objectContaining({ id: SESSION_ID }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockListSessions).toHaveBeenCalled();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', captureUnhandled);
    }
  });

  test('cold connect with zero sessions must not phantom-create a session (dup-session regression)', async () => {
    // Regression: the post-connect bootstrap (`ensureActiveSession`, fired
    // unconditionally whenever connection.status flips to 'connected') treated
    // itself as "idempotent reads" (see the #1506 comment above its call site
    // in opencode-provider.tsx) but actually fell back to creating a brand
    // new session whenever the project had zero sessions. That phantom,
    // untitled session then sat in the session list forever, appearing as a
    // second "Untitled chat" row alongside any chat the user later created
    // for real (docs/ai/spec-session-list-and-create-ui.md screenshot).
    render(<OpencodeProvider><Probe /></OpencodeProvider>);
    await waitFor(() => expect(latest?.connection.status).toBe('connected'));
    await waitFor(() => expect(latest?.activeProjectPath).toBe(ACTIVE_PROJECT));

    // Give the connect-bootstrap effect (and its #1506 retry-once path) every
    // opportunity to run before asserting nothing was created.
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(mockCreateMobileSession).not.toHaveBeenCalled();
    expect(latest?.currentSessionId).toBeUndefined();
    expect(latest?.sessions).toHaveLength(0);
  });
});
