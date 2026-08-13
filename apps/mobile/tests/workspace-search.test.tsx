import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import AgentWorkspaceScreen from '@/app/agents/workspace';

const mockSearchWorkspaceFiles = jest.fn();

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

jest.mock('@/providers/opencode-provider', () => ({
  useOpencode: () => ({
    activeProject: { id: 'rhythm', label: 'Rhythm', path: 'rhythm' },
    activeProjectPath: 'rhythm',
    archiveSession: jest.fn(),
    archivedSessions: [],
    availableAgents: [],
    availableModels: [],
    chatPreferences: {},
    configuredProviders: [],
    connection: { status: 'connected' },
    createSession: jest.fn(),
    createWorktree: jest.fn(),
    currentProjectPath: 'rhythm',
    currentSessionId: undefined,
    deleteSession: jest.fn(),
    getWorkspaceRawVcsDiff: jest.fn(),
    getWorkspaceVcsDiff: jest.fn(),
    getWorkspaceVcsStatus: jest.fn(),
    initializeProjectGit: jest.fn(),
    isRefreshingSessions: false,
    isRefreshingWorkspaceCatalog: false,
    listWorkspaceDirectory: jest.fn(),
    openSession: jest.fn(),
    openWorkspaceFile: jest.fn(),
    projects: [{ id: 'rhythm', label: 'Rhythm', path: 'rhythm' }],
    refreshArchivedSessions: jest.fn(),
    refreshSessions: jest.fn(),
    refreshWorkspaceCatalog: jest.fn(),
    refreshWorkspaceStatus: jest.fn(),
    refreshWorktrees: jest.fn(),
    removeWorktree: jest.fn(),
    renameSession: jest.fn(),
    resetWorktree: jest.fn(),
    restoreSession: jest.fn(),
    saveWorkspaceFile: jest.fn(),
    searchWorkspaceFiles: mockSearchWorkspaceFiles,
    searchWorkspaceSymbols: jest.fn(),
    searchWorkspaceText: jest.fn(),
    selectProject: jest.fn(),
    selectedWorkspaceFile: undefined,
    serverRootPath: undefined,
    sessionPreviewById: {},
    sessions: [],
    sessionStatuses: {},
    updateProjectMetadata: jest.fn(),
    vcsInfo: { branch: 'main' },
    workspaceFiles: [],
    workspaceFileStatuses: [],
    worktrees: [],
  }),
}));

function screen() {
  const rendered = render(
    <PaperProvider>
      <AgentWorkspaceScreen />
    </PaperProvider>,
  );
  fireEvent.press(rendered.getByText('Files', { exact: true }));
  return rendered;
}

describe('Workspace file search relay feedback', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('issue-1387-c12: successful relay search renders the returned files directly', async () => {
    // Regression caught: a valid relay result is discarded because the screen
    // waits for a separate provider-state update instead of consuming it.
    mockSearchWorkspaceFiles.mockResolvedValue(['README.md', 'docs/README.md']);
    const rendered = screen();

    fireEvent.changeText(rendered.getByTestId('workspace-file-search'), 'README');
    fireEvent.press(rendered.getByTestId('workspace-search-button'));

    await waitFor(() => expect(rendered.getByText('README.md')).toBeTruthy());
    expect(rendered.getByText('docs/README.md')).toBeTruthy();
  });

  test('issue-1387-c13: an empty relay result has an explicit empty state', async () => {
    // Regression caught: a completed search that returns [] leaves the same
    // blank screen as an unsubmitted or stalled search.
    mockSearchWorkspaceFiles.mockResolvedValue([]);
    const rendered = screen();

    fireEvent.changeText(rendered.getByTestId('workspace-file-search'), 'missing-file');
    fireEvent.press(rendered.getByTestId('workspace-search-button'));

    await waitFor(() =>
      expect(rendered.getByText('No files match “missing-file”.')).toBeTruthy(),
    );
  });

  test('issue-1387-c14: a stalled relay search ends with a clear timeout', async () => {
    // Regression caught: a relay request that never settles leaves the phone
    // indefinitely blank with no actionable feedback.
    jest.useFakeTimers();
    mockSearchWorkspaceFiles.mockImplementation(
      (_query, signal: AbortSignal | undefined) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      }),
    );
    const rendered = screen();

    fireEvent.changeText(rendered.getByTestId('workspace-file-search'), 'README');
    fireEvent.press(rendered.getByTestId('workspace-search-button'));
    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(rendered.getByText('Workspace search timed out. Try again.')).toBeTruthy();
  });
});
