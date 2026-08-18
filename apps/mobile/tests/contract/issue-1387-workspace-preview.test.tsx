import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import AgentWorkspaceScreen from '@/app/agents/workspace';
import { OpencodeProvider } from '@/providers/opencode-provider';

const mockFindFiles = jest.fn();
const mockReadFile = jest.fn();
const mockPairedClient = {
  origin: () => 'https://api.vcrcapps.com',
  request: jest.fn().mockResolvedValue({ macOnline: true }),
};

jest.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: () => ({
    app: {
      skills: jest.fn(),
    },
  }),
}), { virtual: true });

jest.mock('@/lib/opencode/global-event-stream', () => ({
  streamDirectGlobalEvents: jest.fn(),
  streamPairedGlobalEvents: jest.fn(),
}));

jest.mock('@/lib/notifications', () => ({
  clearPendingTaskFinishedNotification: jest.fn().mockResolvedValue(undefined),
  notifyTaskFinished: jest.fn().mockResolvedValue(undefined),
  trackPendingTaskFinishedNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/voice/speech-output', () => ({
  speakText: jest.fn().mockResolvedValue(false),
  stopSpeaking: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/voice/working-sound', () => ({
  startWorkingSoundAsync: jest.fn().mockResolvedValue(undefined),
  stopWorkingSoundAsync: jest.fn().mockResolvedValue(undefined),
  unloadWorkingSoundAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock('@/components/chat/session-configuration-sheet', () => ({
  SessionConfigurationSheet: () => null,
}));

jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({
    client: mockPairedClient,
    host: {
      deviceId: 'iphone-contract',
      gatewayUrl: 'https://api.vcrcapps.com',
      hostId: 'mac-contract',
      relayUrl: 'https://api.vcrcapps.com',
      rhythmUserId: 1387,
    },
    message: 'Connected through Rhythm Cloud Gateway.',
    refresh: jest.fn(),
    state: 'connected',
  }),
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => ({
    user: { id: 1387 },
  }),
}));

jest.mock('@/providers/use-opencode-persistence', () => ({
  useOpencodePersistence: ({ setActiveProjectPath }: {
    setActiveProjectPath: (path: string) => void;
  }) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(() => {
      setActiveProjectPath('rhythm-owner-project');
    }, [setActiveProjectPath]);
    return { isHydrated: false };
  },
}));

jest.mock('@/providers/services/workspace-service', () => ({
  ...jest.requireActual('@/providers/services/workspace-service'),
  findFiles: (...args: unknown[]) => mockFindFiles(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
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
    start: jest.fn().mockResolvedValue(false),
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

describe('Workspace file preview contract', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test('issue-1387-c18: tapping a relay search result opens its readable preview', async () => {
    // Regression caught: the relay returns a real file row and a successful
    // text-file read, but the provider silently drops that read and the tap
    // produces no preview or error. The readable-content assertion fails.
    mockFindFiles.mockResolvedValue(['README.md']);
    mockReadFile.mockResolvedValue({
      type: 'text',
      content: '# Rhythm\n\nNative Cloud Gateway workspace preview.',
    });

    const rendered = render(
      <PaperProvider>
        <OpencodeProvider>
          <AgentWorkspaceScreen />
        </OpencodeProvider>
      </PaperProvider>,
    );

    fireEvent.press(rendered.getByText('Files', { exact: true }));
    fireEvent.changeText(rendered.getByTestId('workspace-file-search'), 'README');
    fireEvent.press(rendered.getByTestId('workspace-search-button'));
    await waitFor(() => expect(rendered.getByText('README.md')).toBeTruthy());

    fireEvent.press(rendered.getByText('README.md'));
    await waitFor(() => expect(mockReadFile).toHaveBeenCalled());

    expect(
      rendered.getByText('# Rhythm\n\nNative Cloud Gateway workspace preview.'),
    ).toBeTruthy();
  });
});
