import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import AgentChatDetailScreen from '@/app/agents/chats/[sessionId]';
import { OpencodeProvider, useOpencode } from '@/providers/opencode-provider';
import {
  PairedHostProvider,
  usePairedHost,
} from '@/providers/paired-host-provider';

const PROJECT_ID = 'rhythm-owner-project';
const SESSION_ID = 'ses-relay-connected';
const PROMPT = 'Reply with exactly RELAY_FINAL and do not use tools.';
const BASELINE_TEXT = 'Relay QA baseline transcript';

let mockAcceptedPromptCount = 0;
let mockRelayOnline = true;
let mockRefreshPairedHost: (() => Promise<unknown>) | undefined;
const mockBoundaryTrace: string[] = [];

const mockHost = {
  contractFingerprint: 'contract',
  deviceId: 'iphone-contract',
  deviceName: 'Rhythm iPhone',
  features: [
    'pairing',
    'device-revocation',
    'project-scope',
    'opencode-http-proxy',
  ],
  gatewayUrl: 'https://rhythm.invalid',
  gatewayVersion: '1',
  hostId: 'mac-contract',
  minimumMobileVersion: '1.0.8',
  opencodeVersion: '1.14.49',
  pairedAt: '2026-08-12T00:00:00.000Z',
  relayUrl: 'https://api.vcrcapps.com/relay',
  rhythmUserId: 1387,
  rhythmVersion: '1.0.8',
};

const mockPairedClient = {
  origin: () => 'https://api.vcrcapps.com',
  request: jest.fn(async (path: string) => {
    if (path === '/mobile-gateway/health') {
      mockBoundaryTrace.push(
        `health:${mockRelayOnline ? 'mac-online' : 'no-uplink'}`,
      );
      if (!mockRelayOnline) {
        throw Object.assign(
          new Error('Rhythm Cloud Gateway cannot reach your Mac.'),
          { code: 'NETWORK_ERROR', status: 503 },
        );
      }
      return { status: 'ready', macOnline: true };
    }
    throw new Error(`Unexpected paired request: ${path}`);
  }),
};

type MockPairedState = 'connected' | 'tailscaleUnavailable';
let mockPairedState: MockPairedState = 'connected';

function pairedSnapshot(state: MockPairedState = mockPairedState) {
  return {
    host: mockHost,
    message:
      state === 'connected'
        ? 'Connected securely to your Mac through Rhythm Cloud Gateway.'
        : 'Rhythm Cloud Gateway cannot reach your Mac. Check that Rhythm is running on the Mac and try again.',
    state,
  };
}

const mockStore = {
  cancelPending: jest.fn(),
  client: jest.fn(() => mockPairedClient),
  forget: jest.fn(),
  pair: jest.fn(),
  refresh: jest.fn(async () => {
    try {
      await mockPairedClient.request('/mobile-gateway/health');
      mockPairedState = 'connected';
    } catch {
      mockPairedState = 'tailscaleUnavailable';
    }
    return pairedSnapshot();
  }),
  restore: jest.fn(async () => pairedSnapshot('connected')),
  revoke: jest.fn(),
  setAccountUserId: jest.fn(),
  snapshot: jest.fn(() => pairedSnapshot()),
  supports: jest.fn(() => true),
};

const mockPromptAsync = jest.fn(async () => {
  // Preserve the physical failure mechanism. The local OpenCode boundary has
  // accepted the prompt, but the relay instance disappears before the phone
  // receives the RPC response. The paired-host probe then observes no uplink.
  mockAcceptedPromptCount += 1;
  mockBoundaryTrace.push('opencode:prompt-accepted');
  mockRelayOnline = false;
  await mockRefreshPairedHost?.();
  throw Object.assign(
    new Error('Rhythm Cloud Gateway cannot reach your Mac.'),
    { code: 'NETWORK_ERROR', status: 0 },
  );
});

const mockSdkClient = {
  __opencode: { directory: PROJECT_ID, gateway: true },
  session: { promptAsync: mockPromptAsync },
};

const sessionExecutionState = {
  localSessionId: 'local-relay-connected',
  profileId: 'secretary',
  opencodeAgentId: 'build',
  profileAvailability: 'available',
  providerId: 'openai',
  modelId: 'gpt-5',
  thinkingBudget: null,
  permissionMode: 'default',
};

const session = {
  id: SESSION_ID,
  projectId: PROJECT_ID,
  title: 'Relay QA',
  time: { created: 1, updated: 2 },
  rhythm: sessionExecutionState,
};

