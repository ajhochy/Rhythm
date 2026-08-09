import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { ChatList, flattenChats } from '@/components/chat/chat-list';
import type { ChatListController } from '@/components/chat/chat-list-controller';
import { Colors } from '@/constants/theme';
import type { AgentChatRecord } from '@/providers/services/agent-chat-service';

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockRenameChat = jest.fn();
const mockArchiveChat = jest.fn();
const mockRestoreChat = jest.fn();
const mockForkChat = jest.fn();
const mockDeleteChat = jest.fn();

const mockSessions = [
  {
    archivedAt: null,
    id: 'parent',
    parentId: null,
    projectId: '/projects/alpha',
    status: 'running',
    title: 'Parent chat',
    updatedAt: 2,
  },
  {
    archivedAt: null,
    id: 'child',
    parentId: 'parent',
    projectId: '/projects/alpha',
    status: 'idle',
    title: 'Child chat',
    updatedAt: 3,
  },
  {
    archivedAt: null,
    id: 'grandchild',
    parentId: 'child',
    projectId: '/projects/alpha',
    status: 'running',
    title: 'Grandchild chat',
    updatedAt: 4,
  },
  {
    archivedAt: null,
    id: 'sibling',
    parentId: null,
    projectId: '/projects/alpha',
    status: 'idle',
    title: 'Sibling chat',
    updatedAt: 1,
  },
];

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/chat/session-configuration-sheet', () => ({
  SessionConfigurationSheet: () => null,
}));
jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => ({
    activeProjectPath: '/projects/alpha',
    availableModels: [],
    chatPreferences: {},
    configuredProviders: [],
    projects: [{ label: 'Alpha project', path: '/projects/alpha' }],
  }),
}));
jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({ message: 'Offline' }),
}));
jest.mock('@/providers/agent-chat-provider', () => ({
  useAgentChat: () => ({
    archiveChat: mockArchiveChat,
    deleteChat: mockDeleteChat,
    error: null,
    forkChat: mockForkChat,
    isLoading: false,
    isOfflineCache: false,
    isOnline: true,
    refresh: mockRefresh,
    renameChat: mockRenameChat,
    restoreChat: mockRestoreChat,
    sessions: mockSessions,
  }),
}));

function controller(): ChatListController {
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
    openCreateSheet: jest.fn(),
    openTerminal: jest.fn(),
    openWorkspace: jest.fn(),
    projectId: null,
    projects: [],
    setLifecycle: jest.fn(),
    setProjectId: jest.fn(),
  } as ChatListController;
}

function screen() {
  return render(
    <PaperProvider>
      <ChatList controller={controller()} />
    </PaperProvider>,
  );
}

