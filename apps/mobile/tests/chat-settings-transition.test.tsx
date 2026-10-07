import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { OpencodeProvider, useOpencode } from '@/providers/opencode-provider';
import { sessionSettingsKey } from '@/providers/opencode-provider-utils';
import { PairedHostProvider } from '@/providers/paired-host-provider';

// Real OpencodeProvider + real mobile-gateway settings service; only the transports are stubbed
// (paired-host HTTP client, opencode SDK client, session reads). Pattern: issue-1387-false-offline-after-send.

const PROJECT_ID = 'rhythm-owner-project';
const SDK_ID = 'ses-ordinary';
const PRIMARY_ID = 'local-primary-root';
const SDK = { identity: 'sdk', id: SDK_ID } as const;
const PRIMARY = { identity: 'local-primary', id: PRIMARY_ID } as const;

const mockHost = {
  contractFingerprint: 'contract', deviceId: 'iphone-contract', deviceName: 'Rhythm iPhone',
  features: ['pairing', 'device-revocation', 'project-scope', 'opencode-http-proxy'],
  gatewayUrl: 'https://rhythm.invalid', gatewayVersion: '1', hostId: 'mac-contract',
  minimumMobileVersion: '1.0.8', opencodeVersion: '1.14.49', pairedAt: '2026-08-12T00:00:00.000Z',
  relayUrl: 'https://api.vcrcapps.com/relay', rhythmUserId: 1387, rhythmVersion: '1.0.8',
};

// Server-side stand-in: one persisted settings row per (identity, id), merged on PATCH.
const mockRows = new Map<string, Record<string, unknown>>();
const mockPatches: { identity: string; id: string; body: Record<string, unknown> }[] = [];
const rowKey = (identity: string, id: string) => `${identity}:${id}`;
function seed(identity: string, id: string) {
  mockRows.set(rowKey(identity, id), {
    settingsContractVersion: 1, settingsIdentity: identity,
    localSessionId: identity === 'sdk' ? 'local-ordinary' : id,
    sdkSessionId: identity === 'sdk' ? id : null,
    profileId: 'secretary', opencodeAgentId: 'build', profileAvailability: 'available',
    providerId: 'openai', modelId: 'gpt-5', modelMode: 'fixed', routerDecidedAt: null,
    thinkingBudget: null, permissionMode: 'default', fastMode: false,
  });
}

const mockPairedClient = {
  healthResponse: jest.fn(async () => new Response(JSON.stringify({ status: 'ready', macOnline: true }), { status: 200 })),
  origin: () => 'https://api.vcrcapps.com',
  request: jest.fn(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === '/mobile-gateway/health') return { status: 'ready', macOnline: true };
    const match = /^\/mobile-gateway\/sessions\/([^/]+)\/state\?identity=(.+)$/.exec(path);
    if (!match) throw new Error(`Unexpected paired request: ${path}`);
    const [, id, identity] = match;
    const row = mockRows.get(rowKey(identity, decodeURIComponent(id)));
    if (!row) throw new Error('404');
    if (init?.method === 'PATCH') {
      const body = JSON.parse(init.body ?? '{}');
      mockPatches.push({ identity, id: decodeURIComponent(id), body });
      Object.assign(row, body);
    }
    return { ...row };
  }),
};
const mockPairedState = { host: mockHost, message: 'Connected', state: 'connected' };
const mockStore = {
  cancelPending: jest.fn(), client: jest.fn(() => mockPairedClient), forget: jest.fn(), pair: jest.fn(),
  refresh: jest.fn(async () => mockPairedState), restore: jest.fn(async () => mockPairedState),
  revoke: jest.fn(), setAccountUserId: jest.fn(), snapshot: jest.fn(() => mockPairedState), supports: jest.fn(() => true),
};