function message(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  created: number,
) {
  return {
    info: { id, role, sessionID: SESSION_ID, time: { created } },
    parts: [
      {
        id: `${id}-part`,
        messageID: id,
        sessionID: SESSION_ID,
        text,
        type: 'text',
      },
    ],
  };
}

function mockCurrentMessages() {
  const records = [message('msg-baseline', 'assistant', BASELINE_TEXT, 1)];
  if (mockAcceptedPromptCount >= 1) {
    records.push(
      message('msg-user-final', 'user', PROMPT, 2),
      message('msg-assistant-final', 'assistant', 'RELAY_FINAL', 3),
    );
  }
  return records;
}

jest.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: jest.fn(),
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
  runPairedHostStateTransition: jest.fn(
    async (operation: () => Promise<unknown>) => operation(),
  ),
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
  useLocalSearchParams: () => ({
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
  }),
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => ({ user: { id: 1387 } }),
}));

jest.mock('@/providers/use-opencode-persistence', () => ({
  useOpencodePersistence: ({ setActiveProjectPath }: {
    setActiveProjectPath: (path: string) => void;
  }) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(() => {
      setActiveProjectPath(PROJECT_ID);
    }, [setActiveProjectPath]);
    return { isHydrated: true };
  },
}));

jest.mock('@/lib/opencode/client', () => ({
  ...jest.requireActual('@/lib/opencode/client'),
  buildClient: (
    settings: { directory?: string },
    gateway?: { projectId?: string },
  ) => ({
    ...mockSdkClient,
    __opencode: {
      directory: gateway?.projectId || settings.directory || '',
      gateway: Boolean(gateway),
    },
  }),
  listPendingInteractions: jest.fn(async () => ({
    permissions: [],
    questions: [],
  })),
}));

jest.mock('@/providers/services/mobile-gateway-service', () => {
  const { MacOfflineError } = jest.requireActual(
    '@/lib/transport/api-error',
  ) as typeof import('@/lib/transport/api-error');
  return {
  listMobileGatewayProjects: jest.fn(async () => {
    mockBoundaryTrace.push(
      `projects:${mockRelayOnline ? 'mac-online' : 'no-uplink'}`,
    );
    if (!mockRelayOnline) throw new MacOfflineError();
    return [{ id: PROJECT_ID, name: 'Rhythm', icon: null }];
  }),
  listMobileGatewayProfiles: jest.fn(async () => [{
    id: 'secretary',
    profileId: 'secretary',
    opencodeAgentId: 'build',
    label: 'Secretary',
    defaults: {
      providerId: 'openai',
      modelId: 'gpt-5',
      reasoningEffort: null,
      approvalMode: 'default',
    },
    display: { icon: 'account', color: null },
  }]),
  updateMobileSessionProfileState: jest.fn(async () => sessionExecutionState),
  };
});

jest.mock('@/providers/services/session-service', () => ({
  listArchivedSessions: jest.fn(async () => []),
  listCommands: jest.fn(async () => []),
  listSessions: jest.fn(async () => ({
    sessions: [session],
    statuses: { [SESSION_ID]: { type: 'idle' } },
  })),
  getSessionMessages: jest.fn(async () => ({
    records: mockCurrentMessages(),
    nextCursor: undefined,
  })),
  getSessionDiff: jest.fn(async () => []),
  getSessionTodos: jest.fn(async () => []),
}));

jest.mock('@/providers/services/capabilities-service', () => ({
  discoverChatCapabilities: jest.fn(async () => ({
    agents: [],
    config: { enabled_providers: ['openai'], model: 'openai/gpt-5' },
    configuredModels: [],
    connected: ['openai'],
    models: [],
    providerAuthMethodsById: {},
    providers: [],
  })),
}));

jest.mock('@/providers/services/diagnostics-service', () => ({
  loadDiagnostics: jest.fn(async () => undefined),
}));
jest.mock('@/providers/services/mcp-service', () => ({
  getMcpStatus: jest.fn(async () => ({})),
}));
jest.mock('@/providers/services/terminal-service', () => ({
  listShells: jest.fn(async () => []),
  listTerminals: jest.fn(async () => []),
}));
jest.mock('@/providers/services/workspace-service', () => ({
  getFileStatus: jest.fn(async () => []),
  getVcsInfo: jest.fn(async () => undefined),
  listWorktrees: jest.fn(async () => []),
}));
jest.mock('@/providers/services/post-prompt-refresh', () => ({
  pollForNewAssistantTurn: jest.fn(async () => undefined),
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
  speakText: jest.fn(async () => false),
  stopSpeaking: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/working-sound', () => ({
  startWorkingSoundAsync: jest.fn(async () => undefined),
  stopWorkingSoundAsync: jest.fn(async () => undefined),
  unloadWorkingSoundAsync: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/use-speech-input', () => ({
  useSpeechInput: () => ({
    abort: jest.fn(),
    error: undefined,
    errorCode: undefined,
    isAvailable: false,
    isListening: false,
    isStarting: false,
    level: 0,
    start: jest.fn(async () => false),
    stop: jest.fn(),
    supportsLocalRecognition: false,
  }),
}));
jest.mock('@/providers/use-conversation-keep-awake', () => ({
  useConversationKeepAwake: jest.fn(),
}));
jest.mock('@/providers/use-conversation-screen-dim', () => ({
  useConversationScreenDim: jest.fn(),
}));

