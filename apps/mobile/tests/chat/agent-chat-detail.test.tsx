import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import AgentChatDetailScreen from '@/app/agents/chats/[sessionId]';

const mockReplace = jest.fn();
const mockCancelOpenProjectSession = jest.fn();
const mockOpenProjectSession = jest.fn();

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
  useOpencode: () => ({
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
  }),
}));
jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({
    host: { hostId: 'mac' },
    message: 'Connected',
    state: 'connected',
  }),
}));

describe('AgentChatDetailScreen', () => {
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
});
