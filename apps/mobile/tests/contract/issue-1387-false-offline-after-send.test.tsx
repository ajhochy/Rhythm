import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import AgentChatDetailScreen from '@/app/agents/chats/[sessionId]';
import { OpencodeProvider, useOpencode } from '@/providers/opencode-provider';
import {
  PairedHostProvider,
  usePairedHost,
} from '@/providers/paired-host-provider';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual.Platform, 'OS', { value: 'ios' });
  Object.defineProperty(actual.AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  return actual;
});

const PROJECT_ID = 'rhythm-owner-project';
const SESSION_ID = 'ses-relay-connected';
const PROMPT = 'Reply with exactly RELAY_FINAL and do not use tools.';
const BASELINE_TEXT = 'Relay QA baseline transcript';

let mockAcceptedPromptCount = 0;
let mockRelayOnline = true;
let mockRefreshPairedHost: (() => Promise<unknown>) | undefined;
const mockBoundaryTrace: string[] = [];
let mockLatestSubmission: Promise<boolean> | undefined;
let mockPersistenceError: Error | undefined;
let mockReconciliationReadsFail = false;
let mockSessionStatus: 'busy' | 'idle' = 'idle';
let mockWorkingSoundActive = false;
let mockPendingQuestions: {
  id: string;
  sessionID: string;
  questions: {
    custom: boolean;
    header: string;
    multiple: boolean;
    options: never[];
    question: string;
  }[];
}[] = [];
let mockPromptOutcome:
  | 'accepted-then-offline'
  | 'accepted-visible'
  | 'not-accepted' =
  'accepted-then-offline';

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
  healthResponse: jest.fn(async () => {
    mockBoundaryTrace.push(
      `health:${mockRelayOnline ? 'mac-online' : 'no-uplink'}`,
    );
    return new Response(
      JSON.stringify(
        mockRelayOnline
          ? { status: 'ready', macOnline: true }
          : { error: 'mac_offline' },
      ),
      {
        headers: { 'content-type': 'application/json' },
        status: mockRelayOnline ? 200 : 503,
      },
    );
  }),
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
  if (mockPromptOutcome === 'not-accepted') {
    mockBoundaryTrace.push('opencode:prompt-not-accepted');
    throw new Error('OpenCode rejected the prompt before accepting it.');
  }
  // Preserve the physical failure mechanism. The local OpenCode boundary has
  // accepted the prompt, but the relay instance disappears before the phone
  // receives the RPC response. The paired-host probe then observes no uplink.
  mockAcceptedPromptCount += 1;
  mockBoundaryTrace.push('opencode:prompt-accepted');
  if (mockPromptOutcome === 'accepted-then-offline') {
    mockRelayOnline = false;
    await mockRefreshPairedHost?.();
  }
  throw Object.assign(
    new Error('Rhythm Cloud Gateway cannot reach your Mac.'),
    { code: 'NETWORK_ERROR', status: 0 },
  );
});

const mockSdkClient = {
  __opencode: { directory: PROJECT_ID, gateway: true },
  session: {
    promptAsync: mockPromptAsync,
    status: jest.fn(async () => {
      if (mockReconciliationReadsFail) throw new Error('status unavailable');
      return { data: { [SESSION_ID]: { type: mockSessionStatus } } };
    }),
  },
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
const mockOtherSession = {
  ...session,
  id: 'ses-other',
  title: 'Other planning chat',
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
  useOpencodePersistence: ({ setActiveProjectPath, setChatPreferences }: {
    setActiveProjectPath: (path: string) => void;
    setChatPreferences: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  }) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(() => {
      setActiveProjectPath(PROJECT_ID);
      setChatPreferences((current) => ({
        ...current,
        workingSoundEnabled: true,
      }));
    }, [setActiveProjectPath, setChatPreferences]);
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
    questions: mockPendingQuestions,
  })),
  rejectPendingQuestion: jest.fn(async () => undefined),
  replyToPendingQuestion: jest.fn(async () => undefined),
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
  updateMobileSessionProfileState: jest.fn(async () => {
    if (mockPersistenceError) throw mockPersistenceError;
    return sessionExecutionState;
  }),
  };
});

