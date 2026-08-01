import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import AgentChatDetailScreen from '@/app/agents/chats/[sessionId]';

const mockReplace = jest.fn();
const mockCancelOpenProjectSession = jest.fn();
const mockOpenProjectSession = jest.fn();
let mockOpencodeState: Record<string, unknown>;

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({
    projectId: '/registered/project',
    sessionId: 'ses-projectless',
  }),
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('@/components/chat/chat-view', () => ({ ChatView: () => null }));
jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => mockOpencodeState,
}));
jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({
    host: { hostId: 'mac' },
    message: 'Connected',
    state: 'connected',
  }),
}));

describe('AgentChatDetailScreen', () => {
  beforeEach(() => {
    mockOpencodeState = {
      activeProjectPath: '/registered/project',
      cancelOpenProjectSession: mockCancelOpenProjectSession,
      connection: { status: 'connected' },
      currentSessionId: undefined,
      isHydrated: true,
      openProjectSession: mockOpenProjectSession,
      openProjectSessionState: {
        kind: 'opening',
        generation: 1,
        projectId: '/registered/project',
        sessionId: 'ses-projectless',
      },
    };
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test('issue-1285-c9: opening chat exposes a working Back to chats action', () => {
    // Regression caught: the loading branch renders only a spinner, trapping
    // the user until timeout. The accessible action assertion fails there.
    const screen = render(
      <PaperProvider>
        <AgentChatDetailScreen />
      </PaperProvider>,
    );

    fireEvent.press(screen.getByLabelText('Back to chats'));

    expect(mockCancelOpenProjectSession).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/agents');
  });

  test('issue-1285-c14: ready opener is not cancelled while provider selection commits', () => {
    // Regression caught on a physical iPhone: the controller publishes ready
    // immediately after committing provider state. React can expose that ready
    // state one render before currentSessionId, and reopening here produces an
    // endless transcript/Opening chat flash with aborted upstream requests.
    mockOpencodeState = {
      ...mockOpencodeState,
      openProjectSessionState: {
        kind: 'ready',
        generation: 1,
        projectId: '/registered/project',
        sessionId: 'ses-projectless',
      },
    };

    render(
      <PaperProvider>
        <AgentChatDetailScreen />
      </PaperProvider>,
    );

    // The native test renderer performs one effect cleanup cycle. The broken
    // recovery branch adds a second cancellation and then reopens the chat.
    expect(mockCancelOpenProjectSession).toHaveBeenCalledTimes(1);
    expect(mockOpenProjectSession).not.toHaveBeenCalled();
  });
});
