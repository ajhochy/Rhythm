import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import AgentChatDetailScreen from '@/app/agents/chats/[sessionId]';
import { OpencodeProvider } from '@/providers/opencode-provider';
import {
  PairedHostProvider,
  usePairedHost,
} from '@/providers/paired-host-provider';

const PROJECT_ID = '59243d52-8a77-4d81-94e8-df8d6acec734';
const SESSION_ID = 'ses_0075a8b2fffe3nXy5pBAsc1V6L';
const MIRRORED_TEXT = 'served from the relay mirror after a cold offline relaunch';

const mockBoundaryTrace: string[] = [];
let mockMacOnline = false;
let mockMirrorComplete = true;
let mockRefreshPairedHost: (() => Promise<unknown>) | undefined;
const mockHost = {
  contractFingerprint: 'contract',
  deviceId: 'iphone-cold-relaunch',
  deviceName: 'Rhythm iPhone',
  features: ['pairing', 'device-revocation', 'project-scope', 'opencode-http-proxy'],
  gatewayUrl: 'https://rhythm-mac.invalid',
  gatewayVersion: '1',
  hostId: 'rhythm-mac',
  minimumMobileVersion: '1.0.8',
  opencodeVersion: '1.14.49',
  pairedAt: '2026-08-12T00:00:00.000Z',
  relayUrl: 'https://api.vcrcapps.com/relay',
  rhythmUserId: 1387,
  rhythmVersion: '1.0.8',
};

