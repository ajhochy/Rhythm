import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
const mockRetryBootstrap = jest.fn(async () => undefined);

const mockSessions = [
  {
    archivedAt: 5,
    id: 'archived',
    parentId: null,
    projectId: '/projects/alpha',
    status: 'idle',
    title: 'Archived chat',
    updatedAt: 5,
  },
  {
    archivedAt: null,
    id: 'parent',
    parentId: null,
    projectID: 'project-alpha-uid',
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
const defaultProjects = [
  { id: 'project-alpha-uid', label: 'Alpha project', path: '/projects/alpha' },
  { label: 'Empty project', path: '/projects/empty' },
];
let mockProjects = defaultProjects;
let mockPendingQuestionSessionIds: string[] = [];
let mockColorScheme: 'light' | 'dark' = 'light';
let mockChatState = {
  error: null as string | null,
  isLoading: false,
  isOfflineCache: false,
  isOnline: true,
  sessions: mockSessions,
};
let mockPairedHostState = {
  bootstrapState: 'idle',
  message: 'Offline',
};

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockColorScheme,
}));
jest.mock('@/components/chat/session-configuration-sheet', () => ({
  SessionConfigurationSheet: () => null,
}));
jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => ({
    activeProjectPath: '/projects/alpha',
    availableModels: [],
    chatPreferences: {},
    connection: {
      message: 'Pair this iPhone with your Mac to use Rhythm Agents.',
      status: 'idle',
    },
    configuredProviders: [],
    pendingQuestionSessionIds: mockPendingQuestionSessionIds,
    projects: mockProjects,
  }),
}));
jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({
    ...mockPairedHostState,
    retryBootstrap: mockRetryBootstrap,
  }),
}));
jest.mock('@/providers/agent-chat-provider', () => ({
  useAgentChat: () => ({
    archiveChat: mockArchiveChat,
    deleteChat: mockDeleteChat,
    error: mockChatState.error,
    forkChat: mockForkChat,
    isLoading: mockChatState.isLoading,
    isOfflineCache: mockChatState.isOfflineCache,
    isOnline: mockChatState.isOnline,
    refresh: mockRefresh,
    renameChat: mockRenameChat,
    restoreChat: mockRestoreChat,
    sessions: mockChatState.sessions,
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

function screen({ expandProjects = true }: { expandProjects?: boolean } = {}) {
  const rendered = render(
    <PaperProvider>
      <ChatList controller={controller()} />
    </PaperProvider>,
  );
  if (expandProjects) {
    const disclosure = rendered.queryByLabelText(/Alpha project, \d+ active(?:, \d+ needs answer)?, collapsed/);
    if (disclosure) fireEvent.press(disclosure);
  }
  return rendered;
}

describe('ChatList hierarchy', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    mockChatState = {
      error: null,
      isLoading: false,
      isOfflineCache: false,
      isOnline: true,
      sessions: mockSessions,
    };
    mockProjects = defaultProjects;
    mockPendingQuestionSessionIds = [];
    mockColorScheme = 'light';
    mockPairedHostState = {
      bootstrapState: 'idle',
      message: 'Offline',
    };
  });

  test('task-mobile-project-list-c1: active counts use active lifecycle statuses for root and nested sessions', () => {
    // Regression caught: idle or archived sessions inflate the active count, or nested active sessions are missed.
    const rendered = screen({ expandProjects: false });

    const alpha = rendered.getByLabelText('Alpha project, 2 active, collapsed');
    expect(alpha.props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    expect(rendered.getByText('2 active')).toBeTruthy();
    expect(rendered.getByLabelText('Empty project, 0 active, collapsed')).toBeTruthy();
    expect(rendered.queryByTestId('chat-row-parent')).toBeNull();
  });

  test('task-mobile-question-state-c2: pending rows override idle copy with an accessible Needs answer warning', () => {
    // Regression caught: a waiting chat still reads as idle and gives no visible or VoiceOver action cue.
    mockPendingQuestionSessionIds = ['sibling'];
    const rendered = screen();

    expect(rendered.getByText('Needs answer')).toBeTruthy();
    expect(rendered.getByLabelText(/Sibling chat.*Needs answer/)).toBeTruthy();
    expect(within(rendered.getByTestId('chat-row-open-sibling')).queryByText(/idle/i)).toBeNull();
  });

  test('task-mobile-question-state-ui-c1-light: Needs answer uses the AA danger token in light theme', () => {
    // Regression caught: 13pt warning text uses the non-AA light warning color on the raised surface.
    mockPendingQuestionSessionIds = ['sibling'];
    const light = screen();
    expect(StyleSheet.flatten(light.getByText('Needs answer').props.style)).toEqual(
      expect.objectContaining({ color: Colors.light.danger }),
    );
  });

  test('task-mobile-question-state-ui-c1-dark: Needs answer uses the AA danger token in dark theme', () => {
    // Regression caught: the contrast repair hard-codes the light token instead of following the dark palette.
    mockPendingQuestionSessionIds = ['sibling'];
    mockColorScheme = 'dark';
    const dark = screen();
    expect(StyleSheet.flatten(dark.getByText('Needs answer').props.style)).toEqual(
      expect.objectContaining({ color: Colors.dark.danger }),
    );
  });

  test('task-mobile-question-state-c3: collapsed project headers announce pending questions without changing active counts', () => {
    // Regression caught: collapsed-by-default projects hide every indication that a session needs an answer.
    mockPendingQuestionSessionIds = ['child', 'sibling'];
    const rendered = screen({ expandProjects: false });

    expect(rendered.getByText('2 needs answer')).toBeTruthy();
    expect(rendered.getByLabelText('Alpha project, 2 active, 2 needs answer, collapsed')).toBeTruthy();
    expect(rendered.queryByTestId('chat-row-child')).toBeNull();
  });

  test('task-mobile-question-state-ui-c2: project header metadata wraps inside one shrinking text column', () => {
    // Regression caught: enlarged metadata remains beside the title and pushes the trailing chevron off a 375pt screen.
    mockPendingQuestionSessionIds = ['child', 'sibling'];
    const rendered = screen({ expandProjects: false });
    const header = rendered.getByLabelText('Alpha project, 2 active, 2 needs answer, collapsed');
    const copy = rendered.getByTestId('project-header-copy-/projects/alpha');
    const metadata = rendered.getByTestId('project-header-metadata-/projects/alpha');

    expect(within(copy).getByText('Alpha project')).toBeTruthy();
    expect(within(metadata).getByText('2 active')).toBeTruthy();
    expect(within(metadata).getByText('2 needs answer')).toBeTruthy();
    expect(StyleSheet.flatten(copy.props.style)).toEqual(
      expect.objectContaining({ flex: 1, flexShrink: 1, minWidth: 0 }),
    );
    expect(StyleSheet.flatten(metadata.props.style)).toEqual(
      expect.objectContaining({ flexDirection: 'row', flexWrap: 'wrap', minWidth: 0 }),
    );
    expect(StyleSheet.flatten(header.props.style)).toEqual(
      expect.objectContaining({ minHeight: 44 }),
    );
    expect(rendered.getByTestId('project-header-chevron-/projects/alpha')).toBeTruthy();
  });

  test('task-mobile-question-state-c4: projects and rows without pending questions show no false indicator', () => {
    // Regression caught: a stale project badge remains after the last pending request resolves.
    const rendered = screen({ expandProjects: false });

    expect(rendered.queryByText(/needs answer/i)).toBeNull();
    expect(rendered.queryByLabelText(/needs answer/i)).toBeNull();
    expect(rendered.getByLabelText('Alpha project, 2 active, collapsed')).toBeTruthy();
  });

  test('task-mobile-project-list-c1-statuses: active counts follow every AgentChatService lifecycle status', () => {
    // Regression caught: the list copies an incomplete status allowlist instead of using AgentChatService derivation.
    mockChatState.sessions = [
      ...['working', 'busy', 'retry', 'starting', 'running', 'queued', 'idle', 'completed'].map(
        (status, index) => ({
          archivedAt: null,
          id: status,
          parentId: null,
          projectId: '/projects/alpha',
          status,
          title: status,
          updatedAt: index,
        }),
      ),
      {
        archivedAt: 1,
        id: 'archived-running',
        parentId: null,
        projectId: '/projects/alpha',
        status: 'running',
        title: 'Archived running',
        updatedAt: 9,
      },
    ];

    expect(screen({ expandProjects: false }).getByLabelText('Alpha project, 6 active, collapsed')).toBeTruthy();
  });

  test('task-mobile-project-list-c2: project paths and UIDs are absent from visible and accessible project rows', () => {
    // Regression caught: an internal routing path or project UID leaks into project-row text or VoiceOver output.
    const rendered = screen({ expandProjects: false });

    expect(rendered.queryByText(/\/projects\/alpha|project-alpha-uid/)).toBeNull();
    expect(rendered.queryByLabelText(/\/projects\/alpha|project-alpha-uid/)).toBeNull();
    expect(rendered.getByLabelText('Alpha project, 2 active, collapsed')).toBeTruthy();
  });

  test('task-mobile-project-list-c3-tie: equal project activity falls back to human label order', () => {
    // Regression caught: session IDs or provider order break the alphabetical project-group tie-break.
    mockProjects = [
      { label: 'Zulu project', path: '/projects/zulu' },
      { label: 'Alpha project', path: '/projects/alpha' },
    ];
    mockChatState.sessions = [
      {
        archivedAt: null,
        id: 'a-zulu-session',
        parentId: null,
        projectId: '/projects/zulu',
        status: 'idle',
        title: 'Zulu chat',
        updatedAt: 100,
      },
      {
        archivedAt: null,
        id: 'z-alpha-session',
        parentId: null,
        projectId: '/projects/alpha',
        status: 'idle',
        title: 'Alpha chat',
        updatedAt: 100,
      },
    ];

    const rendered = screen({ expandProjects: false });
    expect(rendered.getAllByLabelText(/project, 0 active, collapsed/).map((row) => row.props.accessibilityLabel)).toEqual([
      'Alpha project, 0 active, collapsed',
      'Zulu project, 0 active, collapsed',
    ]);
  });

  test('task-mobile-project-list-c3: recent activity is default and includes completed nested activity', () => {
    // Regression caught: provider order wins, completed activity is ignored, or empty projects sort above active projects.
    mockProjects = [
      { label: 'Alpha project', path: '/projects/alpha' },
      { label: 'Beta project', path: '/projects/beta' },
      { label: 'Empty project', path: '/projects/empty' },
    ];
    mockChatState.sessions = [
      ...mockSessions,
      {
        archivedAt: null,
        id: 'beta-parent',
        parentId: null,
        projectId: '/projects/beta',
        status: 'idle',
        title: 'Beta parent',
        updatedAt: 6,
      },
      {
        archivedAt: null,
        id: 'beta-child',
        parentId: 'beta-parent',
        projectId: '/projects/beta',
        status: 'completed',
        title: 'Beta completed child',
        updatedAt: 20,
      },
    ];

    const rendered = screen({ expandProjects: false });
    expect(rendered.getByLabelText('Sort projects, Recent activity').props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: false }),
    );
    expect(rendered.getAllByLabelText(/project, \d+ active, collapsed/).map((row) => row.props.accessibilityLabel)).toEqual([
      'Beta project, 0 active, collapsed',
      'Alpha project, 2 active, collapsed',
      'Empty project, 0 active, collapsed',
    ]);
  });

  test('task-mobile-project-list-c4: alphabetical sort is locale-aware and preserves disclosure state', async () => {
    // Regression caught: sorting mutates source order or resets an expanded project disclosure.
    mockProjects = [
      { label: 'Zulu project', path: '/projects/zulu' },
      ...defaultProjects,
    ];
    mockChatState.sessions = [
      ...mockSessions,
      {
        archivedAt: null,
        id: 'zulu',
        parentId: null,
        projectId: '/projects/zulu',
        status: 'idle',
        title: 'Zulu chat',
        updatedAt: 30,
      },
    ];
    const originalOrder = mockProjects.map((project) => project.path);
    const rendered = screen({ expandProjects: false });
    fireEvent.press(rendered.getByLabelText('Alpha project, 2 active, collapsed'));
    fireEvent.press(rendered.getByLabelText('Sort projects, Recent activity'));
    fireEvent.press(await rendered.findByText('Alphabetical'));

    expect(rendered.getAllByLabelText(/project, \d+ active, (?:collapsed|expanded)/).map((row) => row.props.accessibilityLabel)).toEqual([
      'Alpha project, 2 active, expanded',
      'Empty project, 0 active, collapsed',
      'Zulu project, 0 active, collapsed',
    ]);
    expect(mockProjects.map((project) => project.path)).toEqual(originalOrder);
  });

  test('task-mobile-project-list-c5: compact toolbar wraps safely for Dynamic Type without shrinking targets', () => {
    // Regression caught: fixed heights clip enlarged text or force controls beyond the screen width.
    const rendered = screen({ expandProjects: false });

    expect(rendered.queryByText('Filters')).toBeNull();
    expect(rendered.queryByText('All projects')).toBeNull();
    expect(rendered.queryByText('All states')).toBeNull();
    expect(rendered.queryByText(/projects · .*active sessions/)).toBeNull();
    expect(rendered.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    const toolbarStyle = StyleSheet.flatten(rendered.getByTestId('chat-list-toolbar').props.style);
    expect(toolbarStyle).toEqual(expect.objectContaining({ flexWrap: 'wrap', minHeight: 44 }));
    expect(toolbarStyle).not.toEqual(expect.objectContaining({ height: expect.anything() }));
    const searchStyle = StyleSheet.flatten(rendered.getByTestId('chat-list-search').props.style);
    expect(searchStyle).toEqual(expect.objectContaining({ flexBasis: 140, flexGrow: 1, minHeight: 44 }));
    expect(searchStyle).not.toEqual(expect.objectContaining({ height: expect.anything() }));
    expect(StyleSheet.flatten(rendered.getByLabelText('Sort projects, Recent activity').props.style)).toEqual(
      expect.objectContaining({ minHeight: 44 }),
    );
  });

  test('task-mobile-project-list-c6: project filter is one 44 point clear button with its value', () => {
    // Regression caught: only a tiny trailing icon clears the project filter or the value is absent from its label.
    const active = controller();
    active.projectId = '/projects/alpha';
    active.lifecycle = 'active';
    const rendered = render(
      <PaperProvider>
        <ChatList controller={active} />
      </PaperProvider>,
    );

    const clearProject = rendered.getByLabelText('Clear project filter, Alpha project');
    expect(StyleSheet.flatten(rendered.getByTestId('project-filter-control').props.style)).toEqual(expect.objectContaining({ minHeight: 44 }));
    expect(rendered.getAllByText('Alpha project').length).toBeGreaterThan(0);
    fireEvent.press(clearProject);
    expect(active.setProjectId).toHaveBeenCalledWith(null);
    expect(active.setLifecycle).not.toHaveBeenCalled();
  });

  test('task-mobile-project-list-c7: lifecycle filter is one 44 point clear button with its value', () => {
    // Regression caught: only a tiny trailing icon clears lifecycle state or the value is absent from its label.
    const active = controller();
    active.projectId = '/projects/alpha';
    active.lifecycle = 'active';
    const rendered = render(
      <PaperProvider>
        <ChatList controller={active} />
      </PaperProvider>,
    );

    const clearLifecycle = rendered.getByLabelText('Clear lifecycle filter, Active');
    expect(StyleSheet.flatten(rendered.getByTestId('lifecycle-filter-control').props.style)).toEqual(expect.objectContaining({ minHeight: 44 }));
    expect(rendered.getByText('Active')).toBeTruthy();
    fireEvent.press(clearLifecycle);
    expect(active.setLifecycle).toHaveBeenCalledWith('all');
    expect(active.setProjectId).not.toHaveBeenCalled();
  });

  test('task-mobile-chat-redesign-c2: expanding an empty project shows exactly one empty-project message', () => {
    // Regression caught: zero-session projects are omitted or reuse the account-level empty state.
    const rendered = screen({ expandProjects: false });

    fireEvent.press(rendered.getByLabelText('Empty project, 0 active, collapsed'));
    expect(rendered.getAllByText('No active sessions')).toHaveLength(1);
    expect(rendered.getByLabelText('Empty project, 0 active, expanded').props.accessibilityState).toEqual(
      expect.objectContaining({ expanded: true }),
    );
  });

  test('task-mobile-chat-redesign-c3: search reveals project context without changing project or nested disclosure state', () => {
    // Regression caught: search hides project context or permanently expands project/session disclosures.
    const rendered = screen({ expandProjects: false });

    expect(rendered.getByPlaceholderText('Search projects and chats')).toBeTruthy();
    expect(rendered.getByLabelText('Search chats')).toBeTruthy();

    fireEvent.changeText(rendered.getByLabelText('Search chats'), 'Grandchild');
    expect(rendered.getByLabelText('Alpha project, 2 active, collapsed')).toBeTruthy();
    expect(rendered.getByTestId('chat-row-grandchild')).toBeTruthy();
    fireEvent.changeText(rendered.getByLabelText('Search chats'), '');
    expect(rendered.queryByTestId('chat-row-grandchild')).toBeNull();

    fireEvent.press(rendered.getByLabelText('Alpha project, 2 active, collapsed'));
    fireEvent.press(rendered.getByLabelText('Collapse Parent chat'));
    fireEvent.changeText(rendered.getByLabelText('Search chats'), 'Grandchild');
    expect(rendered.getByTestId('chat-row-grandchild')).toBeTruthy();
    fireEvent.changeText(rendered.getByLabelText('Search chats'), '');
    expect(rendered.queryByTestId('chat-row-grandchild')).toBeNull();
    expect(rendered.getByLabelText('Expand Parent chat')).toBeTruthy();
  });

  test('lifecycle filters expand matching projects and retain that expansion when cleared', () => {
    // Regression caught: lifecycle-filtered chats remain hidden behind collapsed project groups.
    const filtered = controller();
    filtered.lifecycle = 'active';
    const rendered = render(
      <PaperProvider>
        <ChatList controller={filtered} />
      </PaperProvider>,
    );

    expect(rendered.getByLabelText('Alpha project, 2 active, expanded')).toBeTruthy();
    expect(rendered.getByTestId('chat-row-parent')).toBeTruthy();

    rendered.rerender(
      <PaperProvider>
        <ChatList controller={{ ...filtered, lifecycle: 'all' }} />
      </PaperProvider>,
    );
    expect(rendered.getByLabelText('Alpha project, 2 active, expanded')).toBeTruthy();
    expect(rendered.getByTestId('chat-row-parent')).toBeTruthy();
  });

  test('task-mobile-chat-redesign-c4: cached grouped rows have one calm offline notice and no repeated project error', () => {
    // Regression caught: each project repeats offline/error feedback above otherwise usable cached rows.
    mockChatState.isOnline = false;
    mockChatState.isOfflineCache = true;
    mockChatState.error = 'Mac did not respond';
    const rendered = screen();

    expect(rendered.getAllByLabelText('Offline saved chats. Actions are unavailable.')).toHaveLength(1);
    expect(rendered.getByLabelText('Alpha project, 2 active, expanded')).toBeTruthy();
    expect(rendered.getByTestId('chat-row-parent')).toBeTruthy();
    expect(rendered.queryByText('Mac did not respond')).toBeNull();
  });

  test('task-mobile-agents-session-list-c1: compact rows replace outlined cards', () => {
    // Regression caught: restoring Card rows makes the session list visually noisy.
    const view = screen().getByTestId('chat-row-parent');
    expect(StyleSheet.flatten(view.props.style)).toEqual(expect.objectContaining({ minHeight: 72 }));
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

  test('task-ios-mobile-ui-c2: visible controls expose current filters and clear them', () => {
    // Regression caught: project/state filters are hidden in overflow with no visible way to clear them.
    const active = controller();
    active.projectId = '/projects/alpha';
    active.lifecycle = 'active';
    const rendered = render(
      <PaperProvider>
        <ChatList controller={active} />
      </PaperProvider>,
    );

    expect(rendered.getByRole('button', { name: 'New chat' })).toBeTruthy();
    expect(rendered.getAllByText('Alpha project').length).toBeGreaterThan(0);
    expect(rendered.getByText('Active')).toBeTruthy();
    expect(rendered.queryByText('All projects')).toBeNull();
    expect(rendered.queryByText('All states')).toBeNull();
    fireEvent.press(rendered.getByRole('button', { name: 'Clear filters' }));
    expect(active.setProjectId).toHaveBeenCalledWith(null);
    expect(active.setLifecycle).toHaveBeenCalledWith('all');
  });

  test('task-ios-mobile-ui-c2-refresh: refresh failure keeps existing rows and shows retry feedback', () => {
    // Regression caught: a refresh error replaces already loaded chats with an empty error state.
    mockChatState.error = 'Mac did not respond';
    const rendered = screen();

    expect(rendered.getByText('Parent chat')).toBeTruthy();
    expect(rendered.getByText('Mac did not respond')).toBeTruthy();
    expect(rendered.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  test('task-ios-mobile-ui-c2-empty: an empty account invites the first chat', () => {
    // Regression caught: an empty account is mislabeled as a filtered result.
    mockChatState.sessions = [];
    const empty = screen();
    expect(empty.getByText('No chats yet')).toBeTruthy();
  });

  test.each(['unsupported', 'retryableError', 'error', 'noAuthorizedComputer'] as const)(
    'signed-in bootstrap failure %s shows truthful recovery and retries only on press',
    (bootstrapState) => {
    // Regression caught: stale offline-cache copy renders a duplicate manual-pair warning behind recovery.
    mockChatState.sessions = [];
    mockChatState.isOnline = false;
    mockChatState.isOfflineCache = true;
    mockPairedHostState = {
      bootstrapState,
      message: 'The connection service is unavailable. A Rhythm Cloud update may be required.',
    };
    const unavailable = screen();

    expect(unavailable.getByText('Computer connection unavailable')).toBeTruthy();
    expect(unavailable.getByText('The connection service is unavailable. A Rhythm Cloud update may be required.')).toBeTruthy();
    expect(unavailable.queryByText('No chats yet')).toBeNull();
    expect(unavailable.queryByText(/pair this iPhone/i)).toBeNull();
    expect(mockRetryBootstrap).not.toHaveBeenCalled();
    fireEvent.press(unavailable.getByRole('button', { name: 'Retry connection' }));
    expect(mockRetryBootstrap).toHaveBeenCalledTimes(1);
    },
  );

  test('cached chats keep the offline warning during a bootstrap failure', () => {
    // Regression caught: widening the recovery state hid the offline banner above real rows.
    mockChatState.isOnline = false;
    mockChatState.isOfflineCache = true;
    mockPairedHostState = {
      bootstrapState: 'retryableError',
      message: 'Could not reach Rhythm Cloud. Retry the secure connection.',
    };
    const cached = screen();

    expect(cached.getByLabelText('Offline saved chats. Actions are unavailable.')).toBeTruthy();
    expect(cached.queryByText('Computer connection unavailable')).toBeNull();
  });

  test('task-ios-mobile-ui-c2-filtered-empty: filtered empty results offer Clear filters', () => {
    // Regression caught: an empty search looks like an account with no chats.
    const filtered = screen();
    fireEvent.changeText(filtered.getByLabelText('Search chats'), 'not-a-chat');
    expect(filtered.getByText('No matching chats')).toBeTruthy();
    expect(filtered.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });
});