describe('ChatList hierarchy', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test('task-mobile-agents-session-list-c1: compact rows replace outlined cards', () => {
    // Regression caught: restoring Card rows makes the session list visually noisy.
    const view = screen().getByTestId('chat-row-parent');
    expect(StyleSheet.flatten(view.props.style)).toEqual(expect.objectContaining({ minHeight: 56 }));
    expect(StyleSheet.flatten(view.props.style)).not.toEqual(expect.objectContaining({ borderWidth: expect.anything() }));
  });

  test('task-mobile-agents-session-list-c2: rows navigate and retain 48 point actions', async () => {
    const rendered = screen();
    fireEvent.press(rendered.getByTestId('chat-row-open-parent'));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ sessionId: 'parent' }) }));
    const actions = rendered.getByLabelText('Chat actions for Parent chat');
    expect(rendered.getByTestId('chat-action-parent').props.style).toEqual(expect.objectContaining({ height: 48, width: 48 }));
    fireEvent.press(actions);
    await waitFor(() => expect(rendered.getByText('Rename')).toBeTruthy());
  });

  test('task-mobile-agents-session-list-c3: disclosure toggles without navigating', () => {
    const rendered = screen();
    const disclosure = rendered.getByLabelText('Collapse Parent chat');
    expect(disclosure.props.accessibilityState).toEqual(expect.objectContaining({ expanded: true }));
    fireEvent.press(disclosure);
    expect(mockPush).not.toHaveBeenCalled();
    expect(rendered.queryByTestId('chat-row-child')).toBeNull();
  });

  test('task-mobile-agents-session-list-c4: root and nested collapse preserve siblings and order', () => {
    const rendered = screen();
    fireEvent.press(rendered.getByLabelText('Collapse Parent chat'));
    expect(rendered.queryByTestId('chat-row-child')).toBeNull();
    expect(rendered.getByTestId('chat-row-sibling')).toBeTruthy();
    fireEvent.press(rendered.getByLabelText('Expand Parent chat'));
    fireEvent.press(rendered.getByLabelText('Collapse Child chat'));
    expect(rendered.queryByTestId('chat-row-grandchild')).toBeNull();
    expect(rendered.getByTestId('chat-row-child')).toBeTruthy();
  });

  test('task-mobile-agents-session-list-c5: hierarchy exposes capped indentation and actual depth', () => {
    const rendered = screen();
    expect(StyleSheet.flatten(rendered.getByTestId('chat-row-grandchild').props.style)).toEqual(expect.objectContaining({ marginLeft: 24 }));
    expect(rendered.getByLabelText(/Grandchild chat, level 3/)).toBeTruthy();
  });

  test('task-mobile-agents-session-list-c6: collapsed parents summarize hidden descendant activity', () => {
    const rendered = screen();
    fireEvent.press(rendered.getByLabelText('Collapse Parent chat'));
    expect(rendered.getByLabelText(/Parent chat.*2 hidden descendants.*1 running/)).toBeTruthy();
  });

  test('task-mobile-agents-session-list-c7: search reveals hidden matches without resetting collapse', () => {
    const rendered = screen();
    fireEvent.press(rendered.getByLabelText('Collapse Parent chat'));
    fireEvent.changeText(rendered.getByLabelText('Search chats'), 'Grandchild');
    expect(rendered.getByTestId('chat-row-grandchild')).toBeTruthy();
    expect(rendered.queryByTestId('chat-row-parent')).toBeNull();
    fireEvent.changeText(rendered.getByLabelText('Search chats'), '');
    expect(rendered.queryByTestId('chat-row-grandchild')).toBeNull();
  });

  test('task-mobile-agents-session-list-c8: row and disclosure labels describe hierarchy state', () => {
    const rendered = screen();
    expect(rendered.getByLabelText(/Parent chat, level 1, running, Alpha project/)).toBeTruthy();
    expect(rendered.getByLabelText('Collapse Parent chat').props.accessibilityState).toEqual(expect.objectContaining({ expanded: true }));
  });

  test('task-mobile-agents-session-list-repair-c1: VoiceOver receives independent sibling row, disclosure, and action controls', () => {
    // Regression caught: an accessible parent Pressable groups its disclosure and action descendants on iOS.
    const rendered = screen();
    const row = rendered.getByTestId('chat-row-parent');
    const rowOpen = rendered.getByTestId('chat-row-open-parent');
    const disclosure = rendered.getByTestId('chat-disclosure-parent');
    const action = rendered.getByTestId('chat-action-parent');

    expect(row.props.accessible).toBe(false);
    expect(rowOpen.props.accessible).toBe(true);
    expect(disclosure.props.accessible).toBe(true);
    expect(action.props.accessible).toBe(true);
    expect(new Set([rowOpen, disclosure, action]).size).toBe(3);
    fireEvent.press(disclosure);
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('task-mobile-agents-session-list-repair-c2: a ten-level tree visits each node once and retains totals', () => {
    // Regression caught: calculating descendant summaries by recursively flattening descendants re-walks deep trees.
    const childReads = new Map<string, number>();
    const records = Array.from({ length: 10 }, (_, index) => {
      const id = `deep-${index}`;
      const record = {
        archivedAt: null,
        id,
        parentId: index === 0 ? null : `deep-${index - 1}`,
        projectId: '/projects/alpha',
        status: index % 2 ? 'running' : 'idle',
        title: `Deep ${index}`,
        updatedAt: 10 - index,
      } as AgentChatRecord;
      Object.defineProperty(record, 'children', {
        enumerable: true,
        get: () => {
          childReads.set(id, (childReads.get(id) ?? 0) + 1);
          return index === 9 ? [] : [records[index + 1]];
        },
      });
      return record;
    });

    const rows = flattenChats([records[0]]);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ descendantCount: 9, id: 'deep-0', runningDescendantCount: 5 });
    expect(rows[9]).toMatchObject({ descendantCount: 0, id: 'deep-9', runningDescendantCount: 0 });
    expect([...childReads.values()]).toEqual(Array(10).fill(1));
  });

  test('task-mobile-agents-session-list-repair-c3: normal-size metadata uses the readable semantic text color', () => {
    // Regression caught: reverting compact metadata to muted drops normal text below required light-mode contrast.
    const metadata = screen().getAllByText('Alpha project · running')[0];
    expect(StyleSheet.flatten(metadata.props.style)).toEqual(expect.objectContaining({ color: Colors.light.text }));
  });

  test('task-mobile-agents-session-list-repair-2-c1: child titles use the readable semantic text color', () => {
    // Regression caught: child titles reverting to muted fail normal-text contrast on the screen background.
    const childTitle = screen().getByText('Child chat');
    expect(StyleSheet.flatten(childTitle.props.style)).toEqual(expect.objectContaining({ color: Colors.light.text }));
  });

  test('task-mobile-agents-session-list-repair-2-c2: row-open fills the row with a 44 point target', () => {
    // Regression caught: vertically centered row text creates a 39–41 point row-open touch target.
    const rowOpen = screen().getByTestId('chat-row-open-parent');
    expect(StyleSheet.flatten(rowOpen.props.style)).toEqual(expect.objectContaining({ alignSelf: 'stretch', minHeight: 44 }));
  });
});