const mockPairedClient = {
  fetchResponse: jest.fn(async (path: string) => {
    mockBoundaryTrace.push(`fetch:${path}`);
    if (!mockMacOnline && !mockMirrorComplete) {
      return new Response(JSON.stringify({ error: 'mac_offline' }), {
        headers: { 'content-type': 'application/json' },
        status: 503,
      });
    }
    if (
      path.startsWith('/mobile-gateway/opencode/experimental/session') ||
      path.startsWith('/mobile-gateway/chat-catalog')
    ) {
      return new Response(JSON.stringify([mockSession]), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }
    if (
      path.startsWith(
        `/mobile-gateway/opencode/session/${SESSION_ID}/message`,
      )
    ) {
      return new Response(JSON.stringify(mockMirroredMessages), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }
    if (path.startsWith('/mobile-gateway/opencode/session/status')) {
      return new Response(JSON.stringify({}), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }
    if (path.startsWith('/mobile-gateway/opencode/session')) {
      return new Response(JSON.stringify([mockSession]), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({
        error: mockMacOnline ? `not_found:${path}` : 'mac_offline',
      }),
      {
        headers: { 'content-type': 'application/json' },
        status: mockMacOnline ? 404 : 503,
      },
    );
  }),
  origin: () => 'https://api.vcrcapps.com',
  request: jest.fn(async (path: string) => {
    if (path === '/mobile-gateway/health') {
      mockBoundaryTrace.push(`health:mac-${mockMacOnline ? 'online' : 'offline'}`);
      return { status: 'ready', macOnline: mockMacOnline };
    }
    if (path === '/mobile-gateway/projects') {
      mockBoundaryTrace.push(`projects:mac-${mockMacOnline ? 'online' : 'offline'}`);
      if (mockMacOnline) {
        return { projects: [{ id: PROJECT_ID, name: 'Rhythm', icon: null }] };
      }
      throw new Error(
        'Rhythm Cloud Gateway cannot reach your Mac. Check that Rhythm is running on the Mac and try again.',
      );
    }
    throw new Error(`Unexpected paired request: ${path}`);
  }),
};

const mockSession = {
  id: SESSION_ID,
  projectId: PROJECT_ID,
  title: 'Relay QA Renamed',
  time: { created: 1, updated: 2 },
};

const mockMirroredMessages = [{
  info: {
    id: 'msg_offline_mirror',
    role: 'assistant',
    sessionID: SESSION_ID,
    time: { created: 2 },
  },
  parts: [{
    id: 'prt_offline_mirror',
    messageID: 'msg_offline_mirror',
    sessionID: SESSION_ID,
    text: MIRRORED_TEXT,
    type: 'text',
  }],
}];

const mockCreateSdkClient = jest.fn(
  (options: { fetch: (input: string, init?: RequestInit) => Promise<Response> }) => {
    const request = async (
      path: string,
      init: RequestInit = {},
    ): Promise<{ data?: unknown; response?: Response }> => {
      const response = await options.fetch(`https://api.vcrcapps.com${path}`, init);
      const text = await response.text();
      const data = text ? JSON.parse(text) : undefined;
      if (!response.ok) {
        throw Object.assign(new Error(String(data?.error ?? response.status)), {
          status: response.status,
        });
      }
      return { data, response };
    };
    const appSkills = jest.fn(async () => ({ data: [] }));
    return {
      app: { skills: appSkills },
      experimental: {
        session: {
          list: (
            params: Record<string, unknown>,
            requestOptions?: { headers?: Record<string, string> },
          ) => {
            const query = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
              if (value !== undefined) query.set(key, String(value));
            });
            return request(`/experimental/session?${query}`, {
              headers: requestOptions?.headers,
              method: 'GET',
            });
          },
        },
      },
      permission: { list: () => Promise.resolve({ data: [] }) },
      question: { list: () => Promise.resolve({ data: [] }) },
      session: {
        diff: () => Promise.resolve({ data: [] }),
        list: () => request('/session', { method: 'GET' }),
        messages: ({ sessionID }: { sessionID: string }) =>
          request(`/session/${encodeURIComponent(sessionID)}/message`, {
            method: 'GET',
          }),
        status: () => request('/session/status', { method: 'GET' }),
        todo: () => Promise.resolve({ data: [] }),
      },
    };
  },
);

let mockStoreState: 'unpaired' | 'connected';
const mockRefreshStore = jest.fn(async () => {
  await mockPairedClient.request('/mobile-gateway/health');
  return {
    host: mockHost,
    message: 'Connected securely to your Mac through Rhythm Cloud Gateway.',
    state: 'connected' as const,
  };
});
const mockStore = {
  cancelPending: jest.fn(),
  client: jest.fn(() =>
    mockStoreState === 'connected' ? mockPairedClient : null,
  ),
  forget: jest.fn(),
  pair: jest.fn(),
  refresh: mockRefreshStore,
  restore: jest.fn(async () => {
    // Preserve the physical cold-process ordering: route/provider effects run
    // once against the empty initial snapshot before secure pairing restore
    // publishes the authenticated relay client.
    await new Promise((resolve) => setTimeout(resolve, 25));
    mockStoreState = 'connected';
    mockBoundaryTrace.push('paired-host-restored');
    return mockRefreshStore();
  }),
  revoke: jest.fn(),
  setAccountUserId: jest.fn(),
  snapshot: jest.fn(() => ({
    host: mockStoreState === 'connected' ? mockHost : null,
    message:
      mockStoreState === 'connected'
        ? 'Connected securely to your Mac through Rhythm Cloud Gateway.'
        : 'Pair this iPhone with your Mac to use Rhythm Agents.',
    state: mockStoreState,
  })),
  supports: jest.fn(() => true),
};

jest.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: (options: unknown) =>
    mockCreateSdkClient(
      options as Parameters<typeof mockCreateSdkClient>[0],
    ),
}), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    removeItem: jest.fn(async () => undefined),
    setItem: jest.fn(async () => undefined),
  },
}));
jest.mock('@/lib/security/connection-account-scope', () => ({
  runPairedHostStateTransition: jest.fn(async (operation: () => Promise<unknown>) => operation()),
}));
jest.mock('@/lib/security/connection-credential-store', () => ({
  purgeDirectMacStateForUser: jest.fn(async () => undefined),
}));

jest.mock('@rhythm/mobile-runtime', () => ({
  mobileRuntimeVariant: {
    createPairedHostStore: () => mockStore,
    serverUrl: 'http://127.0.0.1:4096',
  },
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => ({ user: { id: 1387 } }),
}));