jest.mock('@/providers/services/session-service', () => ({
  listArchivedSessions: jest.fn(async () => []),
  listCommands: jest.fn(async () => []),
  listSessions: jest.fn(async () => ({
    sessions: [session, mockOtherSession],
    statuses: { [SESSION_ID]: { type: mockSessionStatus } },
  })),
  getSessionMessages: jest.fn(async () => {
    if (
      mockReconciliationReadsFail ||
      (mockPromptOutcome === 'accepted-then-offline' && !mockRelayOnline)
    ) {
      throw new Error('messages unavailable');
    }
    return {
      records: mockCurrentMessages(),
      nextCursor: undefined,
    };
  }),
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
jest.mock('@/providers/services/post-prompt-refresh', () => {
  const actual = jest.requireActual('@/providers/services/post-prompt-refresh');
  return {
    ...actual,
    pollForNewAssistantTurn: jest.fn(async () => undefined),
  };
});

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
  notifyQuestionRequired: jest.fn(async () => undefined),
  notifyTaskFinished: jest.fn(async () => undefined),
  trackPendingTaskFinishedNotification: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/speech-output', () => ({
  speakText: jest.fn(async () => false),
  stopSpeaking: jest.fn(async () => undefined),
}));
jest.mock('@/lib/voice/working-sound', () => ({
  startWorkingSoundAsync: jest.fn(async () => {
    mockWorkingSoundActive = true;
    return true;
  }),
  stopWorkingSoundAsync: jest.fn(async () => {
    mockWorkingSoundActive = false;
  }),
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
  const { chatPreferences, promptError, sendPrompt, sendingState } = useOpencode();
  const [result, setResult] = React.useState('idle');
  const [draft, setDraft] = React.useState(PROMPT);
  const [settledCount, setSettledCount] = React.useState(0);
  return (
    <View>
      <Text testID="send-result">{result}</Text>
      <Text testID="send-draft">{draft}</Text>
      <Text testID="send-error">{promptError?.message ?? ''}</Text>
      <Text testID="send-settled-count">{settledCount}</Text>
      <Text testID="send-working-sound-enabled">
        {String(chatPreferences.workingSoundEnabled)}
      </Text>
      <Text testID="send-active">{String(sendingState.active)}</Text>
      <Text testID="platform-os">{Platform.OS}</Text>
      <Pressable
        testID="send-final-prompt"
        onPress={() => {
          setDraft('');
          mockLatestSubmission = sendPrompt(SESSION_ID, PROMPT);
          void mockLatestSubmission
            .then((accepted) => {
              setResult(accepted ? 'transport-returned' : 'not-submitted');
              if (!accepted) setDraft(PROMPT);
              setSettledCount((current) => current + 1);
            })
            .catch(() => {
              setResult('definitive-rejection');
              setDraft(PROMPT);
              setSettledCount((current) => current + 1);
            });
        }}>
        <Text>Send relay prompt</Text>
      </Pressable>
    </View>
  );
}

function PendingQuestionHarness() {
  const {
    currentSessionId,
    currentPendingQuestions,
    pendingQuestionSessionIds,
    rejectQuestion,
    refreshCurrentSession,
    replyToQuestion,
  } = useOpencode();
  return (
    <View>
      <Text testID="pending-question-current-session">
        {currentSessionId ?? ''}
      </Text>
      <Text testID="pending-question-session-ids">
        {pendingQuestionSessionIds.join(',')}
      </Text>
      <Text testID="pending-question-current-count">
        {String(currentPendingQuestions.length)}
      </Text>
      <Text testID="pending-question-provider-mounted">mounted</Text>
      <Pressable
        testID="refresh-pending-questions"
        onPress={() => void refreshCurrentSession()}>
        <Text>Refresh pending questions</Text>
      </Pressable>
      <Pressable
        testID="reply-current-question"
        onPress={() => {
          const request = currentPendingQuestions[0];
          if (request) void replyToQuestion(request.id, [['Continue']]);
        }}>
        <Text>Reply to current question</Text>
      </Pressable>
      <Pressable
        testID="reject-current-question"
        onPress={() => {
          const request = currentPendingQuestions[0];
          if (request) void rejectQuestion(request.id);
        }}>
        <Text>Reject current question</Text>
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
    mockLatestSubmission = undefined;
    mockPersistenceError = undefined;
    mockReconciliationReadsFail = false;
    mockSessionStatus = 'idle';
    mockWorkingSoundActive = false;
    mockPendingQuestions = [];
    mockPromptOutcome = 'accepted-then-offline';
  });

  test('task-mobile-question-state-c1-c6: all pending sessions publish and request IDs dedupe until resolved', async () => {
    // Regression caught: provider exposes only the open session, repeats notifications on refresh,
    // or never permits a genuinely reintroduced request to notify again after resolution.
    mockPendingQuestions = [
      {
        id: 'question-current',
        sessionID: SESSION_ID,
        questions: [{
          custom: false,
          header: 'Current',
          multiple: false,
          options: [],
          question: 'Current question?',
        }],
      },
      {
        id: 'question-other',
        sessionID: 'ses-other',
        questions: [{
          custom: false,
          header: 'Other',
          multiple: false,
          options: [],
          question: 'Other question?',
        }],
      },
    ];
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <OpencodeProvider>
            <PendingQuestionHarness />
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );
    const notifyQuestionRequired = jest.requireMock(
      '@/lib/notifications',
    ).notifyQuestionRequired;

    await waitFor(() => {
      expect(screen.getByTestId('pending-question-session-ids').props.children).toBe(
        `${SESSION_ID},ses-other`,
      );
      expect(screen.getByTestId('pending-question-current-session').props.children).toBe(
        SESSION_ID,
      );
      expect(notifyQuestionRequired).toHaveBeenCalledTimes(2);
    });
    expect(notifyQuestionRequired).toHaveBeenCalledWith(
      'Relay QA',
      expect.objectContaining({ header: 'Current' }),
    );
    expect(notifyQuestionRequired).toHaveBeenCalledWith(
      'Other planning chat',
      expect.objectContaining({ header: 'Other' }),
    );

    fireEvent.press(screen.getByTestId('refresh-pending-questions'));
    await waitFor(() => expect(notifyQuestionRequired).toHaveBeenCalledTimes(2));

    mockPendingQuestions = [];
    fireEvent.press(screen.getByTestId('refresh-pending-questions'));
    await waitFor(() => {
      expect(screen.getByTestId('pending-question-session-ids').props.children).toBe('');
    });

    mockPendingQuestions = [
      {
        id: 'question-other',
        sessionID: 'ses-other',
        questions: [{
          custom: false,
          header: 'Other',
          multiple: false,
          options: [],
          question: 'Other question?',
        }],
      },
    ];
    fireEvent.press(screen.getByTestId('refresh-pending-questions'));
    await waitFor(() => expect(notifyQuestionRequired).toHaveBeenCalledTimes(3));
  });

  test('task-mobile-question-state-c7: notification rejection preserves pending state, dedupe, reply, and reject', async () => {
    // Regression caught: a rejected native notification promise escapes the provider effect,
    // unmounts the consumer, duplicates on refresh, or breaks question resolution actions.
    mockPendingQuestions = [{
      id: 'question-notification-fails',
      sessionID: SESSION_ID,
      questions: [{
        custom: false,
        header: 'Failure path',
        multiple: false,
        options: [],
        question: 'Can this still be answered?',
      }],
    }];
    const notifyQuestionRequired = jest.requireMock(
      '@/lib/notifications',
    ).notifyQuestionRequired;
    notifyQuestionRequired.mockRejectedValueOnce(new Error('notifications unavailable'));
    const replyToPendingQuestion = jest.requireMock(
      '@/lib/opencode/client',
    ).replyToPendingQuestion;
    const rejectPendingQuestion = jest.requireMock(
      '@/lib/opencode/client',
    ).rejectPendingQuestion;
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <OpencodeProvider>
            <PendingQuestionHarness />
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('pending-question-session-ids').props.children).toBe(SESSION_ID);
      expect(screen.getByTestId('pending-question-current-count').props.children).toBe('1');
      expect(notifyQuestionRequired).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('pending-question-provider-mounted').props.children).toBe('mounted');

    fireEvent.press(screen.getByTestId('refresh-pending-questions'));
    await waitFor(() => expect(notifyQuestionRequired).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('pending-question-current-count').props.children).toBe('1');

    fireEvent.press(screen.getByTestId('reply-current-question'));
    await waitFor(() => {
      expect(replyToPendingQuestion).toHaveBeenCalledWith(
        expect.anything(),
        'question-notification-fails',
        [['Continue']],
      );
      expect(screen.getByTestId('pending-question-session-ids').props.children).toBe('');
    });

    mockPendingQuestions = [{
      id: 'question-reject-remains-usable',
      sessionID: SESSION_ID,
      questions: [{
        custom: false,
        header: 'Reject path',
        multiple: false,
        options: [],
        question: 'Can this still be rejected?',
      }],
    }];
    fireEvent.press(screen.getByTestId('refresh-pending-questions'));
    await waitFor(() => {
      expect(screen.getByTestId('pending-question-current-count').props.children).toBe('1');
      expect(notifyQuestionRequired).toHaveBeenCalledTimes(2);
    });
    fireEvent.press(screen.getByTestId('reject-current-question'));
    await waitFor(() => {
      expect(rejectPendingQuestion).toHaveBeenCalledWith(
        expect.anything(),
        'question-reject-remains-usable',
      );
      expect(screen.getByTestId('pending-question-session-ids').props.children).toBe('');
    });
    expect(screen.getByTestId('pending-question-provider-mounted').props.children).toBe('mounted');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    cleanup();
    jest.clearAllMocks();
  });

  test('issue-1387-c19: a send-time uplink restart preserves the open transcript until recovery', async () => {
    // Regression caught: paired-host state is part of the provider connection
    // identity. When the real relay instance restarted during prompt RPC, the
    // connected -> tailscaleUnavailable transition cleared the selected chat,
    // replacing a readable transcript with terminal "Opening chat" even
    // though the Mac API/engine remained alive and the turn later converged.
    mockSessionStatus = 'busy';
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

    const clearPendingNotification = jest.requireMock(
      '@/lib/notifications',
    ).clearPendingTaskFinishedNotification;
    clearPendingNotification.mockClear();
    fireEvent.press(screen.getByTestId('send-final-prompt'));
    await act(async () => {
      await expect(mockLatestSubmission).resolves.toBe(true);
    });

    await waitFor(() => {
      expect(mockBoundaryTrace).toContain('opencode:prompt-accepted');
      expect(mockBoundaryTrace).toContain('health:no-uplink');
      expect(screen.getByTestId('paired-state').props.children).toBe(
        'tailscaleUnavailable',
      );
      expect(screen.getByTestId('send-result').props.children).toBe(
        'transport-returned',
      );
      expect(screen.getByTestId('send-draft').props.children).toBe('');
      expect(screen.getByTestId('send-error').props.children).toBe('');
    });
    expect(clearPendingNotification).not.toHaveBeenCalled();
    const notifyTaskFinished = jest.requireMock('@/lib/notifications').notifyTaskFinished;
    expect(notifyTaskFinished).not.toHaveBeenCalled();

    // This is the strengthened assertion that is RED on the current code.
    // A transient uplink loss may disable writes, but it must not replace the
    // already-open, readable transcript with the route's loading terminal.
    expect(screen.queryByText('Opening chat')).toBeNull();
    expect(screen.getByTestId('chat-surface')).toBeTruthy();
    expect(screen.getByTestId('chat-transcript').props.children).toContain(
      BASELINE_TEXT,
    );

    mockSessionStatus = 'idle';
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
    expect(mockPromptAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(clearPendingNotification).toHaveBeenCalledTimes(1);
      expect(notifyTaskFinished).toHaveBeenCalledTimes(1);
    });
    const transcriptLines = screen
      .getByTestId('chat-transcript')
      .props.children.split('\n');
    expect(transcriptLines.filter((line: string) => line === PROMPT)).toHaveLength(1);
    expect(transcriptLines.filter((line: string) => line === 'RELAY_FINAL')).toHaveLength(1);

    const firstSubmission = mockLatestSubmission;
    fireEvent.press(screen.getByTestId('send-final-prompt'));
    expect(mockLatestSubmission).not.toBe(firstSubmission);
    await act(async () => {
      await expect(mockLatestSubmission).resolves.toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId('send-settled-count').props.children).toBe(2);
    });
    expect(mockPromptAsync).toHaveBeenCalledTimes(1);
  }, 20_000);

  test('issue-1387-c19-accepted: response loss reconciled to a user message keeps the draft committed', async () => {
    // Regression caught: a thrown prompt RPC restores a resubmittable draft even
    // after the real transcript proves that OpenCode accepted the user turn.
    mockPromptOutcome = 'accepted-visible';
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <OpencodeProvider>
            <SendHarness />
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-transcript').props.children).toContain(
        BASELINE_TEXT,
      );
      expect(
        screen.getByTestId('send-working-sound-enabled').props.children,
      ).toBe('true');
    });
    fireEvent.press(screen.getByTestId('send-final-prompt'));
    await act(async () => {
      await expect(mockLatestSubmission).resolves.toBe(true);
    });

    expect(screen.getByTestId('send-result').props.children).toBe(
      'transport-returned',
    );
    expect(screen.getByTestId('send-draft').props.children).toBe('');
    expect(screen.getByTestId('send-error').props.children).toBe('');
    expect(mockPromptAsync).toHaveBeenCalledTimes(1);
  });

  test('ios-chat-integration-c3: pre-dispatch persistence rejection restores the draft without reconciliation or POST', async () => {
    // Regression caught: a profile persistence failure is mistaken for an
    // ambiguous POST, causing reconciliation or sound despite no dispatch.
    mockPersistenceError = new Error('Profile persistence failed.');
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <OpencodeProvider>
            <SendHarness />
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-transcript').props.children).toContain(
        BASELINE_TEXT,
      );
      expect(
        screen.getByTestId('send-working-sound-enabled').props.children,
      ).toBe('true');
    });

    const sessionService = jest.requireMock('@/providers/services/session-service');
    const workingSound = jest.requireMock('@/lib/voice/working-sound');
    mockSdkClient.session.status.mockClear();
    sessionService.getSessionMessages.mockClear();
    workingSound.startWorkingSoundAsync.mockClear();
    mockWorkingSoundActive = false;
    fireEvent.press(screen.getByTestId('send-final-prompt'));
    await act(async () => {
      await expect(mockLatestSubmission).rejects.toThrow(
        'Profile persistence failed.',
      );
    });

    expect(mockPromptAsync).not.toHaveBeenCalled();
    expect(mockSdkClient.session.status).not.toHaveBeenCalled();
    expect(sessionService.getSessionMessages).not.toHaveBeenCalled();
    expect(workingSound.startWorkingSoundAsync).not.toHaveBeenCalled();
    expect(mockWorkingSoundActive).toBe(false);
    expect(screen.getByTestId('send-result').props.children).toBe(
      'definitive-rejection',
    );
    expect(screen.getByTestId('send-draft').props.children).toBe(PROMPT);
  });

  test('issue-1387-working-sound: dispatched rejection starts then stops working sound', async () => {
    // Regression caught: confirmed terminal rejection leaves dispatched audio
    // playing, or a send never starts its configured working sound.
    mockPromptOutcome = 'not-accepted';
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <OpencodeProvider>
            <SendHarness />
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-transcript').props.children).toContain(
        BASELINE_TEXT,
      );
      expect(
        screen.getByTestId('send-working-sound-enabled').props.children,
      ).toBe('true');
    });

    const workingSound = jest.requireMock('@/lib/voice/working-sound');
    workingSound.startWorkingSoundAsync.mockClear();
    workingSound.stopWorkingSoundAsync.mockClear();
    mockWorkingSoundActive = false;
    await act(async () => {
      fireEvent.press(screen.getByTestId('send-final-prompt'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId('chat-status').props.children).toBe('connected');
      expect(screen.getByTestId('platform-os').props.children).toBe('ios');
      expect(screen.getByTestId('send-active').props.children).toBe('true');
      expect(workingSound.startWorkingSoundAsync).toHaveBeenCalled();
    });

    await act(async () => {
      await expect(mockLatestSubmission).rejects.toThrow(
        'OpenCode rejected the prompt before accepting it.',
      );
    });
    expect(workingSound.stopWorkingSoundAsync).toHaveBeenCalled();
    expect(mockWorkingSoundActive).toBe(false);
  }, 15_000);

  test('issue-1387-uncertain-refresh: uncertain acceptance schedules one refresh and one bounded assistant poll', async () => {
    // Regression caught: provisional acceptance returns without a convergence
    // read, or installs a repeating refresh loop after transport recovery.
    mockPromptOutcome = 'accepted-visible';
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <OpencodeProvider>
            <SendHarness />
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('chat-transcript').props.children).toContain(
        BASELINE_TEXT,
      );
    });

    mockReconciliationReadsFail = true;
    jest.useFakeTimers();
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    fireEvent.press(screen.getByTestId('send-final-prompt'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_500);
    });
    await act(async () => {
      await expect(mockLatestSubmission).resolves.toBe(true);
    });

    const postPromptRefresh = jest.requireMock(
      '@/providers/services/post-prompt-refresh',
    );
    expect(postPromptRefresh.pollForNewAssistantTurn).toHaveBeenCalledTimes(1);
    expect(postPromptRefresh.pollForNewAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineAssistantMessageIds: expect.any(Set),
        isActive: expect.any(Function),
        refreshMessages: expect.any(Function),
      }),
    );
    expect(mockPromptAsync).toHaveBeenCalledTimes(1);

    const sessionService = jest.requireMock('@/providers/services/session-service');
    mockReconciliationReadsFail = false;
    sessionService.listSessions.mockClear();
    sessionService.getSessionMessages.mockClear();
    sessionService.getSessionDiff.mockClear();
    sessionService.getSessionTodos.mockClear();
    expect(
      timeoutSpy.mock.calls.filter(([, delay]) => delay === 1_000),
    ).toHaveLength(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(999);
    });
    expect(sessionService.listSessions).toHaveBeenCalledTimes(1);
    expect(sessionService.getSessionMessages).toHaveBeenCalledTimes(1);
    expect(sessionService.getSessionDiff).toHaveBeenCalledTimes(1);
    expect(sessionService.getSessionTodos).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(sessionService.listSessions).toHaveBeenCalledTimes(1);
    expect(sessionService.getSessionMessages).toHaveBeenCalledTimes(1);
    expect(sessionService.getSessionDiff).toHaveBeenCalledTimes(1);
    expect(sessionService.getSessionTodos).toHaveBeenCalledTimes(1);
    expect(
      timeoutSpy.mock.calls.filter(([, delay]) => delay === 1_000),
    ).toHaveLength(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });
    expect(
      timeoutSpy.mock.calls.filter(([, delay]) => delay === 1_000),
    ).toHaveLength(1);
  });

  test('issue-1387-c20: a confirmed notAccepted send rejects and restores the draft', async () => {
    // Regression caught: provisional acceptance must be limited to uncertainty;
    // this assertion fails if a readable idle transcript is treated as accepted.
    mockPromptOutcome = 'not-accepted';
    const screen = render(
      <PaperProvider>
        <PairedHostProvider>
          <OpencodeProvider>
            <SendHarness />
            <AgentChatDetailScreen />
          </OpencodeProvider>
        </PairedHostProvider>
      </PaperProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-transcript').props.children).toContain(
        BASELINE_TEXT,
      );
    });
    fireEvent.press(screen.getByTestId('send-final-prompt'));

    await act(async () => {
      await expect(mockLatestSubmission).rejects.toThrow(
        'OpenCode rejected the prompt before accepting it.',
      );
    });
    expect(mockBoundaryTrace).toContain('opencode:prompt-not-accepted');
    await waitFor(() => {
      expect(screen.getByTestId('send-result').props.children).toBe(
        'definitive-rejection',
      );
      expect(screen.getByTestId('send-draft').props.children).toBe(PROMPT);
      expect(screen.getByTestId('send-error').props.children).toBe(
        'OpenCode rejected the prompt before accepting it.',
      );
    });
    expect(mockAcceptedPromptCount).toBe(0);
  }, 15_000);
});
