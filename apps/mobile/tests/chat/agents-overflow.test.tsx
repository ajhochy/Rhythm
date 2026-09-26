import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { InteractionManager } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { AgentsOverflowMenu } from '@/app/(tabs)/agents';
import type { ChatListController } from '@/components/chat/chat-list-controller';

jest.mock('@/components/agents/activity-feed', () => ({
  ActivityFeed: () => null,
}));
jest.mock('@/components/chat/chat-list', () => ({ ChatList: () => null }));
jest.mock('@/components/chat/chat-list-controller', () => ({
  useChatListController: jest.fn(),
}));
jest.mock('@/providers/activity-provider', () => ({
  useActivity: jest.fn(),
}));
jest.mock('@/providers/agent-chat-provider', () => ({
  useAgentChat: jest.fn(),
}));

function controller(
  overrides: Partial<ChatListController> = {},
): ChatListController {
  return {
    clearFeedback: jest.fn(),
    closeCreateSheet: jest.fn(),
    createChat: jest.fn(),
    creationProfiles: [],
    createSheetVisible: false,
    feedback: null,
    isCreating: false,
    isFocused: true,
    isOnline: true,
    lifecycle: 'all',
    openCreateSheet: jest.fn().mockResolvedValue(undefined),
    openTerminal: jest.fn(),
    openWorkspace: jest.fn(),
    projectId: null,
    projects: [
      {
        label: 'Alpha project',
        path: '/projects/alpha',
        source: 'server',
      },
    ],
    setLifecycle: jest.fn(),
    setProjectId: jest.fn(),
    ...overrides,
  } as ChatListController;
}

describe('AgentsOverflowMenu', () => {
  afterEach(cleanup);

  test('owns chat actions and dismisses after project, lifecycle, and create selections', async () => {
    const chatController = controller();
    const screen = render(
      <PaperProvider>
        <AgentsOverflowMenu
          chatController={chatController}
          counts={{ background: 2, chats: 4, scheduled: 1 }}
          onSectionChange={jest.fn()}
          section="chats"
        />
      </PaperProvider>,
    );

    fireEvent.press(screen.getByLabelText('Chats menu'));
    await waitFor(() => {
      expect(screen.getByLabelText('Open workspace')).toBeTruthy();
    });
    expect(screen.getByTestId('agents-overflow-scroll')).toBeTruthy();
    expect(screen.getByTestId('agents-overflow-scroll').props.scrollEnabled)
      .not.toBe(false);
    expect(screen.getByLabelText('Open terminal')).toBeTruthy();
    expect(screen.getByLabelText('Create chat')).toBeTruthy();
    expect(screen.getByLabelText('Filter chats by project')).toBeTruthy();
    expect(screen.getByLabelText('All chat states')).toBeTruthy();
    expect(screen.getByLabelText('Active chats')).toBeTruthy();
    expect(screen.getByLabelText('Completed chats')).toBeTruthy();
    expect(screen.getByLabelText('Archived chats')).toBeTruthy();

    fireEvent.press(
      screen.getByLabelText('Filter chats by project, Alpha project'),
    );
    expect(chatController.setProjectId).toHaveBeenCalledWith('/projects/alpha');
    await waitFor(() => {
      expect(screen.queryByLabelText('Open workspace')).toBeNull();
    });

    fireEvent.press(screen.getByLabelText('Chats menu'));
    await waitFor(() => {
      expect(screen.getByLabelText('Archived chats')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Archived chats'));
    expect(chatController.setLifecycle).toHaveBeenCalledWith('archived');
    await waitFor(() => {
      expect(screen.queryByLabelText('Archived chats')).toBeNull();
    });

    fireEvent.press(screen.getByLabelText('Chats menu'));
    await waitFor(() => {
      expect(screen.getByLabelText('Create chat')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Create chat'));
    expect(chatController.openCreateSheet).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByLabelText('Create chat')).toBeNull();
    });
  });

  test('opens only the latest deferred menu press and cancels it on unmount', () => {
    const scheduled: { cancel: jest.Mock; run: () => void }[] = [];
    const runAfterInteractions = jest
      .spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation(((task: () => void) => {
        let cancelled = false;
        const entry = {
          cancel: jest.fn(() => {
            cancelled = true;
          }),
          run: () => {
            if (!cancelled) task();
          },
        };
        scheduled.push(entry);
        return { cancel: entry.cancel } as unknown as ReturnType<
          typeof InteractionManager.runAfterInteractions
        >;
      }) as typeof InteractionManager.runAfterInteractions);
    const screen = render(
      <PaperProvider>
        <AgentsOverflowMenu
          chatController={controller()}
          counts={{ background: 2, chats: 4, scheduled: 1 }}
          onSectionChange={jest.fn()}
          section="chats"
        />
      </PaperProvider>,
    );

    fireEvent.press(screen.getByLabelText('Chats menu'));
    fireEvent.press(screen.getByLabelText('Chats menu'));

    expect(scheduled).toHaveLength(2);
    expect(scheduled[0].cancel).toHaveBeenCalledTimes(1);
    act(() => scheduled[0].run());
    expect(screen.queryByLabelText('Open workspace')).toBeNull();
    act(() => scheduled[1].run());
    expect(screen.getByLabelText('Open workspace')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Chats menu'));
    expect(scheduled).toHaveLength(3);
    screen.unmount();
    expect(scheduled[2].cancel).toHaveBeenCalledTimes(1);
    runAfterInteractions.mockRestore();
  });
});