jest.mock('@/providers/use-opencode-persistence', () => ({
  useOpencodePersistence: ({
    setActiveProjectPath,
  }: {
    setActiveProjectPath: (projectId: string) => void;
  }) => {
    const React = jest.requireActual<typeof import('react')>('react');
    const [isHydrated, setIsHydrated] = React.useState(false);
    React.useEffect(() => {
      const timeout = setTimeout(() => {
        setActiveProjectPath(PROJECT_ID);
        setIsHydrated(true);
      }, 50);
      return () => clearTimeout(timeout);
    }, [setActiveProjectPath]);
    return { isHydrated };
  },
}));

jest.mock('@/components/chat/chat-view', () => ({
  ChatView: () => {
    const { Text } = jest.requireActual('react-native');
    const { ChatHeader } = jest.requireActual('@/components/chat/chat-header');
    const { Colors } = jest.requireActual('@/constants/theme');
    const { useOpencode } = jest.requireActual('@/providers/opencode-provider');
    const {
      connection,
      currentSessionId,
      currentTranscript,
      sessions,
    } = useOpencode();
    const selectedSession = sessions.find(
      (session: { id: string }) => session.id === currentSessionId,
    );
    return (
      <>
        <ChatHeader
          availableModels={[]}
          availableProfiles={[]}
          availableProviders={[]}
          chatPreferences={{}}
          connectionStatus={connection.status}
          conversation={{ active: false, phase: 'off' }}
          currentSessionId={currentSessionId}
          diffCount={0}
          insetsTop={0}
          isCreatingSession={false}
          isUsageLoading={false}
          onBack={() => undefined}
          onCloseMenu={() => undefined}
          onConfirmStopConversation={() => undefined}
          onCreateSession={() => undefined}
          onManage={() => undefined}
          onOpenSession={() => undefined}
          onOpenSessionMenu={() => undefined}
          onOpenSettings={() => undefined}
          onShowChanges={() => undefined}
          onToggleConversationMode={() => undefined}
          onUpdateSessionPreferences={async () => ({})}
          palette={Colors.light}
          running={false}
          selectedSession={selectedSession}
          sessionMenuVisible={false}
          sessions={sessions}
          showingChanges={false}
          usage={{
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            completedSteps: 0,
            cost: 0,
            costStatus: 'free',
            inputTokens: 0,
            outputTokens: 0,
            providers: [],
            reasoningTokens: 0,
          }}
        />
        <Text>
          {currentTranscript
            .map((entry: { text: string }) => entry.text)
            .join('\n')}
        </Text>
      </>
    );
  },
}));

jest.mock('@/components/chat/session-configuration-sheet', () => ({
  SessionConfigurationSheet: () => null,
}));

jest.mock('@/providers/services/capabilities-service', () => ({
  discoverChatCapabilities: jest.fn(async () => ({
    agents: [], config: {}, configuredModels: [], connected: [], models: [],
    providerAuthMethodsById: {}, providers: [],
  })),
}));
jest.mock('@/providers/services/diagnostics-service', () => ({ loadDiagnostics: jest.fn(async () => undefined) }));
jest.mock('@/providers/services/mcp-service', () => ({ getMcpStatus: jest.fn(async () => ({})) }));
jest.mock('@/providers/services/terminal-service', () => ({
  listShells: jest.fn(async () => []), listTerminals: jest.fn(async () => []),
}));
jest.mock('@/providers/services/workspace-service', () => ({
  getFileStatus: jest.fn(async () => []), getVcsInfo: jest.fn(), listWorktrees: jest.fn(async () => []),
}));
jest.mock('@/lib/opencode/global-event-stream', () => ({
  streamDirectGlobalEvents: jest.fn(),
  streamPairedGlobalEvents: jest.fn(
    (_client: unknown, _projectId: string, signal: AbortSignal) => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>((resolve) => {
            const finish = () => resolve({ done: true, value: undefined });
            if (signal.aborted) finish();
            else signal.addEventListener('abort', finish, { once: true });
          }),
        };
      },
    }),
  ),
}));
jest.mock('@/lib/notifications', () => ({
  clearPendingTaskFinishedNotification: jest.fn(async () => undefined),
  notifyTaskFinished: jest.fn(async () => undefined),
  trackPendingTaskFinishedNotification: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/speech-output', () => ({
  speakText: jest.fn(async () => false), stopSpeaking: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/working-sound', () => ({
  startWorkingSoundAsync: jest.fn(async () => undefined),
  stopWorkingSoundAsync: jest.fn(async () => undefined),
  unloadWorkingSoundAsync: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/use-speech-input', () => ({
  useSpeechInput: () => ({
    abort: jest.fn(), error: undefined, errorCode: undefined, isAvailable: false,
    isListening: false, isStarting: false, level: 0, start: jest.fn(), stop: jest.fn(),
    supportsLocalRecognition: false,
  }),
}));
jest.mock('@/providers/use-conversation-keep-awake', () => ({ useConversationKeepAwake: jest.fn() }));
jest.mock('@/providers/use-conversation-screen-dim', () => ({ useConversationScreenDim: jest.fn() }));