const mockPromptAsync = jest.fn(async (_input: unknown) => ({ data: undefined }));
const mockSdkClient = {
  __opencode: { directory: PROJECT_ID, gateway: true },
  session: { promptAsync: mockPromptAsync, status: jest.fn(async () => ({ data: {} })) },
};
const mockSession = {
  id: SDK_ID, projectId: PROJECT_ID, title: 'Ordinary', time: { created: 1, updated: 2 },
  rhythm: {
    localSessionId: 'local-ordinary', profileId: 'secretary', opencodeAgentId: 'build', profileAvailability: 'available',
    providerId: 'openai', modelId: 'gpt-5', thinkingBudget: null, permissionMode: 'default',
  },
};

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual.Platform, 'OS', { value: 'ios' });
  Object.defineProperty(actual.AppState, 'currentState', { configurable: true, value: 'active' });
  return actual;
});
jest.mock('@opencode-ai/sdk/v2/client', () => ({ createOpencodeClient: jest.fn() }), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), removeItem: jest.fn(async () => undefined), setItem: jest.fn(async () => undefined) },
}));
jest.mock('@/lib/security/connection-account-scope', () => ({
  runPairedHostStateTransition: jest.fn(async (operation: () => Promise<unknown>) => operation()),
}));
jest.mock('@/lib/security/connection-credential-store', () => ({ purgeDirectMacStateForUser: jest.fn(async () => undefined) }));
jest.mock('@rhythm/mobile-runtime', () => ({
  mobileRuntimeVariant: { createPairedHostStore: () => mockStore, serverUrl: 'http://127.0.0.1:4096' },
}));
jest.mock('@/providers/rhythm-account-provider', () => ({ useRhythmAccount: () => ({ user: { id: 1387 } }) }));
jest.mock('@/providers/use-opencode-persistence', () => ({
  useOpencodePersistence: ({ setActiveProjectPath }: { setActiveProjectPath: (path: string) => void }) => {
    const R = jest.requireActual<typeof import('react')>('react');
    R.useEffect(() => { setActiveProjectPath(PROJECT_ID); }, [setActiveProjectPath]);
    return { isHydrated: true };
  },
}));
jest.mock('@/lib/opencode/client', () => ({
  ...jest.requireActual('@/lib/opencode/client'),
  buildClient: (settings: { directory?: string }, gateway?: { projectId?: string }) => ({
    ...mockSdkClient, __opencode: { directory: gateway?.projectId || settings.directory || '', gateway: Boolean(gateway) },
  }),
  listPendingInteractions: jest.fn(async () => ({ permissions: [], questions: [] })),
}));
// Real settings get/patch; everything else in the gateway service is stubbed.
jest.mock('@/providers/services/mobile-gateway-service', () => ({
  ...jest.requireActual('@/providers/services/mobile-gateway-service'),
  listMobileGatewayProjects: jest.fn(async () => [{ id: PROJECT_ID, name: 'Rhythm', icon: null }]),
  listMobileGatewayProfiles: jest.fn(async () => []),
  updateMobileSessionProfileState: jest.fn(async () => mockRows.get(rowKey('sdk', SDK_ID))),
}));
jest.mock('@/providers/services/session-service', () => ({
  listArchivedSessions: jest.fn(async () => []),
  listCommands: jest.fn(async () => []),
  listSessions: jest.fn(async () => ({ sessions: [mockSession], statuses: {} })),
  getSessionMessages: jest.fn(async () => ({ records: [], nextCursor: undefined })),
  getSessionDiff: jest.fn(async () => []),
  getSessionTodos: jest.fn(async () => []),
}));
jest.mock('@/providers/services/capabilities-service', () => ({
  discoverChatCapabilities: jest.fn(async () => ({
    agents: [], config: { enabled_providers: ['openai'], model: 'openai/gpt-5' }, configuredModels: [],
    connected: ['openai'], models: [], providerAuthMethodsById: {}, providers: [],
  })),
}));
jest.mock('@/providers/services/diagnostics-service', () => ({ loadDiagnostics: jest.fn(async () => undefined) }));
jest.mock('@/providers/services/mcp-service', () => ({ getMcpStatus: jest.fn(async () => ({})) }));
jest.mock('@/providers/services/terminal-service', () => ({ listShells: jest.fn(async () => []), listTerminals: jest.fn(async () => []) }));
jest.mock('@/providers/services/workspace-service', () => ({
  getFileStatus: jest.fn(async () => []), getVcsInfo: jest.fn(async () => undefined), listWorktrees: jest.fn(async () => []),
}));
jest.mock('@/providers/services/post-prompt-refresh', () => ({
  ...jest.requireActual('@/providers/services/post-prompt-refresh'),
  pollForNewAssistantTurn: jest.fn(async () => undefined),
}));
jest.mock('@/lib/opencode/global-event-stream', () => ({
  streamDirectGlobalEvents: jest.fn(),
  streamPairedGlobalEvents: jest.fn((_c: unknown, _p: string, signal: AbortSignal) => ({
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<IteratorResult<unknown>>((resolve) => {
        const finish = () => resolve({ done: true, value: undefined });
        if (signal.aborted) finish(); else signal.addEventListener('abort', finish, { once: true });
      }) };
    },
  })),
}));
jest.mock('@/lib/notifications', () => ({
  clearPendingTaskFinishedNotification: jest.fn(async () => undefined),
  notifyQuestionRequired: jest.fn(async () => undefined),
  notifyTaskFinished: jest.fn(async () => undefined),
  trackPendingTaskFinishedNotification: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/speech-output', () => ({ speakText: jest.fn(async () => false), stopSpeaking: jest.fn(async () => undefined) }));
jest.mock('@/lib/voice/working-sound', () => ({
  startWorkingSoundAsync: jest.fn(async () => false), stopWorkingSoundAsync: jest.fn(async () => undefined),
  unloadWorkingSoundAsync: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/use-speech-input', () => ({
  useSpeechInput: () => ({
    abort: jest.fn(), error: undefined, errorCode: undefined, isAvailable: false, isListening: false,
    isStarting: false, level: 0, start: jest.fn(async () => false), stop: jest.fn(), supportsLocalRecognition: false,
  }),
}));
jest.mock('@/providers/use-conversation-keep-awake', () => ({ useConversationKeepAwake: jest.fn() }));
jest.mock('@/providers/use-conversation-screen-dim', () => ({ useConversationScreenDim: jest.fn() }));

let api!: ReturnType<typeof useOpencode>;
function Probe() { api = useOpencode(); return null; }

const ordinaryRow = () => mockRows.get(rowKey('sdk', SDK_ID))!;
const primaryRow = () => mockRows.get(rowKey('local-primary', PRIMARY_ID))!;
const patchesFor = (identity: string) => mockPatches.filter((p) => p.identity === identity);

describe('chat settings survive normal chat <-> Rhythm primary transitions', () => {
  beforeEach(() => {
    mockRows.clear(); mockPatches.length = 0; mockPromptAsync.mockClear();
    seed('sdk', SDK_ID); seed('local-primary', PRIMARY_ID);
  });
  afterEach(cleanup);

  test('each surface keeps its own model / reasoning / Fast and the next ordinary send uses them', async () => {
    render(<PairedHostProvider><OpencodeProvider><Probe /></OpencodeProvider></PairedHostProvider>);
    await waitFor(() => expect(api.sessions.some((s) => s.id === SDK_ID)).toBe(true));
    await act(async () => { await api.openSession(SDK_ID); });
    await act(async () => { await api.loadSessionSettings(SDK); await api.loadSessionSettings(PRIMARY); });
    await waitFor(() => expect(api.sessionSettings).toBeDefined());

    // 1. Ordinary chat: model + reasoning + Fast.
    const ordinaryEdit = { modelMode: 'fixed', providerId: 'openai', modelId: 'gpt-5-mini', thinkingBudget: 8192, fastMode: true } as const;
    await act(async () => { await api.updateSessionSettings(SDK, ordinaryEdit); });

    // 2. Switch to the Rhythm primary surface and give it different values.
    const primaryEdit = { modelMode: 'fixed', providerId: 'anthropic', modelId: 'claude-opus', thinkingBudget: 1024, fastMode: false } as const;
    await act(async () => { await api.updateSessionSettings(PRIMARY, primaryEdit); });

    // Provider-held per-surface state: the Rhythm write must not overwrite the ordinary chat's entry.
    const entry = (target: typeof SDK | typeof PRIMARY) => {
      const e = api.sessionSettings[sessionSettingsKey(PROJECT_ID, target)];
      return e && e.status === 'ready' ? e.state : undefined;
    };
    expect(entry(SDK)).toMatchObject({ settingsIdentity: 'sdk', modelId: 'gpt-5-mini', thinkingBudget: 8192, fastMode: true });
    expect(entry(PRIMARY)).toMatchObject({ settingsIdentity: 'local-primary', modelId: 'claude-opus', thinkingBudget: 1024, fastMode: false });

    // 3. Switch back to the ordinary chat (re-open + re-probe, as the UI does).
    await act(async () => { await api.openSession(SDK_ID); await api.loadSessionSettings(SDK); });

    // (b) transport: each PATCH carried only its own values; none leaked across identities.
    expect(patchesFor('sdk').map((p) => p.body)).toEqual([ordinaryEdit]);
    expect(patchesFor('local-primary').map((p) => p.body)).toEqual([primaryEdit]);
    expect(ordinaryRow()).toMatchObject({ modelId: 'gpt-5-mini', thinkingBudget: 8192, fastMode: true });
    expect(primaryRow()).toMatchObject({ providerId: 'anthropic', modelId: 'claude-opus', thinkingBudget: 1024, fastMode: false });

    // (a) ordinary selection unchanged, and the next send dispatches it.
    expect(api.chatPreferences).toMatchObject({ modelId: 'openai/gpt-5-mini', reasoning: 'high', fastMode: true });
    await act(async () => { await api.sendPrompt(SDK_ID, 'hello'); });
    expect(mockPromptAsync).toHaveBeenCalledTimes(1);
    expect(mockPromptAsync.mock.calls[0][0]).toMatchObject({
      sessionID: SDK_ID, model: { providerID: 'openai', modelID: 'gpt-5-mini' },
    });
    // The send must not rewrite the ordinary row with the Rhythm surface's values.
    expect(ordinaryRow()).toMatchObject({ providerId: 'openai', modelId: 'gpt-5-mini', thinkingBudget: 8192, fastMode: true });
    expect(patchesFor('local-primary')).toHaveLength(1);
  });
});