jest.mock('@/components/chat/chat-view', () => ({
  ChatView: () => {
    const { Text } = jest.requireActual('react-native');
    const { useOpencode } = jest.requireActual('@/providers/opencode-provider');
    const { connection, currentMessages } = useOpencode();
    const transcript = currentMessages
      .flatMap((record: { parts: { text?: string }[] }) => record.parts)
      .map((part: { text?: string }) => part.text ?? '')
      .join('\n');
    return (
      <>
        <Text testID="chat-surface">Relay QA chat</Text>
        <Text testID="chat-status">{connection.status}</Text>
        <Text testID="chat-transcript">{transcript}</Text>
      </>
    );
  },
}));

function PairedRefreshHarness() {
  const { refresh, state } = usePairedHost();
  React.useEffect(() => {
    mockRefreshPairedHost = refresh;
    return () => {
      mockRefreshPairedHost = undefined;
    };
  }, [refresh]);
  return <Text testID="paired-state">{state}</Text>;
}

function SendHarness() {
  const { sendPrompt } = useOpencode();
  const [result, setResult] = React.useState('idle');
  return (
    <View>
      <Text testID="send-result">{result}</Text>
      <Pressable
        testID="send-final-prompt"
        onPress={() => {
          void sendPrompt(SESSION_ID, PROMPT)
            .then(() => setResult('transport-returned'))
            .catch(() => setResult('transport-dropped-after-acceptance'));
        }}>
        <Text>Send relay prompt</Text>
      </Pressable>
    </View>
  );
}

describe('issue-1387 send-time relay loss', () => {
  beforeEach(() => {
    mockAcceptedPromptCount = 0;
    mockRelayOnline = true;
    mockPairedState = 'connected';
    mockRefreshPairedHost = undefined;
    mockBoundaryTrace.length = 0;
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test('issue-1387-c19: a send-time uplink restart preserves the open transcript until recovery', async () => {
    // Regression caught: paired-host state is part of the provider connection
    // identity. When the real relay instance restarted during prompt RPC, the
    // connected -> tailscaleUnavailable transition cleared the selected chat,
    // replacing a readable transcript with terminal "Opening chat" even
    // though the Mac API/engine remained alive and the turn later converged.
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <PairedRefreshHarness />
          <OpencodeProvider>
            <SendHarness />
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('paired-state').props.children).toBe(
        'connected',
      );
      expect(screen.getByTestId('chat-surface')).toBeTruthy();
      expect(screen.getByTestId('chat-transcript').props.children).toContain(
        BASELINE_TEXT,
      );
    });

    fireEvent.press(screen.getByTestId('send-final-prompt'));

    await waitFor(() => {
      expect(mockBoundaryTrace).toContain('opencode:prompt-accepted');
      expect(mockBoundaryTrace).toContain('health:no-uplink');
      expect(screen.getByTestId('paired-state').props.children).toBe(
        'tailscaleUnavailable',
      );
      expect(screen.getByTestId('send-result').props.children).toBe(
        'transport-dropped-after-acceptance',
      );
    });

    // This is the strengthened assertion that is RED on the current code.
    // A transient uplink loss may disable writes, but it must not replace the
    // already-open, readable transcript with the route's loading terminal.
    expect(screen.queryByText('Opening chat')).toBeNull();
    expect(screen.getByTestId('chat-surface')).toBeTruthy();
    expect(screen.getByTestId('chat-transcript').props.children).toContain(
      BASELINE_TEXT,
    );

    mockRelayOnline = true;
    await act(async () => {
      await mockRefreshPairedHost?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('paired-state').props.children).toBe(
        'connected',
      );
      expect(screen.getByTestId('chat-surface')).toBeTruthy();
      expect(screen.getByTestId('chat-transcript').props.children).toContain(
        PROMPT,
      );
      expect(screen.getByTestId('chat-transcript').props.children).toContain(
        'RELAY_FINAL',
      );
    });
    expect(screen.queryByText('Opening chat')).toBeNull();
  }, 20_000);
});