function PairedRefreshHarness() {
  const { refresh } = usePairedHost();
  React.useEffect(() => {
    mockRefreshPairedHost = refresh;
    return () => {
      mockRefreshPairedHost = undefined;
    };
  }, [refresh]);
  return null;
}

describe('issue-1387 cold offline chat hydration', () => {
  beforeEach(() => {
    mockStoreState = 'unpaired';
    mockMacOnline = false;
    mockMirrorComplete = true;
    mockRefreshPairedHost = undefined;
    mockBoundaryTrace.length = 0;
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test('issue-1387-c22: a complete offline mirror renders immediately after cold pairing hydration', async () => {
    // Regression caught: AgentChatDetailScreen opens while the cold provider
    // still has its initial unpaired snapshot. That offline terminal state is
    // sticky, so paired-host restore and the available relay mirror never get
    // another open attempt. The transcript/Offline assertions fail if the
    // screen remains terminal or incorrectly claims a live connection.
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <PairedRefreshHarness />
          <OpencodeProvider>
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );

    await waitFor(() => {
      expect(mockBoundaryTrace).toContain('paired-host-restored');
      expect(mockBoundaryTrace).toContain('health:mac-offline');
      expect(mockBoundaryTrace).toContain('projects:mac-offline');
      expect(screen.getByText(MIRRORED_TEXT)).toBeTruthy();
    });

    expect(screen.getByLabelText('Chat status: Offline')).toBeTruthy();
    expect(screen.queryByText('Opening chat')).toBeNull();
    expect(screen.queryByLabelText('Retry')).toBeNull();
    expect(mockBoundaryTrace).toContain(
      `fetch:/mobile-gateway/opencode/session/${SESSION_ID}/message`,
    );
  });

  test('issue-1387-c24: an incomplete offline mirror auto-recovers after paired Mac refresh', async () => {
    // Regression caught: the first offline mirror read is legitimately
    // incomplete and reaches a retryable terminal state, but a later
    // successful paired-host refresh leaves it sticky until the user taps
    // Retry. The final transcript assertion fails if recovery is not automatic.
    mockMirrorComplete = false;
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <PairedRefreshHarness />
          <OpencodeProvider>
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );

    await waitFor(
      () => {
        expect(mockBoundaryTrace).toContain('paired-host-restored');
        expect(mockBoundaryTrace).toContain('health:mac-offline');
        expect(screen.getByLabelText('Retry')).toBeTruthy();
        expect(screen.queryByText(MIRRORED_TEXT)).toBeNull();
      },
      { timeout: 12_000 },
    );

    mockMacOnline = true;
    await act(async () => {
      await mockRefreshPairedHost?.();
    });
    await waitFor(
      () => {
        expect(mockBoundaryTrace).toContain('health:mac-online');
        expect(mockBoundaryTrace).toContain('projects:mac-online');
      },
      { timeout: 3_000 },
    );

    await waitFor(
      () => {
        expect(screen.getByText(MIRRORED_TEXT)).toBeTruthy();
      },
      { timeout: 5_000 },
    );
    expect(screen.getByLabelText('Chat status: Connected')).toBeTruthy();
    expect(screen.queryByText('Opening chat')).toBeNull();
    expect(screen.queryByLabelText('Retry')).toBeNull();
    expect(mockBoundaryTrace).toContain(
      `fetch:/mobile-gateway/opencode/session/${SESSION_ID}/message`,
    );
  }, 20_000);
});
