import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import AgentChatDetailScreen from '@/app/agents/chats/[sessionId]';

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = false;
let mockRouteProjectId = '/registered/project';
let mockRouteSessionId = 'ses-projectless';
const mockCancelOpenProjectSession = jest.fn();
const mockOpenProjectSession = jest.fn();
let mockOpencodeState: Record<string, unknown>;

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({
    projectId: mockRouteProjectId,
    sessionId: mockRouteSessionId,
  }),
  useRouter: () => ({ back: mockBack, canGoBack: () => mockCanGoBack, replace: mockReplace }),
}));
jest.mock('@/components/chat/chat-view', () => ({
  ChatView: () => {
    const { Text } = jest.requireActual('react-native');
    return <Text testID="rendered-chat-session">{String(mockOpencodeState.currentSessionId)}</Text>;
  },
}));
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
    mockCanGoBack = false;
    mockRouteProjectId = '/registered/project';
    mockRouteSessionId = 'ses-projectless';
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

  test('ios-chat-integration-c2: native back preserves the existing chat-list stack', () => {
    // Regression caught: replacing the list route discards its filters and scroll state.
    mockCanGoBack = true;
    const screen = render(
      <PaperProvider>
        <AgentChatDetailScreen />
      </PaperProvider>,
    );

    fireEvent.press(screen.getByLabelText('Back to chats'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
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

  test('keeps the rendered chat after readiness during transient controller churn', () => {
    mockOpencodeState = {
      ...mockOpencodeState,
      currentSessionId: 'ses-projectless',
      openProjectSessionState: {
        kind: 'ready',
        generation: 1,
        projectId: '/registered/project',
        sessionId: 'ses-projectless',
      },
    };
    const screen = render(
      <PaperProvider>
        <AgentChatDetailScreen />
      </PaperProvider>,
    );
    expect(screen.queryByText('Opening chat')).toBeNull();

    mockOpencodeState = {
      ...mockOpencodeState,
      openProjectSessionState: { kind: 'idle' },
    };
    screen.rerender(
      <PaperProvider>
        <AgentChatDetailScreen />
      </PaperProvider>,
    );

    expect(screen.queryByText('Opening chat')).toBeNull();
  });

  test('ios-chat-integration-c2: A→B→A route changes render the matching provider session', () => {
    const ready = (sessionId: string) => ({
      ...mockOpencodeState,
      currentSessionId: sessionId,
      openProjectSessionState: {
        kind: 'ready',
        generation: 1,
        projectId: mockRouteProjectId,
        sessionId,
      },
    });
    mockOpencodeState = ready('A');
    mockRouteSessionId = 'A';
    const rendered = render(
      <PaperProvider><AgentChatDetailScreen /></PaperProvider>,
    );
    expect(rendered.getByTestId('rendered-chat-session').props.children).toBe('A');

    mockRouteSessionId = 'B';
    mockOpencodeState = ready('B');
    rendered.rerender(<PaperProvider><AgentChatDetailScreen /></PaperProvider>);
    expect(rendered.getByTestId('rendered-chat-session').props.children).toBe('B');

    mockRouteSessionId = 'A';
    mockOpencodeState = ready('A');
    rendered.rerender(<PaperProvider><AgentChatDetailScreen /></PaperProvider>);
    expect(rendered.getByTestId('rendered-chat-session').props.children).toBe('A');
  });
});
