import type { FilePartInput, GlobalEvent, TextPartInput } from '@opencode-ai/sdk/v2/client';
import type {
  Command,
  Config,
  File,
  FileContent,
  FileDiff,
  GlobalSession,
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
  Project,
  Pty,
  PtyShellsResponse,
  SessionStatus,
  Todo,
  VcsInfo,
  Worktree,
} from '@/lib/opencode/types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Platform } from 'react-native';

import {
  buildClient,
  defaultConnectionSettings,
  getConnectionError,
  getNormalizedServerUrl,
  isValidServerUrl,
  listPendingInteractions,
  rejectPendingQuestion,
  replyToPendingPermission,
  replyToPendingQuestion,
  type PendingPermissionRequest,
  type PendingQuestionAnswer,
  type PendingQuestionRequest,
  type OpencodeConnectionSettings,
} from '@/lib/opencode/client';
import { buildGlobalEventStreamRequest } from '@/lib/opencode/client';
import { createTrailingCoalescer } from '@/lib/coalesce';
import {
  streamDirectGlobalEvents,
  streamPairedGlobalEvents,
} from '@/lib/opencode/global-event-stream';
import {
  toTranscriptEntry,
  type SessionMessageRecord,
} from '@/lib/opencode/format';
import {
  createSessionFetchTracker,
  mergeSessionMessages,
  pruneSessionMessage,
} from '@/lib/opencode/messages';
import {
  findEditableUserTextPart,
  isTranscriptDisplayMessage,
} from '@/lib/opencode/transcript';
import { aggregateSessionUsage, getLatestAssistantTurnUsage } from '@/lib/opencode/usage';
import { createFullFilePatch } from '@/lib/opencode/workspace-patch';
import {
  clearPendingTaskFinishedNotification,
  notifyTaskFinished,
  trackPendingTaskFinishedNotification,
  type PendingNotificationOrigin,
} from '@/lib/notifications';
import { speakText, stopSpeaking } from '@/lib/voice/speech-output';
import { useSpeechInput } from '@/lib/voice/use-speech-input';
import {
  startWorkingSoundAsync,
  stopWorkingSoundAsync,
  unloadWorkingSoundAsync,
} from '@/lib/voice/working-sound';
import {
  buildPromptExecutionPlan,
  defaultChatPreferences,
  applyProfileDefaults,
  getConfiguredProviderIds,
  getEnabledModelIds,
  getInitialMode,
  getInitialModelId,
  getInitialProviderId,
  getModelIdForProvider,
  getNewSessionPreferences,
  NO_SELECTABLE_PROFILE_MESSAGE,
  getProjectLabel,
  getSelectedModelParts,
  getSessionExecutionState,
  groupPendingRequestsBySession,
  hydratePreferencesFromSession,
  isAutoApproveEnabled,
  mergePermissionConfig,
  permissionModeForAutoApprove,
  replaceSessionExecutionState,
  sameGatewayProjectList,
  thinkingBudgetForReasoning,
} from '@/providers/opencode-provider-utils';
import {
  createOpenProjectSessionController,
  getOpenProjectSessionPresentation,
  type OpenProjectSessionController,
  type OpenProjectSessionResult,
  type OpenProjectSessionState,
  type ProjectSessionCatalog,
} from '@/providers/open-project-session';
import {
  canCommitBootstrappedSession,
  getConfiguredProviders,
  getConversationStatusLabel,
  getCurrentPendingRequests,
  getSessionPreviewById,
  getTranscript,
  getTranscriptActivityLabelForEntries,
  preserveReadySessionDuringRefresh,
  reconcileSessionSelectionAfterRefresh,
} from '@/providers/opencode-provider-selectors';
import {
  CONVERSATION_FINAL_RESULT_SETTLE_MS,
  CONVERSATION_KEEP_AWAKE_TAG,
  CONVERSATION_LISTENING_RESTART_MS,
  type AgentOption,
  type ChatPreferences,
  type ConnectionState,
  type ConversationPhase,
  type CreateSessionOptions,
  type ModelOption,
  type MobileSession,
  type OpencodeContextValue,
  type OpencodeProject,
  type ProviderAuthMethod,
  type ProviderOption,
  type SessionExecutionState,
  type WorkspaceCatalog,
} from '@/providers/opencode-provider-types';
import { useConversationKeepAwake } from '@/providers/use-conversation-keep-awake';
import { useConversationScreenDim } from '@/providers/use-conversation-screen-dim';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';
import { useOpencodePersistence } from '@/providers/use-opencode-persistence';
import {
  createMobileGatewaySession,
  listMobileGatewayProfiles,
  listMobileGatewayProjects,
  updateMobileSessionProfileState,
} from '@/providers/services/mobile-gateway-service';
import {
  loadWorkspaceCatalog as svcLoadWorkspaceCatalog,
  archiveSession as svcArchiveSession,
  listArchivedSessions as svcListArchivedSessions,
  listSessions as svcListSessions,
  resolveOwnerDiscoveredSession,
  getSessionMessages as svcGetSessionMessages,
  getSessionDiff as svcGetSessionDiff,
  getSessionTodos as svcGetSessionTodos,
  deleteSession as svcDeleteSession,
  deleteSessionMessage as svcDeleteSessionMessage,
  deleteSessionPart as svcDeleteSessionPart,
  executeCommand as svcExecuteCommand,
  forkSession as svcForkSession,
  getSessionChildren as svcGetSessionChildren,
  listCommands as svcListCommands,
  initializeSession as svcInitializeSession,
  revertSession as svcRevertSession,
  runSessionShell as svcRunSessionShell,
  unrevertSession as svcUnrevertSession,
  updateSessionTitle as svcUpdateSessionTitle,
  updateSessionPart as svcUpdateSessionPart,
  restoreSession as svcRestoreSession,
} from '@/providers/services/session-service';
import { loadDiagnostics, type Diagnostics } from '@/providers/services/diagnostics-service';
import {
  applyVcsPatch,
  createWorktree as svcCreateWorktree,
  findFiles,
  findSymbols,
  findText,
  getFileStatus,
  getRawVcsDiff,
  getVcsDiff,
  getVcsInfo,
  getVcsStatus,
  listFiles,
  listWorktrees as svcListWorktrees,
  readFile,
  removeWorktree as svcRemoveWorktree,
  resetWorktree as svcResetWorktree,
} from '@/providers/services/workspace-service';
import {
  addMcpServer as svcAddMcpServer,
  completeMcpOAuth as svcCompleteMcpOAuth,
  connectMcpServer as svcConnectMcpServer,
  disconnectMcpServer as svcDisconnectMcpServer,
  getMcpStatus,
  removeMcpOAuth as svcRemoveMcpOAuth,
  setMcpServerEnabled as svcSetMcpServerEnabled,
  startMcpOAuth as svcStartMcpOAuth,
} from '@/providers/services/mcp-service';
import {
  createTerminal as svcCreateTerminal,
  createTerminalConnectToken,
  getTerminal as svcGetTerminal,
  getTerminalWebSocketUrl,
  listShells,
  listTerminals,
  removeTerminal as svcRemoveTerminal,
  updateTerminal as svcUpdateTerminal,
} from '@/providers/services/terminal-service';
import {
  loadOpenCodeInspection as svcLoadOpenCodeInspection,
  reloadOpenCodeConfig as svcReloadOpenCodeConfig,
  reloadOpenCodeSkills as svcReloadOpenCodeSkills,
} from '@/providers/services/opencode-inspection-service';
import {
  initializeProjectGit as svcInitializeProjectGit,
  updateProjectMetadata as svcUpdateProjectMetadata,
} from '@/providers/services/project-service';
import {
  getRecoveryDelayMs,
  getStableRecoveryEventId,
} from '@/providers/services/agent-chat-service';
import { pollForNewAssistantTurn } from '@/providers/services/post-prompt-refresh';

export type {
  AgentOption,
  ChatPreferences,
  ConnectionState,
  ConversationPhase,
  ConversationState,
  ModelOption,
  OpencodeContextValue,
  OpencodeProject,
  ProviderAuthMethod,
  ProviderOption,
  ReasoningLevel,
  ResponseScope,
} from '@/providers/opencode-provider-types';

const OpencodeContext = createContext<OpencodeContextValue | null>(null);
const ANSI_CSI_PATTERN = new RegExp('\\u001b\\[[0-?]*[ -/]*[@-~]', 'gi');

function authenticatedWebSocket(
  url: string,
  headers: Record<string, string>,
): WebSocket {
  const Constructor = WebSocket as unknown as new (
    socketUrl: string,
    protocols: string[],
    options: { headers: Record<string, string> },
  ) => WebSocket;
  return new Constructor(url, [], { headers });
}

type OpenProjectSessionCatalog = {
  sessions: MobileSession[];
  statuses: Record<string, SessionStatus>;
};

type OpenProjectSessionPayload = Record<string, unknown> & {
  diffs: FileDiff[];
  messages: SessionMessageRecord[];
  messageNextCursor?: string;
  permissions: PendingPermissionRequest[];
  projectId: string;
  questions: PendingQuestionRequest[];
  session: MobileSession;
  sessionId: string;
  sessions: MobileSession[];
  statuses: Record<string, SessionStatus>;
  supplemental: Promise<{
    diffs: FileDiff[];
    permissions: PendingPermissionRequest[];
    questions: PendingQuestionRequest[];
    todos: Todo[];
  }>;
  todos: Todo[];
};

type OpenProjectSessionRuntime = {
  commit(payload: OpenProjectSessionPayload): void;
  confirmProject(projectId: string): Promise<boolean>;
  listSessions(projectId: string): Promise<OpenProjectSessionCatalog>;
  resolveSession(
    projectId: string,
    sessionId: string,
  ): Promise<MobileSession | undefined>;
  loadSessionState(
    projectId: string,
    sessionId: string,
    session: MobileSession,
    catalog: ProjectSessionCatalog<MobileSession>,
  ): Promise<OpenProjectSessionPayload>;
  openFromCache(
    projectId: string,
    sessionId: string,
  ): OpenProjectSessionPayload | undefined;
};

export function OpencodeProvider({ children }: PropsWithChildren) {
  const pairedHost = usePairedHost();
  const pairedHostClient = pairedHost.client;
  const pairedHostRecord = pairedHost.host;
  const pairedHostMessage = pairedHost.message;
  const refreshPairedHost = pairedHost.refresh;
  const pairedHostState = pairedHost.state;
  const rhythmAccount = useRhythmAccount();
  const [settings, setSettings] = useState<OpencodeConnectionSettings>(defaultConnectionSettings);
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'idle',
    message: 'Add a server URL and connect to OpenCode.',
  });
  const [activeProjectPath, setActiveProjectPath] = useState<string>();
  const [sessions, setSessions] = useState<MobileSession[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<GlobalSession[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string>();
  const [messagesBySession, setMessagesBySession] = useState<Record<string, SessionMessageRecord[]>>({});
  const [hasOlderMessagesBySession, setHasOlderMessagesBySession] = useState<Record<string, boolean>>({});
  const [diffsBySession, setDiffsBySession] = useState<Record<string, FileDiff[]>>({});
  const [todosBySession, setTodosBySession] = useState<Record<string, Todo[]>>({});
  const [pendingPermissionsBySession, setPendingPermissionsBySession] = useState<Record<string, PendingPermissionRequest[]>>({});
  const [pendingQuestionsBySession, setPendingQuestionsBySession] = useState<Record<string, PendingQuestionRequest[]>>({});
  const [serverProjects, setServerProjects] = useState<Project[]>([]);
  const [currentProjectPath, setCurrentProjectPath] = useState<string>();
  const [serverRootPath, setServerRootPath] = useState<string>();
  // browsing server folders removed
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [isRefreshingDiffs, setIsRefreshingDiffs] = useState(false);
  const [isRefreshingWorkspaceCatalog, setIsRefreshingWorkspaceCatalog] = useState(false);
  // browsing removed
  const [isBootstrappingChat, setIsBootstrappingChat] = useState(false);
  const [openProjectSessionState, setOpenProjectSessionState] =
    useState<OpenProjectSessionState>({ kind: 'idle' });
  const [sendingState, setSendingState] = useState<{ sessionId?: string; active: boolean }>({ active: false });
  const [promptError, setPromptError] = useState<{ message: string; occurredAt: number; sessionId?: string }>();
  const pendingNotificationSessionIdsRef = useRef<Set<string>>(new Set());
  const busyNotificationSessionIdsRef = useRef<Set<string>>(new Set());
  const notificationRequestedAtRef = useRef(new Map<string, number>());
  const pendingNotificationOriginBySessionIdRef =
    useRef(new Map<string, PendingNotificationOrigin>());
  const promptSubmissionRef = useRef<{ active: boolean; sessionId?: string }>({ active: false });
  const [currentConfig, setCurrentConfig] = useState<Config>();
  const [availableProviders, setAvailableProviders] = useState<ProviderOption[]>([]);
  const [providerAuthMethodsById, setProviderAuthMethodsById] = useState<Record<string, ProviderAuthMethod[]>>({});
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(defaultChatPreferences);
  const [lastSessionByProject, setLastSessionByProject] = useState<Record<string, string>>({});
  const [conversationPhase, setConversationPhase] = useState<ConversationPhase>('off');
  const [conversationSessionId, setConversationSessionId] = useState<string>();
  const [queuedConversationPrompt, setQueuedConversationPrompt] = useState<string>();
  const [pendingConversationTurn, setPendingConversationTurn] = useState<string>();
  const [conversationFeedback, setConversationFeedback] = useState<string>();
  const [conversationLatestHeardText, setConversationLatestHeardText] = useState<string>();
  const [eventStreamStatus, setEventStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [commands, setCommands] = useState<Command[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceFileStatuses, setWorkspaceFileStatuses] = useState<File[]>([]);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<{ path: string; content: FileContent }>();
  const [vcsInfo, setVcsInfo] = useState<VcsInfo>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [worktrees, setWorktrees] = useState<(string | Worktree)[]>([]);
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, McpStatus>>({});
  const [terminals, setTerminals] = useState<Pty[]>([]);
  const [terminalShells, setTerminalShells] = useState<PtyShellsResponse>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>();
  const [terminalOutput, setTerminalOutput] = useState('');
  const [terminalConnection, setTerminalConnection] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');

  const settingsRef = useRef(settings);
  const activeProjectPathRef = useRef(activeProjectPath);
  // Session records for chats opened this launch, surviving project-scope
  // switches (which clear `sessions`). Backs cross-project cache-first opens.
  const openedSessionRecordCacheRef = useRef(
    new Map<string, { projectId: string; session: MobileSession }>(),
  );
  const openProjectSessionRuntimeRef =
    useRef<OpenProjectSessionRuntime | null>(null);
  const openProjectSessionControllerRef =
    useRef<OpenProjectSessionController | null>(null);
  const sessionsRef = useRef(sessions);
  const currentSessionIdRef = useRef(currentSessionId);
  const scopeGenerationRef = useRef(0);
  const serverGenerationRef = useRef(0);
  const clientGenerationRef = useRef(new WeakMap<object, number>());
  const catalogGenerationRef = useRef(new WeakMap<object, number>());
  const connectionTargetRef = useRef('');
  const bootstrapPromiseRef = useRef<Promise<string | undefined> | null>(null);
  const bootstrapTokenRef = useRef<object | undefined>(undefined);
  const conversationPhaseRef = useRef<ConversationPhase>('off');
  const assistantReplyBaselineIdRef = useRef<string | undefined>(undefined);
  const conversationResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationFinalResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationListeningRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationCancelRequestedRef = useRef(false);
  const conversationSubmittingRef = useRef(false);
  const pendingConversationTranscriptRef = useRef<string | undefined>(undefined);
  const flushPendingConversationResultRef = useRef<() => void>(() => undefined);
  const sessionRefreshTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sessionRefreshOptionsRef = useRef<Record<string, { messages?: boolean; diff?: boolean; todos?: boolean; sessions?: boolean }>>({});
  const messageFetchTrackerRef = useRef(createSessionFetchTracker());
  const olderMessageCursorBySessionRef = useRef(new Map<string, string | null>());
  const sessionsFetchSequenceRef = useRef(0);
  const archivedSessionsFetchSequenceRef = useRef(0);
  const terminalSocketRef = useRef<WebSocket | undefined>(undefined);
  const terminalCursorByIdRef = useRef<Record<string, string>>({});
  const terminalOpenGenerationRef = useRef(0);
  settingsRef.current = settings;
  activeProjectPathRef.current = activeProjectPath;
  sessionsRef.current = sessions;
  currentSessionIdRef.current = currentSessionId;

  const clearTrackedPendingNotification = useCallback(
    async (sessionId: string) => {
      const origin =
        pendingNotificationOriginBySessionIdRef.current.get(sessionId);
      if (!origin) return;
      await clearPendingTaskFinishedNotification(sessionId, origin);
      pendingNotificationOriginBySessionIdRef.current.delete(sessionId);
    },
    [],
  );

  const clearPendingConversationResult = useCallback(() => {
    pendingConversationTranscriptRef.current = undefined;
    if (conversationFinalResultTimeoutRef.current) {
      clearTimeout(conversationFinalResultTimeoutRef.current);
      conversationFinalResultTimeoutRef.current = undefined;
    }
  }, []);

  const { isHydrated } = useOpencodePersistence({
    defaultChatPreferences,
    defaultSettings: defaultConnectionSettings,
    activeProjectPath,
    chatPreferences,
    lastSessionByProject,
    setActiveProjectPath,
    setChatPreferences,
    setLastSessionByProject,
    setSettings,
    settings,
    accountUserId: rhythmAccount.user?.id ?? null,
  });

  const projects = useMemo<OpencodeProject[]>(() => {
    const entries = new Map<string, OpencodeProject>();

    serverProjects.forEach((project) => {
      const displayName = (project as Project & { name?: string }).name;
      entries.set(project.worktree, {
        id: project.id,
        label: displayName?.trim() || getProjectLabel(project.worktree),
        path: project.worktree,
        source: 'server',
        updatedAt: project.time.initialized || project.time.created,
        isCurrent: project.worktree === currentProjectPath,
      });
    });

    if (activeProjectPath && !entries.has(activeProjectPath)) {
      entries.set(activeProjectPath, {
        label: getProjectLabel(activeProjectPath),
        path: activeProjectPath,
        source: 'server',
        isCurrent: activeProjectPath === currentProjectPath,
      });
    }

    return [...entries.values()].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  }, [activeProjectPath, currentProjectPath, serverProjects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.path === activeProjectPath),
    [activeProjectPath, projects],
  );
  const registeredGatewayProjectIds = useMemo(
    () =>
      new Set(
        serverProjects
          .filter(
            (project) =>
              project.id.trim().length > 0 &&
              project.id === project.worktree,
          )
          .map((project) => project.id),
      ),
    [serverProjects],
  );

  const buildScopedClient = useCallback(
    (projectId: string) => {
      if (!pairedHost.client) {
        return buildClient({ ...settings, directory: projectId });
      }
      const registeredProjectId = registeredGatewayProjectIds.has(projectId)
        ? projectId
        : '';
      return buildClient(
        { ...settings, directory: registeredProjectId },
        { client: pairedHost.client, projectId: registeredProjectId },
      );
    },
    [pairedHost.client, registeredGatewayProjectIds, settings],
  );
  const client = useMemo(
    () => {
      if (pairedHost.client) {
        return buildScopedClient(activeProjectPath ?? '');
      }
      return activeProjectPath
        ? buildScopedClient(activeProjectPath)
        : buildClient({ ...settings, directory: '' });
    },
    [activeProjectPath, buildScopedClient, pairedHost.client, settings],
  );
  const catalogClient = useMemo(() => buildClient({ ...settings, directory: '' }), [settings]);
  if (!clientGenerationRef.current.has(client)) {
    clientGenerationRef.current.set(client, scopeGenerationRef.current);
  }
  if (!catalogGenerationRef.current.has(catalogClient)) {
    catalogGenerationRef.current.set(catalogClient, serverGenerationRef.current);
  }
  const isCurrentClient = useCallback(
    (candidate: object) => clientGenerationRef.current.get(candidate) === scopeGenerationRef.current,
    [],
  );
  const isCurrentCatalogClient = useCallback(
    (candidate: object) => catalogGenerationRef.current.get(candidate) === serverGenerationRef.current,
    [],
  );

  const clearProjectState = useCallback(() => {
    bootstrapPromiseRef.current = null;
    bootstrapTokenRef.current = undefined;
    pendingNotificationSessionIdsRef.current.clear();
    busyNotificationSessionIdsRef.current.clear();
    notificationRequestedAtRef.current.clear();
    setCurrentSessionId(undefined);
    setSessions([]);
    setArchivedSessions([]);
    setHasOlderMessagesBySession({});
    olderMessageCursorBySessionRef.current.clear();
    setSessionStatuses({});
    setCommands([]);
    setCurrentConfig(undefined);
    setAvailableProviders([]);
    setProviderAuthMethodsById({});
    setAvailableModels([]);
    setAvailableAgents([]);
    setPendingPermissionsBySession({});
    setPendingQuestionsBySession({});
    setWorkspaceFiles([]);
    setWorkspaceFileStatuses([]);
    setSelectedWorkspaceFile(undefined);
    setVcsInfo(undefined);
    setWorktrees([]);
    setMcpStatuses({});
    setTerminals([]);
    setTerminalShells([]);
    setActiveTerminalId(undefined);
    setTerminalOutput('');
    setTerminalConnection('idle');
    terminalSocketRef.current?.close();
    terminalSocketRef.current = undefined;
    terminalCursorByIdRef.current = {};
    terminalOpenGenerationRef.current += 1;
  }, []);

  // browseServerPath stub removed

  const loadWorkspaceCatalog = useCallback(
    async (silent = false): Promise<WorkspaceCatalog> => {
      if (!silent) {
        setIsRefreshingWorkspaceCatalog(true);
      }

      try {
        const result: WorkspaceCatalog = pairedHost.client
          ? await listMobileGatewayProjects(pairedHost.client).then(
              (mobileProjects) => {
                const now = Date.now();
                const serverProjects = mobileProjects.map(
                  (project, index) =>
                    ({
                      id: project.id,
                      name: project.name,
                      icon: project.icon,
                      worktree: project.id,
                      vcs: 'git',
                      time: {
                        created: now - index,
                        initialized: now - index,
                      },
                    }) as unknown as Project,
                );
                const selected = activeProjectPathRef.current;
                const currentProjectPath =
                  selected &&
                  serverProjects.some(
                    (project) => project.worktree === selected,
                  )
                    ? selected
                    : serverProjects[0]?.worktree;
                return {
                  currentProjectPath,
                  serverProjects,
                };
              },
            )
          : await svcLoadWorkspaceCatalog(catalogClient);
        if (!isCurrentCatalogClient(catalogClient)) {
          return result;
        }
        setServerProjects((current) =>
          pairedHost.client && sameGatewayProjectList(
            current,
            result.serverProjects as Project[],
          )
            ? current
            : result.serverProjects as Project[],
        );
        setCurrentProjectPath(result.currentProjectPath);
        setServerRootPath(result.serverRootPath);
        const currentProject = activeProjectPathRef.current;
        const nextProject = currentProject && result.serverProjects.some((project) => project.worktree === currentProject)
          ? currentProject
          : result.currentProjectPath || result.serverProjects[0]?.worktree;
        if (nextProject !== currentProject) {
          scopeGenerationRef.current += 1;
          clearProjectState();
          setActiveProjectPath(nextProject);
        }
        return result;
      } finally {
        if (!silent) {
          setIsRefreshingWorkspaceCatalog(false);
        }
      }
    },
    [
      catalogClient,
      clearProjectState,
      isCurrentCatalogClient,
      pairedHost.client,
    ],
  );

  const refreshWorkspaceCatalog = useCallback(
    async (silent = false) => {
      await loadWorkspaceCatalog(silent);
    },
    [loadWorkspaceCatalog],
  );

  const fetchSessions = useCallback(
    async (silent = false) => {
      const fetchSequence = ++sessionsFetchSequenceRef.current;
      if (!activeProjectPath) {
        setSessions([]);
        setSessionStatuses({});
        return [];
      }

      if (!silent) {
        setIsRefreshingSessions(true);
      }

      try {
        const result = await svcListSessions(client);
        if (
          !isCurrentClient(client) ||
          fetchSequence !== sessionsFetchSequenceRef.current
        ) {
          return result.sessions;
        }
        // Keep the cross-scope record cache fresh so cache-first opens never
        // hydrate stale profile/model state (#1287).
        if (activeProjectPathRef.current) {
          for (const session of result.sessions as MobileSession[]) {
            if (openedSessionRecordCacheRef.current.has(session.id)) {
              openedSessionRecordCacheRef.current.set(session.id, {
                projectId: activeProjectPathRef.current,
                session,
              });
            }
          }
        }
        setSessions((current) =>
          preserveReadySessionDuringRefresh({
            activeProjectId: activeProjectPathRef.current,
            currentSessionId: currentSessionIdRef.current,
            currentSessions: current,
            openState:
              openProjectSessionControllerRef.current?.getState() ?? {
                kind: 'idle',
              },
            refreshedSessions: result.sessions as MobileSession[],
          }),
        );
        setSessionStatuses(result.statuses);
        return result.sessions as MobileSession[];
      } finally {
        if (!silent) {
          setIsRefreshingSessions(false);
        }
      }
    },
    [activeProjectPath, client, isCurrentClient],
  );

  const refreshSessions = useCallback(
    async (silent = false) => {
      await fetchSessions(silent);
    },
    [fetchSessions],
  );

  const refreshMessages = useCallback(
    async (sessionId: string, silent = false) => {
      const fetchToken = messageFetchTrackerRef.current.start(sessionId);
      if (!silent) {
        setIsRefreshingMessages(true);
      }

      try {
        const page = await svcGetSessionMessages(client, sessionId);
        if (
          !isCurrentClient(client) ||
          !messageFetchTrackerRef.current.isLatest(sessionId, fetchToken)
        ) {
          return page.records;
        }
        setMessagesBySession((current) => ({
          ...current,
          [sessionId]: mergeSessionMessages(
            current[sessionId] || [],
            page.records,
          ),
        }));
        if (!olderMessageCursorBySessionRef.current.has(sessionId)) {
          olderMessageCursorBySessionRef.current.set(
            sessionId,
            page.nextCursor ?? null,
          );
          setHasOlderMessagesBySession((current) => ({
            ...current,
            [sessionId]: Boolean(page.nextCursor),
          }));
        }

        return page.records;
      } finally {
        if (!silent) {
          setIsRefreshingMessages(false);
        }
      }
    },
    [client, isCurrentClient],
  );

  const replaceSessionMessages = useCallback(
    async (sessionId: string, silent = false) => {
      const fetchToken = messageFetchTrackerRef.current.start(sessionId);
      if (!silent) setIsRefreshingMessages(true);
      try {
        const page = await svcGetSessionMessages(client, sessionId);
        if (
          !isCurrentClient(client) ||
          !messageFetchTrackerRef.current.isLatest(sessionId, fetchToken)
        ) {
          return page.records;
        }
        setMessagesBySession((current) => ({
          ...current,
          [sessionId]: page.records,
        }));
        olderMessageCursorBySessionRef.current.set(
          sessionId,
          page.nextCursor ?? null,
        );
        setHasOlderMessagesBySession((current) => ({
          ...current,
          [sessionId]: Boolean(page.nextCursor),
        }));
        return page.records;
      } finally {
        if (!silent) setIsRefreshingMessages(false);
      }
    },
    [client, isCurrentClient],
  );

  const loadOlderMessages = useCallback(async (sessionId: string) => {
    const cursor = olderMessageCursorBySessionRef.current.get(sessionId);
    if (!cursor) return;
    const fetchToken = messageFetchTrackerRef.current.start(sessionId);
    setIsRefreshingMessages(true);
    try {
      const page = await svcGetSessionMessages(client, sessionId, { cursor });
      if (
        !isCurrentClient(client) ||
        !messageFetchTrackerRef.current.isLatest(sessionId, fetchToken)
      ) {
        return;
      }
      setMessagesBySession((current) => ({
        ...current,
        [sessionId]: mergeSessionMessages(
          current[sessionId] || [],
          page.records,
        ),
      }));
      olderMessageCursorBySessionRef.current.set(
        sessionId,
        page.nextCursor ?? null,
      );
      setHasOlderMessagesBySession((current) => ({
        ...current,
        [sessionId]: Boolean(page.nextCursor),
      }));
    } finally {
      setIsRefreshingMessages(false);
    }
  }, [client, isCurrentClient]);

  const refreshSessionDiff = useCallback(
    async (sessionId: string, silent = false) => {
      if (!silent) {
        setIsRefreshingDiffs(true);
      }

      try {
        const data = await svcGetSessionDiff(client, sessionId);
        if (!isCurrentClient(client)) {
          return data;
        }
        setDiffsBySession((current) => ({
          ...current,
          [sessionId]: data,
        }));

        return data;
      } finally {
        if (!silent) {
          setIsRefreshingDiffs(false);
        }
      }
    },
    [client, isCurrentClient],
  );

  const refreshSessionTodos = useCallback(
    async (sessionId: string) => {
      const data = await svcGetSessionTodos(client, sessionId);
      if (!isCurrentClient(client)) {
        return data;
      }

      setTodosBySession((current) => ({
        ...current,
        [sessionId]: data,
      }));

      return data;
    },
    [client, isCurrentClient],
  );

  const refreshPendingInteractions = useCallback(async () => {
    const { permissions, questions } = await listPendingInteractions(client);
    if (!isCurrentClient(client)) {
      return;
    }
    setPendingPermissionsBySession(groupPendingRequestsBySession(permissions));
    setPendingQuestionsBySession(groupPendingRequestsBySession(questions));
  }, [client, isCurrentClient]);

  openProjectSessionRuntimeRef.current = {
    openFromCache(projectId, sessionId) {
      // Cache-first switching: a chat whose transcript is already hydrated
      // renders instantly from memory; a silent background revalidation and
      // the live event stream supply any delta. Only valid while the target
      // project is already the active scope — project switches must take the
      // full pipeline so scope-sensitive state is rebuilt.
      if (connection.status !== 'connected') return undefined;
      if (pairedHostRecord && pairedHostState !== 'connected') {
        return undefined;
      }
      const messages = messagesBySession[sessionId];
      if (!messages || messages.length === 0) {
        return undefined;
      }
      let session: MobileSession | undefined;
      if (projectId === activeProjectPathRef.current) {
        session = sessions.find((candidate) => candidate.id === sessionId);
      } else {
        // Cross-project reopen: the scope switch cleared `sessions`, but a
        // chat opened this launch keeps its record cached. Committing through
        // the normal switching path re-scopes the provider while the cached
        // transcript renders immediately.
        const record = openedSessionRecordCacheRef.current.get(sessionId);
        session = record?.projectId === projectId ? record.session : undefined;
      }
      if (!session) return undefined;
      scheduleSessionRefresh(sessionId, {
        sessions: true,
        messages: true,
        diff: true,
        todos: true,
      });
      const cachedInteractions = {
        permissions: Object.values(pendingPermissionsBySession).flat(),
        questions: Object.values(pendingQuestionsBySession).flat(),
      };
      return {
        diffs: diffsBySession[sessionId] ?? [],
        messages,
        permissions: cachedInteractions.permissions,
        projectId,
        questions: cachedInteractions.questions,
        session,
        sessionId,
        sessions: projectId === activeProjectPathRef.current
          ? sessions
          : [session],
        statuses: sessionStatuses,
        supplemental: Promise.resolve({
          diffs: diffsBySession[sessionId] ?? [],
          permissions: cachedInteractions.permissions,
          questions: cachedInteractions.questions,
          todos: todosBySession[sessionId] ?? [],
        }),
        todos: todosBySession[sessionId] ?? [],
      };
    },
    async confirmProject(projectId) {
      if (
        connection.status !== 'connected' ||
        (pairedHostRecord && pairedHostState !== 'connected')
      ) {
        throw Object.assign(
          new Error(pairedHostMessage || connection.message),
          { code: 'NETWORK_ERROR', status: 0 },
        );
      }
      return serverProjects.some(
        (project) =>
          project.id === projectId || project.worktree === projectId,
      );
    },
    async listSessions(projectId) {
      const result = await svcListSessions(buildScopedClient(projectId));
      return {
        sessions: result.sessions as MobileSession[],
        statuses: result.statuses,
      };
    },
    async resolveSession(projectId, sessionId) {
      return resolveOwnerDiscoveredSession(
        buildScopedClient(projectId),
        sessionId,
      ) as Promise<MobileSession | undefined>;
    },
    async loadSessionState(
      projectId,
      sessionId,
      session,
      catalog,
    ) {
      const scopedClient = buildScopedClient(projectId);
      const messagePage = await svcGetSessionMessages(scopedClient, sessionId);
      const messages = messagePage.records;
      const supplemental = Promise.all([
        svcGetSessionTodos(scopedClient, sessionId).catch(() => [] as Todo[]),
        listPendingInteractions(scopedClient).catch(() => ({
          permissions: [] as PendingPermissionRequest[],
          questions: [] as PendingQuestionRequest[],
        })),
        svcGetSessionDiff(scopedClient, sessionId, messages).catch(
          () => [] as FileDiff[],
        ),
      ]).then(([todos, pending, diffs]) => ({
        diffs,
        permissions: pending.permissions,
        questions: pending.questions,
        todos,
      }));
      const loadedCatalog = Array.isArray(catalog)
        ? { sessions: catalog, statuses: {} }
        : (catalog as OpenProjectSessionCatalog);
      return {
        diffs: [],
        messages,
        messageNextCursor: messagePage.nextCursor,
        permissions: [],
        projectId,
        questions: [],
        session,
        sessionId,
        sessions: loadedCatalog.sessions,
        statuses: loadedCatalog.statuses,
        supplemental,
        todos: [],
      };
    },
    commit(payload) {
      const switchingProject =
        activeProjectPathRef.current !== payload.projectId;
      if (switchingProject) {
        scopeGenerationRef.current += 1;
        clearProjectState();
      }
      activeProjectPathRef.current = payload.projectId;
      setActiveProjectPath(payload.projectId);
      setSessions(payload.sessions);
      setSessionStatuses(payload.statuses);
      // Transcript caches are keyed by session id and hold scope-independent
      // data — preserving them across project switches is what makes
      // cross-project chat switching instant (issue #1287 cache-first).
      setMessagesBySession((current) => ({
        ...current,
        [payload.sessionId]: mergeSessionMessages(
          current[payload.sessionId] || [],
          payload.messages,
        ),
      }));
      if (!olderMessageCursorBySessionRef.current.has(payload.sessionId)) {
        olderMessageCursorBySessionRef.current.set(
          payload.sessionId,
          payload.messageNextCursor ?? null,
        );
        setHasOlderMessagesBySession((current) => ({
          ...(switchingProject ? {} : current),
          [payload.sessionId]: Boolean(payload.messageNextCursor),
        }));
      }
      setDiffsBySession((current) => ({
        ...current,
        [payload.sessionId]: payload.diffs,
      }));
      setTodosBySession((current) => ({
        ...current,
        [payload.sessionId]: payload.todos,
      }));
      setPendingPermissionsBySession(
        groupPendingRequestsBySession(payload.permissions),
      );
      setPendingQuestionsBySession(
        groupPendingRequestsBySession(payload.questions),
      );
      openedSessionRecordCacheRef.current.set(payload.sessionId, {
        projectId: payload.projectId,
        session: payload.session,
      });
      const authoritative = getSessionExecutionState(payload.session);
      if (authoritative) {
        setChatPreferences((current) =>
          hydratePreferencesFromSession(authoritative, current));
      }
      setLastSessionByProject((current) => ({
        ...current,
        [payload.projectId]: payload.sessionId,
      }));
      currentSessionIdRef.current = payload.sessionId;
      setCurrentSessionId(payload.sessionId);
      void payload.supplemental.then((next) => {
        if (
          activeProjectPathRef.current !== payload.projectId ||
          currentSessionIdRef.current !== payload.sessionId
        ) {
          return;
        }
        setDiffsBySession((current) => ({
          ...current,
          [payload.sessionId]: next.diffs,
        }));
        setTodosBySession((current) => ({
          ...current,
          [payload.sessionId]: next.todos,
        }));
        setPendingPermissionsBySession(
          groupPendingRequestsBySession(next.permissions),
        );
        setPendingQuestionsBySession(
          groupPendingRequestsBySession(next.questions),
        );
      });
    },
  };

  if (!openProjectSessionControllerRef.current) {
    openProjectSessionControllerRef.current =
      createOpenProjectSessionController<MobileSession, OpenProjectSessionPayload>({
        commit(payload) {
          const runtime = openProjectSessionRuntimeRef.current;
          if (!runtime) throw new Error('Session opener is unavailable.');
          runtime.commit(payload);
        },
        onStateChange: setOpenProjectSessionState,
        transport: {
          confirmProject(projectId) {
            const runtime = openProjectSessionRuntimeRef.current;
            if (!runtime) throw new Error('Session opener is unavailable.');
            return runtime.confirmProject(projectId);
          },
          listSessions(projectId) {
            const runtime = openProjectSessionRuntimeRef.current;
            if (!runtime) throw new Error('Session opener is unavailable.');
            return runtime.listSessions(projectId);
          },
          resolveSession(projectId, sessionId) {
            const runtime = openProjectSessionRuntimeRef.current;
            if (!runtime) throw new Error('Session opener is unavailable.');
            return runtime.resolveSession(projectId, sessionId);
          },
          loadSessionState(projectId, sessionId, session, catalog) {
            const runtime = openProjectSessionRuntimeRef.current;
            if (!runtime) throw new Error('Session opener is unavailable.');
            return runtime.loadSessionState(
              projectId,
              sessionId,
              session,
              catalog,
            );
          },
          openFromCache(projectId, sessionId) {
            return openProjectSessionRuntimeRef.current?.openFromCache(
              projectId,
              sessionId,
            );
          },
        },
      });
  }

  const openProjectSession = useCallback(
    (projectId: string, sessionId: string): Promise<OpenProjectSessionResult> =>
      openProjectSessionControllerRef.current!.openProjectSession(
        projectId,
        sessionId,
      ),
    [],
  );

  const cancelOpenProjectSession = useCallback(() => {
    openProjectSessionControllerRef.current?.cancelOpenProjectSession();
  }, []);

  // Cache-first opens can hydrate from a record captured before the session's
  // authoritative execution state was known. When a refreshed record for the
  // open session carries a real binding, re-hydrate so Session Config shows
  // the true profile instead of a stale/Unassigned snapshot (#1286).
  useEffect(() => {
    if (!currentSessionId) return;
    const state = getSessionExecutionState(
      sessions.find((session) => session.id === currentSessionId),
    );
    if (!state || !(state.profileId || state.providerId || state.modelId)) {
      return;
    }
    setChatPreferences((current) =>
      (current.profileId ?? null) === (state.profileId ?? null) &&
      (current.providerId ?? null) === (state.providerId ?? current.providerId ?? null) &&
      (current.modelId ?? null) === (state.modelId ?? current.modelId ?? null)
        ? current
        : hydratePreferencesFromSession(state, current));
  }, [currentSessionId, sessions]);

  const scheduleSessionRefresh = useCallback(
    (sessionId: string, options?: { messages?: boolean; diff?: boolean; todos?: boolean; sessions?: boolean; delayMs?: number }) => {
      if (!sessionId) {
        return;
      }

      const existing = sessionRefreshTimeoutsRef.current[sessionId];
      if (existing) {
        clearTimeout(existing);
      }

      const pending = sessionRefreshOptionsRef.current[sessionId] || {};
      sessionRefreshOptionsRef.current[sessionId] = {
        messages: pending.messages || options?.messages,
        diff: pending.diff || options?.diff,
        todos: pending.todos || options?.todos,
        sessions: pending.sessions || options?.sessions,
      };

      sessionRefreshTimeoutsRef.current[sessionId] = setTimeout(() => {
        delete sessionRefreshTimeoutsRef.current[sessionId];
        const mergedOptions = sessionRefreshOptionsRef.current[sessionId] || {};
        delete sessionRefreshOptionsRef.current[sessionId];

        // A timer scheduled before a project switch fires under the new
        // scope; the gateway correctly rejects the out-of-scope session with
        // a 404, so skip it rather than surfacing unhandled rejections.
        const sessionInScope =
          currentSessionIdRef.current === sessionId ||
          sessionsRef.current.some((session) => session.id === sessionId);
        if (mergedOptions.sessions) {
          void refreshSessions(true).catch(() => undefined);
        }
        if (!sessionInScope) return;
        if (mergedOptions.messages) {
          void refreshMessages(sessionId, true).catch(() => undefined);
        }
        if (mergedOptions.diff) {
          void refreshSessionDiff(sessionId, true).catch(() => undefined);
        }
        if (mergedOptions.todos) {
          void refreshSessionTodos(sessionId).catch(() => undefined);
        }
      }, options?.delayMs ?? 150);
    },
    [refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  const refreshChatCapabilities = useCallback(async () => {
    const result = await import('@/providers/services/capabilities-service').then(
      (m) => m.discoverChatCapabilities(
        client,
        activeProjectPath,
        { includeEngineAgents: !pairedHostClient },
      ),
    );
    const agents = pairedHostClient && activeProjectPath
      ? await listMobileGatewayProfiles(pairedHostClient, activeProjectPath)
      : result.agents;
    if (!isCurrentClient(client)) {
      return [];
    }

    setCurrentConfig(result.config);
    setAvailableProviders(result.providers);
    setProviderAuthMethodsById(result.providerAuthMethodsById);
    setAvailableModels(result.models);
    setAvailableAgents(agents);

    setChatPreferences((current) => {
      const configuredProviderIds = getConfiguredProviderIds(result.config, result.connected, result.models);
      const configuredModels = result.models.filter((model) => configuredProviderIds.has(model.providerID));
      const enabledModelIds = getEnabledModelIds(configuredModels, current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = getInitialProviderId(configuredModels, result.config, current.providerId, current.modelId);
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, result.config, current.providerId, current.modelId);

      const defaults = {
        ...current,
        profileId:
          agents.find((agent) => agent.profileId === current.profileId)
            ?.profileId ??
          agents.find((agent) => agent.opencodeAgentId === current.mode)
            ?.profileId ??
          agents[0]?.profileId,
        mode: getInitialMode(agents, result.config, current.mode),
        providerId: safeProviderId,
        modelId: getModelIdForProvider(
          enabledModels,
          safeProviderId,
          getInitialModelId(enabledModels, result.config, current.modelId),
          safeProviderId ? current.providerModelSelections[safeProviderId] : undefined,
        ),
        enabledModelIds,
        permissionMode: permissionModeForAutoApprove(
          isAutoApproveEnabled(result.config),
        ),
        autoApprove: isAutoApproveEnabled(result.config),
      };
      const authoritative = getSessionExecutionState(
        sessionsRef.current.find(
          (session) => session.id === currentSessionIdRef.current,
        ),
      );
      return authoritative
        ? hydratePreferencesFromSession(authoritative, defaults)
        : defaults;
    });
    return agents;
  }, [
    activeProjectPath,
    client,
    isCurrentClient,
    pairedHostClient,
  ]);

  const loadSessionProfiles = useCallback(
    async (projectId: string) => {
      if (
        projectId === activeProjectPath &&
        availableAgents.length > 0
      ) {
        return availableAgents;
      }
      // A paired project owns its profile catalog. Avoid the broader active
      // capability refresh here: it uses the shared client and can prevent
      // the creation sheet from rendering before the scoped catalog arrives.
      if (pairedHostClient) {
        return listMobileGatewayProfiles(pairedHostClient, projectId);
      }
      if (projectId === activeProjectPath) {
        return refreshChatCapabilities();
      }
      const { discoverChatCapabilities } = await import(
        '@/providers/services/capabilities-service'
      );
      return (
        await discoverChatCapabilities(
          buildScopedClient(projectId),
          projectId,
        )
      ).agents;
    },
    [
      activeProjectPath,
      availableAgents,
      buildScopedClient,
      pairedHostClient,
      refreshChatCapabilities,
    ],
  );

  // The profile/model catalog is scope-sensitive and cleared by
  // clearProjectState on every project switch, but only the Chat-tab
  // bootstrap used to refetch it — chats opened through the detail route
  // left the catalog empty and Session Config rendered "Unassigned" for a
  // correctly bound profile (#1286). Capabilities must follow the scope.
  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) return;
    void refreshChatCapabilities().catch(() => undefined);
  }, [activeProjectPath, connection.status, refreshChatCapabilities]);

  const openSession = useCallback(
    async (sessionId: string) => {
      const projectId = activeProjectPathRef.current;
      if (!projectId) {
        throw new Error('Choose a project before opening a chat.');
      }
      const result = await openProjectSession(projectId, sessionId);
      switch (result.kind) {
        case 'ready':
        case 'cancelled':
          return;
        case 'missing-session':
        case 'unauthorized-project':
        case 'offline':
        case 'timeout':
        case 'transient-error':
          throw new Error(
            result.message ||
              getOpenProjectSessionPresentation(result.kind).message,
          );
        default:
          throw new Error('Could not open this chat.');
      }
    },
    [openProjectSession],
  );

  const persistSessionPreferences = useCallback(
    async (
      sessionId: string,
      preferences: ChatPreferences,
      projectId = activeProjectPath,
    ): Promise<SessionExecutionState | undefined> => {
      if (!pairedHostClient || !projectId) return undefined;
      const profiles =
        projectId === activeProjectPath && availableAgents.length > 0
          ? availableAgents
          : await listMobileGatewayProfiles(pairedHostClient, projectId);
      const selectedProfile =
        profiles.find(
          (profile) => profile.profileId === preferences.profileId,
        ) ??
        profiles.find(
          (profile) => profile.opencodeAgentId === preferences.mode,
        );
      const selectedModel = getSelectedModelParts(preferences.modelId);
      const next = await updateMobileSessionProfileState(
        pairedHostClient,
        projectId,
        sessionId,
        {
          profileId: selectedProfile?.profileId ?? null,
          opencodeAgentId: selectedProfile?.opencodeAgentId ?? null,
          providerId: selectedModel?.providerID ??
            preferences.providerId ??
            null,
          modelId: selectedModel?.modelID ?? null,
          thinkingBudget: thinkingBudgetForReasoning(preferences.reasoning),
          permissionMode:
            preferences.permissionMode ??
            permissionModeForAutoApprove(preferences.autoApprove),
        },
      );
      if (projectId === activeProjectPath) {
        setSessions((current) =>
          replaceSessionExecutionState(current, sessionId, next));
      }
      return next;
    },
    [activeProjectPath, availableAgents, pairedHostClient],
  );

  const createSession = useCallback(
    async (title?: string, options?: CreateSessionOptions) => {
      const projectId = options?.projectId ?? activeProjectPath;
      const sessionClient =
        projectId && projectId !== activeProjectPath
          ? buildScopedClient(projectId)
          : client;
      let preferences = options?.preferences;
      if (!preferences) {
        const profiles = projectId
          ? await loadSessionProfiles(projectId)
          : availableAgents;
        preferences = getNewSessionPreferences(profiles, chatPreferences);
        if (!preferences) {
          throw new Error(NO_SELECTABLE_PROFILE_MESSAGE);
        }
      }
      preferences ??= chatPreferences;
      const trimmedTitle = title?.trim();
      const created = pairedHostClient
        ? projectId && preferences.profileId
          ? await createMobileGatewaySession(
              pairedHostClient,
              projectId,
              {
                ...(trimmedTitle ? { title: trimmedTitle } : {}),
                profileId: preferences.profileId,
              },
            )
          : undefined
        : (
            await sessionClient.session.create({
              ...(trimmedTitle ? { title: trimmedTitle } : {}),
            })
          ).data;

      if (!created) {
        throw new Error('OpenCode did not return the created session.');
      }
      if (
        projectId === activeProjectPath &&
        !isCurrentClient(client)
      ) {
        throw new Error('The active project changed before the session was created.');
      }
      const authoritative = await persistSessionPreferences(
        created.id,
        preferences,
        projectId,
      );
      if (projectId === activeProjectPath) {
        await refreshSessions(true);
      }
      return authoritative
        ? { ...created, rhythm: authoritative }
        : created;
    },
    [
      activeProjectPath,
      availableAgents,
      buildScopedClient,
      chatPreferences,
      client,
      isCurrentClient,
      loadSessionProfiles,
      pairedHostClient,
      persistSessionPreferences,
      refreshSessions,
    ],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await svcDeleteSession(client, sessionId);
      if (!isCurrentClient(client)) {
        return;
      }
      setMessagesBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setDiffsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setTodosBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setPendingPermissionsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setPendingQuestionsBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      if (currentSessionId === sessionId) {
        setCurrentSessionId(undefined);
      }
      await refreshSessions(true);
    },
    [client, currentSessionId, isCurrentClient, refreshSessions],
  );

  const refreshArchivedSessions = useCallback(async () => {
    const fetchSequence = ++archivedSessionsFetchSequenceRef.current;
    const next = await svcListArchivedSessions(client);
    if (
      isCurrentClient(client) &&
      fetchSequence === archivedSessionsFetchSequenceRef.current
    ) {
      setArchivedSessions([...next].sort((left, right) => right.time.updated - left.time.updated));
    }
  }, [client, isCurrentClient]);

  const coalescedRefreshArchivedSessions = useMemo(
    () => createTrailingCoalescer(
      750,
      () => void refreshArchivedSessions().catch(() => undefined),
    ),
    [refreshArchivedSessions],
  );

  const archiveSession = useCallback(async (sessionId: string) => {
    await svcArchiveSession(client, sessionId);
    if (!isCurrentClient(client)) return;
    if (currentSessionId === sessionId) setCurrentSessionId(undefined);
    await refreshSessions(true);
    coalescedRefreshArchivedSessions.trigger();
  }, [client, coalescedRefreshArchivedSessions, currentSessionId, isCurrentClient, refreshSessions]);

  const restoreSession = useCallback(async (sessionId: string) => {
    await svcRestoreSession(client, sessionId);
    if (!isCurrentClient(client)) return;
    await refreshSessions(true);
    coalescedRefreshArchivedSessions.trigger();
  }, [client, coalescedRefreshArchivedSessions, isCurrentClient, refreshSessions]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      throw new Error('Enter a session title.');
    }
    await svcUpdateSessionTitle(client, sessionId, trimmed);
    await refreshSessions(true);
  }, [client, refreshSessions]);

  const forkSession = useCallback(async (sessionId: string, messageId?: string) => {
    const forked = await svcForkSession(client, sessionId, messageId);
    if (!forked) {
      throw new Error('OpenCode did not return the forked session.');
    }
    if (!isCurrentClient(client)) {
      throw new Error('The active project changed before the session was forked.');
    }
    await refreshSessions(true);
    await openSession(forked.id);
    return forked;
  }, [client, isCurrentClient, openSession, refreshSessions]);

  const revertSession = useCallback(async (sessionId: string, messageId: string) => {
    await svcRevertSession(client, sessionId, messageId);
    await Promise.all([refreshSessions(true), replaceSessionMessages(sessionId, true), refreshSessionDiff(sessionId, true)]);
  }, [client, refreshSessionDiff, refreshSessions, replaceSessionMessages]);

  const unrevertSession = useCallback(async (sessionId: string) => {
    await svcUnrevertSession(client, sessionId);
    await Promise.all([refreshSessions(true), replaceSessionMessages(sessionId, true), refreshSessionDiff(sessionId, true)]);
  }, [client, refreshSessionDiff, refreshSessions, replaceSessionMessages]);

  const getSessionChildren = useCallback(
    async (sessionId: string) => svcGetSessionChildren(client, sessionId),
    [client],
  );

  const deleteSessionMessage = useCallback(async (sessionId: string, messageId: string) => {
    const message = messagesBySession[sessionId]
      ?.find((entry) => entry.info.id === messageId);
    if (!findEditableUserTextPart(message)) {
      throw new Error('Only your non-synthetic text messages can be deleted.');
    }
    await svcDeleteSessionMessage(client, sessionId, messageId);
    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: pruneSessionMessage(current[sessionId] || [], messageId),
    }));
    await Promise.all([
      refreshMessages(sessionId, true),
      refreshSessionDiff(sessionId, true),
      refreshSessions(true),
    ]);
  }, [client, messagesBySession, refreshMessages, refreshSessionDiff, refreshSessions]);

  const updateSessionTextPart = useCallback(
    async (sessionId: string, messageId: string, partId: string, text: string) => {
      const message = messagesBySession[sessionId]
        ?.find((entry) => entry.info.id === messageId);
      const part = findEditableUserTextPart(message, partId);
      if (!part) {
        throw new Error('Only your non-synthetic text messages can be edited.');
      }
      await svcUpdateSessionPart(client, sessionId, messageId, { ...part, text });
      await refreshMessages(sessionId, true);
    },
    [client, messagesBySession, refreshMessages],
  );

  const deleteSessionPart = useCallback(async (sessionId: string, messageId: string, partId: string) => {
    const message = messagesBySession[sessionId]
      ?.find((entry) => entry.info.id === messageId);
    if (!findEditableUserTextPart(message, partId)) {
      throw new Error('Only your non-synthetic text messages can be deleted.');
    }
    await svcDeleteSessionPart(client, sessionId, messageId, partId);
    await refreshMessages(sessionId, true);
  }, [client, messagesBySession, refreshMessages]);

  const authoritativePreferencesForSession = useCallback(
    (sessionId: string): ChatPreferences => {
      const state = getSessionExecutionState(
        sessions.find((session) => session.id === sessionId),
      );
      return state
        ? hydratePreferencesFromSession(state, chatPreferences)
        : chatPreferences;
    },
    [chatPreferences, sessions],
  );

  const updateSessionPreferences = useCallback(
    async (
      sessionId: string,
      patch: Partial<ChatPreferences>,
    ): Promise<ChatPreferences> => {
      const current = authoritativePreferencesForSession(sessionId);
      const selectedProfile =
        patch.profileId && patch.profileId !== current.profileId
        ? availableAgents.find(
            (profile) => profile.profileId === patch.profileId,
          )
        : undefined;
      const requested = selectedProfile
        ? applyProfileDefaults(selectedProfile, {
            ...current,
            ...patch,
          })
        : {
            ...current,
            ...patch,
            autoApprove:
              patch.permissionMode !== undefined
                ? patch.permissionMode === 'bypassPermissions'
                : patch.autoApprove ?? current.autoApprove,
          };
      const authoritative = await persistSessionPreferences(
        sessionId,
        requested,
      );
      const next = authoritative
        ? hydratePreferencesFromSession(authoritative, requested)
        : requested;
      if (sessionId === currentSessionId) {
        setChatPreferences(next);
      }
      return next;
    },
    [
      authoritativePreferencesForSession,
      availableAgents,
      currentSessionId,
      persistSessionPreferences,
    ],
  );

  const initializeSession = useCallback(async (sessionId: string) => {
    const preferences = authoritativePreferencesForSession(sessionId);
    const model = getSelectedModelParts(preferences.modelId);
    const messageId = messagesBySession[sessionId]
      ?.findLast((message) => findEditableUserTextPart(message) !== undefined)
      ?.info.id;
    if (!model || !messageId) {
      throw new Error('Send a message and select a model before initializing this session.');
    }
    await svcInitializeSession(client, sessionId, model);
    await Promise.all([refreshMessages(sessionId, true), refreshSessions(true)]);
  }, [authoritativePreferencesForSession, client, messagesBySession, refreshMessages, refreshSessions]);

  const runSessionShell = useCallback(async (sessionId: string, command: string) => {
    const trimmed = command.trim();
    if (!trimmed) throw new Error('Enter a shell command first.');
    const preferences = authoritativePreferencesForSession(sessionId);
    const model = getSelectedModelParts(preferences.modelId);
    await svcRunSessionShell(client, sessionId, trimmed, {
      agent: preferences.mode,
      model,
    });
    await Promise.all([refreshMessages(sessionId, true), refreshSessions(true)]);
  }, [authoritativePreferencesForSession, client, refreshMessages, refreshSessions]);

  const refreshServerFeatures = useCallback(async () => {
    if (!activeProjectPath) {
      setCommands([]);
      setWorkspaceFileStatuses([]);
      setVcsInfo(undefined);
      return;
    }
    const [nextCommands, nextStatuses, nextVcs] = await Promise.all([
      svcListCommands(client).catch(() => []),
      getFileStatus(client).catch(() => []),
      getVcsInfo(client).catch(() => undefined),
    ]);
    if (!isCurrentClient(client)) {
      return;
    }
    setCommands(nextCommands || []);
    setWorkspaceFileStatuses(nextStatuses || []);
    setVcsInfo(nextVcs);
  }, [activeProjectPath, client, isCurrentClient]);

  const refreshDiagnostics = useCallback(async () => {
    const nextDiagnostics = await loadDiagnostics(client);
    if (isCurrentClient(client)) {
      setDiagnostics(nextDiagnostics);
    }
  }, [client, isCurrentClient]);

  const searchWorkspaceFiles = useCallback(async (query: string) => {
    const trimmed = query.trim();
    const nextFiles = trimmed ? (await findFiles(client, trimmed)) || [] : [];
    if (activeProjectPathRef.current === client.__opencode.directory) {
      setWorkspaceFiles(nextFiles);
    }
  }, [client]);

  const listWorkspaceDirectory = useCallback(
    async (path: string) => listFiles(client, path.trim() || '.'),
    [client],
  );

  const searchWorkspaceText = useCallback(
    async (pattern: string) => {
      const trimmed = pattern.trim();
      return trimmed ? findText(client, trimmed) : [];
    },
    [client],
  );

  const searchWorkspaceSymbols = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      return trimmed ? findSymbols(client, trimmed) : [];
    },
    [client],
  );

  const getWorkspaceVcsStatus = useCallback(async () => getVcsStatus(client), [client]);

  const getWorkspaceVcsDiff = useCallback(
    async (mode: 'git' | 'branch') => getVcsDiff(client, mode),
    [client],
  );

  const getWorkspaceRawVcsDiff = useCallback(async () => getRawVcsDiff(client), [client]);

  const openWorkspaceFile = useCallback(async (path: string) => {
    const content = await readFile(client, path);
    if (!content) {
      throw new Error('OpenCode did not return file content.');
    }
    if (content.type === 'binary' || content.encoding === 'base64') {
      throw new Error('Binary files cannot be previewed as text.');
    }
    if (activeProjectPathRef.current === client.__opencode.directory) {
      setSelectedWorkspaceFile({ path, content });
    }
  }, [client]);

  const saveWorkspaceFile = useCallback(async (path: string, expectedContent: string, content: string) => {
    const latest = await readFile(client, path);
    if (latest.type !== 'text' || latest.encoding === 'base64') throw new Error('Only text files can be edited.');
    if (latest.content !== expectedContent) throw new Error('The file changed on the server. Reopen it before saving.');
    const patch = createFullFilePatch({ path, expectedContent, content });
    if (!patch) return;
    await applyVcsPatch(client, patch);
    const saved = await readFile(client, path);
    if (activeProjectPathRef.current === client.__opencode.directory) {
      setSelectedWorkspaceFile({ path, content: saved });
      await refreshServerFeatures();
    }
  }, [client, refreshServerFeatures]);

  const updateProjectMetadata = useCallback(async (
    projectId: string,
    update: Parameters<typeof svcUpdateProjectMetadata>[2],
  ) => {
    const project = await svcUpdateProjectMetadata(client, projectId, update);
    await refreshWorkspaceCatalog(true);
    return project;
  }, [client, refreshWorkspaceCatalog]);

  const initializeProjectGit = useCallback(async () => {
    const project = await svcInitializeProjectGit(client);
    await Promise.all([refreshWorkspaceCatalog(true), refreshServerFeatures()]);
    return project;
  }, [client, refreshServerFeatures, refreshWorkspaceCatalog]);

  const refreshWorktrees = useCallback(async () => {
    const next = await svcListWorktrees(client);
    if (isCurrentClient(client)) setWorktrees(next);
  }, [client, isCurrentClient]);

  const createWorktree = useCallback(async (name?: string, startCommand?: string) => {
    await svcCreateWorktree(client, name?.trim() || undefined, startCommand?.trim() || undefined);
    await Promise.all([refreshWorktrees(), refreshWorkspaceCatalog(true)]);
  }, [client, refreshWorktrees, refreshWorkspaceCatalog]);

  const resetWorktree = useCallback(async (directory: string) => {
    await svcResetWorktree(client, directory);
    await refreshWorktrees();
  }, [client, refreshWorktrees]);

  const removeWorktree = useCallback(async (directory: string) => {
    await svcRemoveWorktree(client, directory);
    await Promise.all([refreshWorktrees(), refreshWorkspaceCatalog(true)]);
  }, [client, refreshWorktrees, refreshWorkspaceCatalog]);

  const refreshMcpServers = useCallback(async () => {
    const next = await getMcpStatus(client);
    if (isCurrentClient(client)) setMcpStatuses(next);
  }, [client, isCurrentClient]);

  const addMcpServer = useCallback(async (name: string, config: McpLocalConfig | McpRemoteConfig) => {
    await svcAddMcpServer(client, name.trim(), config);
    await Promise.all([refreshMcpServers(), refreshChatCapabilities()]);
  }, [client, refreshChatCapabilities, refreshMcpServers]);

  const connectMcpServer = useCallback(async (name: string) => {
    await svcConnectMcpServer(client, name);
    await refreshMcpServers();
  }, [client, refreshMcpServers]);

  const disconnectMcpServer = useCallback(async (name: string) => {
    await svcDisconnectMcpServer(client, name);
    await refreshMcpServers();
  }, [client, refreshMcpServers]);

  const setMcpServerEnabled = useCallback(async (name: string, enabled: boolean) => {
    await svcSetMcpServerEnabled(client, name, enabled);
    await Promise.all([refreshMcpServers(), refreshChatCapabilities()]);
  }, [client, refreshChatCapabilities, refreshMcpServers]);

  const startMcpOAuth = useCallback(async (name: string) => {
    return (await svcStartMcpOAuth(client, name)).authorizationUrl;
  }, [client]);

  const completeMcpOAuth = useCallback(async (name: string, code: string) => {
    await svcCompleteMcpOAuth(client, name, code.trim());
    await refreshMcpServers();
  }, [client, refreshMcpServers]);

  const removeMcpOAuth = useCallback(async (name: string) => {
    await svcRemoveMcpOAuth(client, name);
    await refreshMcpServers();
  }, [client, refreshMcpServers]);

  const loadOpenCodeInspection = useCallback(
    async (provider?: string, model?: string) => svcLoadOpenCodeInspection(client, provider, model),
    [client],
  );

  const reloadOpenCodeSkills = useCallback(
    async () => svcReloadOpenCodeSkills(client),
    [client],
  );

  const reloadOpenCodeConfig = useCallback(async () => {
    await svcReloadOpenCodeConfig(client);
    await refreshChatCapabilities();
  }, [client, refreshChatCapabilities]);

  const refreshTerminals = useCallback(async () => {
    const [nextTerminals, nextShells] = await Promise.all([listTerminals(client), listShells(client)]);
    if (!isCurrentClient(client)) return;
    setTerminals(nextTerminals);
    setTerminalShells(nextShells);
  }, [client, isCurrentClient]);

  const openTerminal = useCallback(async (ptyId: string) => {
    const generation = ++terminalOpenGenerationRef.current;
    const previousSocket = terminalSocketRef.current;
    terminalSocketRef.current = undefined;
    previousSocket?.close();
    const switchingTerminal = activeTerminalId !== ptyId;
    setActiveTerminalId(ptyId);
    if (switchingTerminal) setTerminalOutput('');
    setTerminalConnection('connecting');
    const token = await createTerminalConnectToken(client, ptyId);
    if (!isCurrentClient(client) || generation !== terminalOpenGenerationRef.current) {
      throw new Error('Terminal connection was superseded.');
    }
    const terminalOptions = {
      ticket: token.ticket,
      cursor: terminalCursorByIdRef.current[ptyId],
    };
    const socket = pairedHost.client && activeProjectPath
      ? await pairedHost.client
          .ptyConnection(ptyId, activeProjectPath, terminalOptions)
          .then(
            ({ url, headers }) =>
              authenticatedWebSocket(url, headers),
          )
      : new WebSocket(getTerminalWebSocketUrl(
          {
            serverUrl: settings.serverUrl,
            directory: activeProjectPath || '',
          },
          ptyId,
          terminalOptions,
        ));
    terminalSocketRef.current = socket;
    let opened = false;
    const connected = new Promise<void>((resolve, reject) => {
      socket.onopen = () => {
        if (generation !== terminalOpenGenerationRef.current) {
          socket.close();
          reject(new Error('Terminal connection was superseded.'));
          return;
        }
        opened = true;
        setTerminalConnection('connected');
        resolve();
      };
      socket.onerror = () => {
        if (generation !== terminalOpenGenerationRef.current) return;
        setTerminalConnection('error');
        if (!opened) reject(new Error('Could not connect to the terminal.'));
      };
      socket.onclose = () => {
        if (generation !== terminalOpenGenerationRef.current) return;
        if (terminalSocketRef.current === socket && opened) setTerminalConnection('idle');
        if (!opened) reject(new Error('The terminal connection closed before it was ready.'));
      };
    });
    socket.onmessage = ({ data }) => {
      // ponytail: strip common CSI styling; use a terminal emulator if full VT control becomes required.
      if (generation !== terminalOpenGenerationRef.current) return;
      const append = (value: string) => setTerminalOutput((current) => `${current}${value.replace(ANSI_CSI_PATTERN, '')}`.slice(-100_000));
      if (typeof data === 'string') append(data);
      else {
        const read = async () => {
          const buffer = data instanceof Blob ? await data.arrayBuffer() : data as ArrayBuffer;
          if (generation !== terminalOpenGenerationRef.current) return;
          const bytes = new Uint8Array(buffer);
          const text = new TextDecoder().decode(bytes[0] === 0 ? bytes.subarray(1) : bytes);
          if (bytes[0] !== 0) {
            append(text);
            return;
          }
          try {
            const cursor = JSON.parse(text).cursor;
            if (cursor !== undefined) terminalCursorByIdRef.current[ptyId] = String(cursor);
          } catch {
            // Ignore malformed control frames instead of rendering protocol data.
          }
        };
        void read();
      }
    };
    await connected;
  }, [
    activeProjectPath,
    activeTerminalId,
    client,
    isCurrentClient,
    pairedHost.client,
    settings.serverUrl,
  ]);

  const createTerminal = useCallback(async (command?: string, title?: string) => {
    const terminal = await svcCreateTerminal(client, { command: command?.trim() || undefined, title: title?.trim() || undefined });
    await refreshTerminals();
    await openTerminal(terminal.id);
    return terminal;
  }, [client, openTerminal, refreshTerminals]);

  const getTerminalDetail = useCallback(async (ptyId: string) => svcGetTerminal(client, ptyId), [client]);

  const resizeTerminal = useCallback(async (ptyId: string, rows: number, cols: number) => {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2) {
      throw new Error('Terminal rows and columns must be whole numbers greater than one.');
    }
    const terminal = await svcUpdateTerminal(client, ptyId, { size: { rows, cols } });
    await refreshTerminals();
    return terminal;
  }, [client, refreshTerminals]);

  const sendTerminalInput = useCallback((input: string) => {
    if (terminalSocketRef.current?.readyState !== WebSocket.OPEN) throw new Error('Terminal is not connected.');
    terminalSocketRef.current.send(input);
  }, []);

  const closeTerminal = useCallback(async (ptyId: string) => {
    if (activeTerminalId === ptyId) {
      terminalOpenGenerationRef.current += 1;
      terminalSocketRef.current?.close();
      terminalSocketRef.current = undefined;
      setActiveTerminalId(undefined);
      setTerminalOutput('');
    }
    delete terminalCursorByIdRef.current[ptyId];
    await svcRemoveTerminal(client, ptyId);
    await refreshTerminals();
  }, [activeTerminalId, client, refreshTerminals]);

  const executeCommand = useCallback(async (sessionId: string, command: string, args: string) => {
    const preferences = authoritativePreferencesForSession(sessionId);
    const selected = getSelectedModelParts(preferences.modelId);
    await svcExecuteCommand(client, sessionId, command, args, {
      agent: preferences.mode,
      model: selected ? `${selected.providerID}/${selected.modelID}` : undefined,
    });
    await Promise.all([refreshMessages(sessionId, true), refreshSessions(true)]).catch(() => undefined);
  }, [authoritativePreferencesForSession, client, refreshMessages, refreshSessions]);

  const ensureActiveSession = useCallback(async () => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return undefined;
    }

    if (currentSessionId && sessions.some((session) => session.id === currentSessionId)) {
      if (!messagesBySession[currentSessionId]) {
        await refreshMessages(currentSessionId, true);
      }
      return currentSessionId;
    }

    if (bootstrapPromiseRef.current) {
      return bootstrapPromiseRef.current;
    }

    const bootstrapToken = {};
    bootstrapTokenRef.current = bootstrapToken;
    const bootstrapPromise = (async () => {
      setIsBootstrappingChat(true);

      try {
        const nextSessions = sessions.length > 0 ? sessions : await fetchSessions(true);
        const rememberedSessionId = activeProjectPath ? lastSessionByProject[activeProjectPath] : undefined;
        const targetSession =
          nextSessions.find((session) => session.id === rememberedSessionId) ??
          nextSessions[0] ??
          (await createSession());
        await Promise.all([
          refreshMessages(targetSession.id, true),
          refreshSessionDiff(targetSession.id, true),
          refreshSessionTodos(targetSession.id),
          refreshPendingInteractions(),
          refreshChatCapabilities(),
          refreshServerFeatures(),
          refreshDiagnostics(),
        ]);
        if (!isCurrentClient(client)) {
          return undefined;
        }
        if (
          !canCommitBootstrappedSession({
            activeBootstrapToken: bootstrapTokenRef.current,
            bootstrapToken,
            currentSessionId: currentSessionIdRef.current,
          })
        ) {
          return currentSessionIdRef.current;
        }
        setCurrentSessionId(targetSession.id);
        if (activeProjectPath) {
          setLastSessionByProject((current) => ({
            ...current,
            [activeProjectPath]: targetSession.id,
          }));
        }
        return targetSession.id;
      } finally {
        if (bootstrapTokenRef.current === bootstrapToken) {
          setIsBootstrappingChat(false);
          bootstrapPromiseRef.current = null;
          bootstrapTokenRef.current = undefined;
        }
      }
    })();

    bootstrapPromiseRef.current = bootstrapPromise;
    return bootstrapPromise;
  }, [
    activeProjectPath,
    connection.status,
    client,
    createSession,
    currentSessionId,
    fetchSessions,
    lastSessionByProject,
    isCurrentClient,
    messagesBySession,
    refreshMessages,
    refreshPendingInteractions,
    refreshChatCapabilities,
    refreshDiagnostics,
    refreshServerFeatures,
    refreshSessionDiff,
    refreshSessionTodos,
    sessions,
  ]);

  const selectProject = useCallback((path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }
    if (normalizedPath === activeProjectPathRef.current) {
      return;
    }

    scopeGenerationRef.current += 1;
    setActiveProjectPath(normalizedPath);
    clearProjectState();
  }, [clearProjectState]);

  const connect = useCallback(async () => {
    if (pairedHostRecord && pairedHostState !== 'connected') {
      setConnection({
        status: 'error',
        message: pairedHostMessage,
        checkedAt: Date.now(),
      });
      return;
    }
    if (!pairedHostClient && Platform.OS !== 'web') {
      setConnection({
        status: 'idle',
        message: 'Pair this iPhone with your Mac to use Rhythm Agents.',
      });
      return;
    }
    if (!isValidServerUrl(settingsRef.current.serverUrl)) {
      setConnection({
        status: 'error',
        message: getConnectionError(settingsRef.current.serverUrl, new Error('Invalid server URL.')),
        checkedAt: Date.now(),
      });
      return;
    }

    setConnection({
      status: 'connecting',
      message: pairedHostClient
        ? 'Connecting securely to your paired Mac…'
        : `Connecting to ${getNormalizedServerUrl(settingsRef.current.serverUrl)}...`,
    });

    try {
      const catalog = await loadWorkspaceCatalog(true);
      if (!isCurrentCatalogClient(catalogClient)) {
        return;
      }
      const projectDirectory = catalog.currentProjectPath || catalog.serverRootPath;

      setConnection({
        status: 'connected',
        message: pairedHostClient
          ? 'Connected securely to your paired Mac.'
          : `Connected to ${getNormalizedServerUrl(settingsRef.current.serverUrl)}`,
        checkedAt: Date.now(),
        projectDirectory,
      });

      if (!activeProjectPath && !catalog.currentProjectPath && !catalog.serverProjects[0]?.worktree) {
        setSessions([]);
        setSessionStatuses({});
        setCurrentConfig(undefined);
        setAvailableProviders([]);
        setProviderAuthMethodsById({});
        setAvailableModels([]);
        setAvailableAgents([]);
      }
    } catch (error) {
      if (!isCurrentCatalogClient(catalogClient)) {
        return;
      }
      const reachability = pairedHostClient
        ? await refreshPairedHost()
        : null;
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setConnection({
        status: 'error',
        message:
          reachability && reachability.state !== 'connected'
            ? reachability.message
            : getConnectionError(settingsRef.current.serverUrl, error),
        checkedAt: Date.now(),
      });
      setSessions([]);
      setSessionStatuses({});
      setCurrentConfig(undefined);
      setAvailableProviders([]);
      setProviderAuthMethodsById({});
      setAvailableModels([]);
      setAvailableAgents([]);
    }
  }, [
    activeProjectPath,
    catalogClient,
    isCurrentCatalogClient,
    loadWorkspaceCatalog,
    pairedHostClient,
    pairedHostMessage,
    pairedHostRecord,
    pairedHostState,
    refreshPairedHost,
  ]);

  const ensureActiveSessionRef = useRef(ensureActiveSession);
  ensureActiveSessionRef.current = ensureActiveSession;

  const coalescedRefreshSessions = useMemo(
    () => createTrailingCoalescer(
      750,
      () => void refreshSessions(true).catch(() => undefined),
    ),
    [refreshSessions],
  );
  const coalescedIdleRefresh = useMemo(
    () => createTrailingCoalescer(1000, () => {
      void Promise.all([
        refreshPendingInteractions(),
        refreshServerFeatures(),
      ]).catch(() => undefined);
    }),
    [refreshPendingInteractions, refreshServerFeatures],
  );

  useEffect(
    () => () => {
      coalescedRefreshArchivedSessions.cancel();
      coalescedRefreshSessions.cancel();
      coalescedIdleRefresh.cancel();
    },
    [
      coalescedIdleRefresh,
      coalescedRefreshArchivedSessions,
      coalescedRefreshSessions,
    ],
  );

  useEffect(() => {
    if (!isHydrated) return;
    const target = pairedHostClient && pairedHostRecord
      ? `paired:${pairedHostRecord.rhythmUserId}:${pairedHostRecord.hostId}:${pairedHostRecord.deviceId}:${pairedHostState}`
      : Platform.OS === 'web'
        ? `direct:${settings.serverUrl}:${settings.username}:${settings.password}`
        : 'native:unpaired';
    if (connectionTargetRef.current === target) return;
    connectionTargetRef.current = target;
    openProjectSessionControllerRef.current?.cancelOpenProjectSession();
    scopeGenerationRef.current += 1;
    serverGenerationRef.current += 1;
    catalogGenerationRef.current.set(
      catalogClient,
      serverGenerationRef.current,
    );
    activeProjectPathRef.current = undefined;
    setActiveProjectPath(undefined);
    clearProjectState();
    setServerProjects([]);
    setCurrentProjectPath(undefined);
    setServerRootPath(undefined);
    void connect();
  }, [
    clearProjectState,
    catalogClient,
    connect,
    isHydrated,
    pairedHostClient,
    pairedHostRecord,
    pairedHostState,
    settings.password,
    settings.serverUrl,
    settings.username,
  ]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) return;
    void Promise.all([
      refreshWorktrees(),
      refreshMcpServers(),
      refreshTerminals(),
      refreshArchivedSessions(),
    ]).catch(() => undefined);
  }, [activeProjectPath, connection.status, refreshArchivedSessions, refreshMcpServers, refreshTerminals, refreshWorktrees]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return;
    }

    void ensureActiveSessionRef.current().catch((error) => {
      if (isCurrentClient(client)) {
        setPromptError({
          message: error instanceof Error ? error.message : 'Could not load this project.',
          occurredAt: Date.now(),
        });
      }
    });
  }, [activeProjectPath, client, connection.status, isCurrentClient]);

  const refreshCurrentSession = useCallback(
    async (silent = false) => {
      if (!currentSessionId) {
        return;
      }

      await Promise.all([
        refreshSessions(silent),
        refreshMessages(currentSessionId, silent),
        refreshSessionDiff(currentSessionId, true),
        refreshSessionTodos(currentSessionId),
        refreshPendingInteractions(),
      ]);
    },
    [currentSessionId, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  const refreshCurrentTodos = useCallback(
    async (_silent = false) => {
      if (!currentSessionId) {
        return;
      }

      await refreshSessionTodos(currentSessionId);
    },
    [currentSessionId, refreshSessionTodos],
  );

  const replyToPermission = useCallback(
    async (requestId: string, reply: 'once' | 'always' | 'reject') => {
      const request = Object.values(pendingPermissionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This permission request is no longer available.');
      }
      await replyToPendingPermission(client, request.id, reply);
      setPendingPermissionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
    },
    [client, pendingPermissionsBySession, refreshMessages],
  );

  const replyToQuestion = useCallback(
    async (requestId: string, answers: PendingQuestionAnswer[]) => {
      const request = Object.values(pendingQuestionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This question is no longer available.');
      }
      await replyToPendingQuestion(client, request.id, answers);
      setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
    },
    [client, pendingQuestionsBySession, refreshMessages],
  );

  const rejectQuestion = useCallback(
    async (requestId: string) => {
      const request = Object.values(pendingQuestionsBySession).flat().find((item) => item.id === requestId);
      if (!request) {
        throw new Error('This question is no longer available.');
      }
      await rejectPendingQuestion(client, request.id);
      setPendingQuestionsBySession((current) => ({
        ...current,
        [request.sessionID]: (current[request.sessionID] || []).filter((item) => item.id !== request.id),
      }));
      await refreshMessages(request.sessionID, true);
    },
    [client, pendingQuestionsBySession, refreshMessages],
  );

  const updateChatPreferences = useCallback((patch: Partial<ChatPreferences>) => {
    setChatPreferences((current) => {
      const configuredProviderIds = new Set(availableProviders.filter((provider) => provider.configured).map((provider) => provider.id));
      const configuredModels = availableModels.filter((model) => configuredProviderIds.has(model.providerID));
      const enabledModelIds = getEnabledModelIds(configuredModels, patch.enabledModelIds ?? current.enabledModelIds);
      const enabledModels = configuredModels.filter((model) => enabledModelIds.includes(model.id));
      const nextProviderId = patch.providerId ?? current.providerId;
      const safeProviderId = nextProviderId && enabledModels.some((model) => model.providerID === nextProviderId)
        ? nextProviderId
        : getInitialProviderId(enabledModels, undefined, current.providerId, patch.modelId ?? current.modelId);
      const requestedModelId = patch.modelId ?? current.modelId;
      const nextProviderModelSelections = patch.modelId
        ? {
            ...current.providerModelSelections,
            [patch.providerId ?? safeProviderId ?? patch.modelId.split('/')[0]]: patch.modelId,
          }
        : current.providerModelSelections;
      const nextModelId = getModelIdForProvider(
        enabledModels,
        safeProviderId,
        requestedModelId,
        safeProviderId ? nextProviderModelSelections[safeProviderId] : undefined,
      );

      return {
        ...current,
        ...patch,
        providerId: safeProviderId,
        modelId: nextModelId,
        enabledModelIds,
        providerModelSelections:
          safeProviderId && nextModelId
            ? {
                ...nextProviderModelSelections,
                [safeProviderId]: nextModelId,
              }
            : nextProviderModelSelections,
      };
    });
  }, [availableModels, availableProviders]);

  const configureProvider = useCallback(
    async (providerId: string) => {
      const latestConfig = currentConfig || (await client.config.get()).data;
      if (!latestConfig) {
        throw new Error('OpenCode did not return its configuration.');
      }
      const enabledProviders = new Set(latestConfig.enabled_providers || []);
      enabledProviders.add(providerId);

      const updatedConfig = (await client.config.update({
        config: {
          ...latestConfig,
          disabled_providers: (latestConfig.disabled_providers || []).filter((id) => id !== providerId),
          enabled_providers: [...enabledProviders].sort(),
        },
      })).data;
      if (!updatedConfig) {
        throw new Error('OpenCode did not return its updated configuration.');
      }

      setCurrentConfig(updatedConfig);
      await refreshChatCapabilities();
      setChatPreferences((current) => ({
        ...current,
        providerId: current.providerId || providerId,
      }));
    },
    [client, currentConfig, refreshChatCapabilities],
  );

  const setProviderAuth = useCallback(
    async (providerId: string, values: Record<string, string>) => {
      const key = values.key?.trim();
      const token = values.token?.trim();
      if (!key) {
        throw new Error('Enter a provider credential first.');
      }

      const metadata = Object.fromEntries(
        Object.entries(values)
          .filter(([name, value]) => name !== 'key' && name !== 'token' && value.trim())
          .map(([name, value]) => [name, value.trim()]),
      );
      const auth = token
        ? { type: 'wellknown' as const, key, token }
        : { type: 'api' as const, key, ...(Object.keys(metadata).length > 0 ? { metadata } : {}) };

      await client.auth.set({ providerID: providerId, auth });
      await configureProvider(providerId);
      await refreshChatCapabilities();
    },
    [client, configureProvider, refreshChatCapabilities],
  );

  const removeProvider = useCallback(async (providerId: string) => {
    await client.auth.remove({ providerID: providerId });
    const latestConfig = currentConfig || (await client.config.get()).data;
    if (latestConfig) {
      const updatedConfig = (await client.config.update({
        config: {
          ...latestConfig,
          disabled_providers: [...new Set([...(latestConfig.disabled_providers || []), providerId])].sort(),
          enabled_providers: (latestConfig.enabled_providers || []).filter((id) => id !== providerId),
        },
      })).data;
      setCurrentConfig(updatedConfig);
    }
    await refreshChatCapabilities();
  }, [client, currentConfig, refreshChatCapabilities]);

  const startProviderOAuth = useCallback(
    async (providerId: string, methodIndex: number, inputs?: Record<string, string>) => {
      const authorization = (await client.provider.oauth.authorize({
        providerID: providerId,
        method: methodIndex,
        inputs,
      })).data;
      if (!authorization) {
        throw new Error('OpenCode did not return OAuth authorization details.');
      }

      return {
        url: authorization.url,
        instructions: authorization.instructions,
        method: authorization.method,
      };
    },
    [client],
  );

  const completeAutomaticProviderOAuth = useCallback(async (providerId: string) => {
    const providers = (await client.provider.list()).data;
    if (!providers?.connected.includes(providerId)) {
      throw new Error('Provider sign-in was not completed. Finish authentication in the browser and try again.');
    }
    await configureProvider(providerId);
  }, [client, configureProvider]);

  const completeProviderOAuth = useCallback(async (providerId: string, methodIndex: number, code: string) => {
    await client.provider.oauth.callback({
      providerID: providerId,
      method: methodIndex,
      code: code.trim() || undefined,
    });
    await configureProvider(providerId);
    await refreshChatCapabilities();
  }, [client, configureProvider, refreshChatCapabilities]);

  const setAutoApprove = useCallback(
    async (enabled: boolean) => {
      if (pairedHostClient && currentSessionId && activeProjectPath) {
        const nextPreferences = {
          ...chatPreferences,
          permissionMode: permissionModeForAutoApprove(enabled),
          autoApprove: enabled,
        };
        const authoritative = await persistSessionPreferences(
          currentSessionId,
          nextPreferences,
        );
        setChatPreferences((current) =>
          authoritative
            ? hydratePreferencesFromSession(authoritative, {
                ...current,
                permissionMode: nextPreferences.permissionMode,
                autoApprove: enabled,
              })
            : nextPreferences);
        return;
      }
      const latestConfig = currentConfig || (await client.config.get()).data;
      const nextConfig = mergePermissionConfig(latestConfig, enabled);
      const updatedConfig = (await client.config.update({ config: nextConfig })).data;
      if (!updatedConfig) {
        throw new Error('OpenCode did not return its updated configuration.');
      }

      setCurrentConfig(updatedConfig);
      setChatPreferences((current) => ({
        ...current,
        permissionMode: permissionModeForAutoApprove(enabled),
        autoApprove: enabled,
      }));
    },
    [
      activeProjectPath,
      chatPreferences,
      client,
      currentConfig,
      currentSessionId,
      pairedHostClient,
      persistSessionPreferences,
    ],
  );

  const sendPrompt = useCallback(
    async (
      sessionId: string,
      prompt: string,
      attachments?: { uri: string; mime?: string; filename?: string }[],
    ) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt && (!attachments || attachments.length === 0)) {
        return false;
      }

      if (promptSubmissionRef.current.active) {
        return false;
      }

      promptSubmissionRef.current = { active: true, sessionId };
      setPromptError(undefined);

      const currentSession = sessions.find((session) => session.id === sessionId);
      const baselineAssistantMessageIds = new Set(
        (messagesBySession[sessionId] || [])
          .filter((message) => message.info.role === 'assistant')
          .map((message) => message.info.id),
      );
      let promptAccepted = false;

      try {
        const sessionExecutionState = getSessionExecutionState(currentSession);
        const selectedPreferences =
          currentSessionId === sessionId
            ? chatPreferences
            : authoritativePreferencesForSession(sessionId);
        const initialExecutionPlan = buildPromptExecutionPlan(
          sessionExecutionState,
          selectedPreferences,
        );
        const persistedState = initialExecutionPlan.persistAllowed
          ? await persistSessionPreferences(sessionId, selectedPreferences)
          : undefined;
        const executionPreferences = persistedState
          ? hydratePreferencesFromSession(
              persistedState,
              selectedPreferences,
            )
          : selectedPreferences;
        const executionPlan = buildPromptExecutionPlan(
          persistedState ?? sessionExecutionState,
          executionPreferences,
        );
        busyNotificationSessionIdsRef.current.delete(sessionId);
        notificationRequestedAtRef.current.set(sessionId, Date.now());
        pendingNotificationSessionIdsRef.current.add(sessionId);
        if (activeProjectPath && rhythmAccount.user) {
          const notificationOrigin = {
            accountUserId: rhythmAccount.user.id,
            serverUrl: settingsRef.current.serverUrl,
          };
          pendingNotificationOriginBySessionIdRef.current.set(
            sessionId,
            notificationOrigin,
          );
          await trackPendingTaskFinishedNotification({
            accountUserId: rhythmAccount.user.id,
            sessionId,
            sessionTitle: currentSession?.title,
            projectPath: activeProjectPath,
            settings: {
              serverUrl: settingsRef.current.serverUrl,
              username: settingsRef.current.username,
            },
            requestedAt: Date.now(),
          }).catch(() => undefined);
        }

        setSendingState({ active: true, sessionId });
        const selectedModel = executionPlan.persistAllowed
          ? availableModels.find(
              (model) => model.id === executionPreferences.modelId,
            )
          : undefined;
        if (
          attachments?.length &&
          executionPlan.persistAllowed &&
          !selectedModel
        ) {
          throw new Error('Select a model that supports attachments first.');
        }
        if (
          attachments?.length &&
          selectedModel &&
          !selectedModel.supportsAttachments
        ) {
          throw new Error(`${selectedModel?.label || 'The selected model'} does not support file attachments.`);
        }
        if (attachments?.length && selectedModel?.inputModalities?.length) {
          const unsupported = attachments.find((attachment) => {
            const mime = attachment.mime || '';
            const modality = mime.startsWith('image/') ? 'image'
              : mime.startsWith('audio/') ? 'audio'
                : mime.startsWith('video/') ? 'video'
                  : mime === 'application/pdf' ? 'pdf'
                    : undefined;
            return modality && !selectedModel.inputModalities.includes(modality);
          });
          if (unsupported) {
            throw new Error(`${selectedModel.label} does not support ${unsupported.mime || 'this attachment type'} input.`);
          }
        }

        // Prepare file parts. For local URIs (file://, content://, asset://) read the
        // file and convert it to a data URL so the server receives the attachment bytes.
        // Mobile-local URIs are not reachable from the OpenCode server.
        const preparedFileParts: { type: 'file'; mime: string; filename?: string; url: string }[] = [];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            const filename = att.filename || att.uri.split('/').pop();
            const mime = att.mime || 'application/octet-stream';

            // Remote and picker-provided data URLs are already server-readable.
            if (/^(?:https?:\/\/|data:)/i.test(att.uri)) {
              preparedFileParts.push({ type: 'file', mime, filename, url: att.uri });
              continue;
            }

            try {
              const FileSystem = await import('expo-file-system/legacy');
              const info = await FileSystem.getInfoAsync(att.uri);
              if (info.exists && typeof info.size === 'number' && info.size > 10 * 1024 * 1024) {
                throw new Error('File exceeds the 10 MB attachment limit.');
              }
              const base64 = await FileSystem.readAsStringAsync(att.uri, { encoding: 'base64' });
              const dataUrl = `data:${mime};base64,${base64}`;
              preparedFileParts.push({ type: 'file', mime, filename, url: dataUrl });
            } catch (error) {
              const reason = error instanceof Error ? error.message : 'unknown error';
              throw new Error(`Could not read attachment${filename ? ` \"${filename}\"` : ''}: ${reason}`);
            }
          }
        }

        const parts: (TextPartInput | FilePartInput)[] = [];
        if (trimmedPrompt) {
          parts.push({ type: 'text', text: trimmedPrompt });
        }
        parts.push(...preparedFileParts);

        await client.session.promptAsync({
          sessionID: sessionId,
          ...(executionPlan.agent !== undefined ? { agent: executionPlan.agent } : {}),
          ...(executionPlan.model !== undefined ? { model: executionPlan.model } : {}),
          ...(executionPlan.system !== undefined ? { system: executionPlan.system } : {}),
          parts,
        });
        promptAccepted = true;
        void pollForNewAssistantTurn({
          baselineAssistantMessageIds,
          isActive: () => isCurrentClient(client),
          refreshMessages: () => refreshMessages(sessionId, true),
        });
        promptSubmissionRef.current = { active: false, sessionId: undefined };
        if (!isCurrentClient(client)) {
          return true;
        }
        setTimeout(() => void refreshSessions(true).catch(() => undefined), 5000);

        setCurrentSessionId(sessionId);
        await fetchSessions(true);
        await Promise.all([
          refreshMessages(sessionId, true),
          refreshSessionDiff(sessionId, true),
          refreshSessionTodos(sessionId),
        ]);
        return true;
      } catch (error) {
        promptSubmissionRef.current = { active: false, sessionId: undefined };
        if (promptAccepted) {
          scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 1000 });
          return true;
        }
        setPromptError({
          message: error instanceof Error ? error.message : 'OpenCode could not send that message.',
          occurredAt: Date.now(),
          sessionId,
        });
        if (!promptAccepted) {
          pendingNotificationSessionIdsRef.current.delete(sessionId);
          notificationRequestedAtRef.current.delete(sessionId);
          await clearTrackedPendingNotification(sessionId).catch(() => undefined);
        }

        throw error;
      } finally {
        setSendingState({ active: false, sessionId: undefined });
      }
    },
    [activeProjectPath, authoritativePreferencesForSession, availableModels, chatPreferences, clearTrackedPendingNotification, client, currentSessionId, fetchSessions, isCurrentClient, messagesBySession, persistSessionPreferences, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions, rhythmAccount.user, scheduleSessionRefresh, sessions],
  );

  const abortSession = useCallback(
    async (sessionId: string) => {
      pendingNotificationSessionIdsRef.current.delete(sessionId);
      busyNotificationSessionIdsRef.current.delete(sessionId);
      notificationRequestedAtRef.current.delete(sessionId);
      await clearTrackedPendingNotification(sessionId);
      await client.session.abort({ sessionID: sessionId });

      await Promise.all([
        refreshSessions(true),
        refreshMessages(sessionId, true),
        refreshSessionDiff(sessionId, true),
        refreshSessionTodos(sessionId),
      ]);
    },
    [clearTrackedPendingNotification, client, refreshMessages, refreshSessionDiff, refreshSessionTodos, refreshSessions],
  );

  const speechInput = useSpeechInput({
    levelStep: 2,
    locale: chatPreferences.speechLocale,
    onResult: (transcript, isFinal) => {
      if (conversationPhaseRef.current !== 'listening') {
        return;
      }

      const nextTranscript = transcript.trim();
      if (!nextTranscript) {
        return;
      }

      pendingConversationTranscriptRef.current = nextTranscript;
      setConversationLatestHeardText(nextTranscript);
      if (conversationFinalResultTimeoutRef.current) {
        clearTimeout(conversationFinalResultTimeoutRef.current);
        conversationFinalResultTimeoutRef.current = undefined;
      }

      if (isFinal) {
        conversationFinalResultTimeoutRef.current = setTimeout(() => {
          conversationFinalResultTimeoutRef.current = undefined;
          flushPendingConversationResultRef.current();
        }, CONVERSATION_FINAL_RESULT_SETTLE_MS);
      }
    },
    preferOnDevice: chatPreferences.preferOnDeviceRecognition,
    volumeUpdateIntervalMillis: 400,
  });
  const {
    abort: abortSpeechInput,
    error: speechInputError,
    errorCode: speechInputErrorCode,
    isListening: isConversationListening,
    isStarting: isConversationListeningStarting,
    level: conversationListeningLevel,
    start: startSpeechInput,
  } = speechInput;

  const flushPendingConversationResult = useCallback(() => {
    const transcript = pendingConversationTranscriptRef.current?.trim();
    clearPendingConversationResult();
    if (!transcript || conversationPhaseRef.current !== 'listening') {
      return;
    }

    conversationPhaseRef.current = 'submitting';
    conversationSubmittingRef.current = true;
    abortSpeechInput();
    setPendingConversationTurn(transcript);
    setConversationPhase('submitting');
  }, [abortSpeechInput, clearPendingConversationResult]);
  flushPendingConversationResultRef.current = flushPendingConversationResult;

  const getLatestConversationAssistantEntry = useCallback(
    (sessionId?: string) => {
      if (!sessionId) {
        return undefined;
      }

        const transcript = (messagesBySession[sessionId] || []).map(toTranscriptEntry).filter(isTranscriptDisplayMessage);
      return [...transcript].reverse().find((entry) => entry.role === 'assistant' && entry.text.trim());
    },
    [messagesBySession],
  );

  const clearConversationFeedback = useCallback(() => {
    setConversationFeedback(undefined);
  }, []);

  const stopConversationMode = useCallback(async () => {
    clearPendingConversationResult();
    if (conversationResumeTimeoutRef.current) {
      clearTimeout(conversationResumeTimeoutRef.current);
      conversationResumeTimeoutRef.current = undefined;
    }
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = true;
    conversationSubmittingRef.current = false;
    conversationPhaseRef.current = 'off';
    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    setConversationLatestHeardText(undefined);
    setConversationPhase('off');
    setConversationSessionId(undefined);
  }, [abortSpeechInput, clearPendingConversationResult]);

  const startConversationListening = useCallback(async (sessionId?: string) => {
    if (!sessionId && !conversationSessionId) {
      return false;
    }

    clearPendingConversationResult();
    if (conversationResumeTimeoutRef.current) {
      clearTimeout(conversationResumeTimeoutRef.current);
      conversationResumeTimeoutRef.current = undefined;
    }
    if (conversationListeningRestartTimeoutRef.current) {
      clearTimeout(conversationListeningRestartTimeoutRef.current);
      conversationListeningRestartTimeoutRef.current = undefined;
    }

    conversationCancelRequestedRef.current = false;
    conversationSubmittingRef.current = false;
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    await stopWorkingSoundAsync().catch(() => undefined);

    const started = await startSpeechInput({ continuous: true });
    if (!started) {
      conversationPhaseRef.current = 'off';
      setConversationPhase('off');
      return false;
    }

    conversationPhaseRef.current = 'listening';
    setConversationPhase('listening');
    return true;
  }, [clearPendingConversationResult, conversationSessionId, startSpeechInput]);

  const toggleConversationMode = useCallback(async () => {
    if (conversationPhase !== 'off') {
      await stopConversationMode();
      return;
    }

    if (connection.status !== 'connected') {
      setConversationFeedback('Connect to OpenCode before starting conversation mode.');
      return;
    }

    if (sendingState.active) {
      setConversationFeedback('Wait for the current reply to finish before starting conversation mode.');
      return;
    }

    const pendingInteractionCount = currentSessionId
      ? (pendingPermissionsBySession[currentSessionId] || []).length + (pendingQuestionsBySession[currentSessionId] || []).length
      : 0;
    if (pendingInteractionCount > 0) {
      setConversationFeedback('Answer the current request before starting conversation mode.');
      return;
    }

    const sessionId = currentSessionId || (await ensureActiveSession());
    if (!sessionId) {
      return;
    }

    abortSpeechInput();
    await stopSpeaking().catch(() => undefined);
    await stopWorkingSoundAsync().catch(() => undefined);
    setCurrentSessionId(sessionId);
    setConversationSessionId(sessionId);
    setConversationFeedback(undefined);
    setPendingConversationTurn(undefined);
    setQueuedConversationPrompt(undefined);
    assistantReplyBaselineIdRef.current = getLatestConversationAssistantEntry(sessionId)?.id;
    const started = await startConversationListening(sessionId);
    if (!started) {
      setConversationSessionId(undefined);
    }
  }, [
    abortSpeechInput,
    connection.status,
    conversationPhase,
    currentSessionId,
    ensureActiveSession,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState.active,
    startConversationListening,
    stopConversationMode,
  ]);

  useEffect(() => {
    Object.entries(sessionStatuses).forEach(([sessionId, status]) => {
      if (status.type !== 'idle' && pendingNotificationSessionIdsRef.current.has(sessionId)) {
        busyNotificationSessionIdsRef.current.add(sessionId);
      }
    });
  }, [sessionStatuses]);

  useEffect(() => {
    conversationPhaseRef.current = conversationPhase;
    if (conversationPhase !== 'submitting') {
      conversationSubmittingRef.current = false;
    }
  }, [conversationPhase]);

  useEffect(() => {
    if (conversationPhase !== 'listening' || isConversationListening || isConversationListeningStarting) {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
      return;
    }

    if (conversationCancelRequestedRef.current || conversationSubmittingRef.current) {
      return;
    }

    conversationListeningRestartTimeoutRef.current = setTimeout(() => {
      conversationListeningRestartTimeoutRef.current = undefined;
      if (
        conversationPhaseRef.current !== 'listening' ||
        conversationCancelRequestedRef.current ||
        conversationSubmittingRef.current
      ) {
        return;
      }

      void startConversationListening();
    }, CONVERSATION_LISTENING_RESTART_MS);

    return () => {
      if (conversationListeningRestartTimeoutRef.current) {
        clearTimeout(conversationListeningRestartTimeoutRef.current);
        conversationListeningRestartTimeoutRef.current = undefined;
      }
    };
  }, [conversationPhase, isConversationListening, isConversationListeningStarting, startConversationListening]);

  useConversationKeepAwake(conversationPhase, CONVERSATION_KEEP_AWAKE_TAG);
  useConversationScreenDim(conversationPhase);

  useEffect(() => {
    if (!speechInputError) {
      return;
    }

    if (
      conversationPhaseRef.current === 'listening' &&
      (speechInputErrorCode === 'client' || speechInputErrorCode === 'no-speech' || speechInputErrorCode === 'speech-timeout')
    ) {
      return;
    }

    setConversationFeedback(speechInputError);
    if (conversationPhaseRef.current !== 'off') {
      void stopConversationMode();
    }
  }, [speechInputError, speechInputErrorCode, stopConversationMode]);

  useEffect(() => {
    if (conversationPhase === 'off' || conversationPhase !== 'submitting' || !pendingConversationTurn || !conversationSessionId) {
      return;
    }

    setQueuedConversationPrompt(pendingConversationTurn);
    setPendingConversationTurn(undefined);
  }, [conversationPhase, conversationSessionId, pendingConversationTurn]);

  useEffect(() => {
    if (conversationPhase === 'off' || conversationPhase !== 'submitting' || !queuedConversationPrompt || !conversationSessionId) {
      return;
    }

    let cancelled = false;

    const submitPrompt = async () => {
      try {
        assistantReplyBaselineIdRef.current = getLatestConversationAssistantEntry(conversationSessionId)?.id;
        await sendPrompt(conversationSessionId, queuedConversationPrompt);
        if (cancelled) {
          return;
        }

        if (conversationCancelRequestedRef.current || conversationPhaseRef.current === 'off') {
          setQueuedConversationPrompt(undefined);
          setPendingConversationTurn(undefined);
          return;
        }

        setQueuedConversationPrompt(undefined);
        setConversationPhase('waiting');
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Voice conversation failed while sending your message.';
        setQueuedConversationPrompt(undefined);
        setPendingConversationTurn(undefined);
        setConversationFeedback(message);
        await stopConversationMode();
      }
    };

    void submitPrompt();

    return () => {
      cancelled = true;
    };
  }, [
    conversationPhase,
    conversationSessionId,
    getLatestConversationAssistantEntry,
    queuedConversationPrompt,
    sendPrompt,
    stopConversationMode,
  ]);

  useEffect(() => {
    if (conversationPhase === 'off' || conversationPhase !== 'waiting') {
      return;
    }

    const pendingInteractions = conversationSessionId
      ? (pendingPermissionsBySession[conversationSessionId] || []).length + (pendingQuestionsBySession[conversationSessionId] || []).length
      : 0;
    const latestAssistantEntry = getLatestConversationAssistantEntry(conversationSessionId);
    const sessionStatus = conversationSessionId ? sessionStatuses[conversationSessionId] : undefined;
    const isSessionRunning = conversationSessionId
      ? sendingState.sessionId === conversationSessionId || sendingState.active || (!!sessionStatus && sessionStatus.type !== 'idle')
      : false;

    if (pendingInteractions > 0) {
      setConversationFeedback('Conversation mode paused because the assistant needs your input on screen.');
      void stopConversationMode();
      return;
    }

    if (isSessionRunning) {
      return () => {
        void stopWorkingSoundAsync().catch(() => undefined);
      };
    }

    void stopWorkingSoundAsync().catch(() => undefined);
    if (latestAssistantEntry && latestAssistantEntry.id !== assistantReplyBaselineIdRef.current) {
      void (async () => {
        const started = await speakText({
          language: chatPreferences.speechLocale,
          onDone: () => {
            if (conversationPhaseRef.current !== 'off' && chatPreferences.resumeListeningAfterReply) {
              void startConversationListening();
            } else {
              void stopConversationMode();
            }
          },
          onError: () => {
            setConversationFeedback('Unable to play this assistant reply.');
            void stopConversationMode();
          },
          onStart: () => {
            setConversationPhase('speaking');
          },
          rate: chatPreferences.speechRate,
          text: latestAssistantEntry.text,
          voice: chatPreferences.speechVoiceId,
        });

        if (!started) {
          if (chatPreferences.resumeListeningAfterReply) {
            void startConversationListening();
          } else {
            void stopConversationMode();
          }
        }
      })();
      return;
    }

    conversationResumeTimeoutRef.current = setTimeout(() => {
      if (conversationPhaseRef.current === 'waiting' && !isSessionRunning) {
        void startConversationListening();
      }
    }, 1200);

    return () => {
      if (conversationResumeTimeoutRef.current) {
        clearTimeout(conversationResumeTimeoutRef.current);
        conversationResumeTimeoutRef.current = undefined;
      }
    };
  }, [
    chatPreferences.resumeListeningAfterReply,
    chatPreferences.speechLocale,
    chatPreferences.speechRate,
    chatPreferences.speechVoiceId,
    conversationPhase,
    conversationSessionId,
    getLatestConversationAssistantEntry,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    sendingState.active,
    sendingState.sessionId,
    sessionStatuses,
    startConversationListening,
    stopConversationMode,
  ]);

  useEffect(() => {
    if (conversationPhase === 'off' || connection.status === 'connected') {
      return;
    }

    setConversationFeedback(connection.message || 'OpenCode disconnected. Conversation mode will resume when the connection returns.');
  }, [connection.message, connection.status, conversationPhase]);

  useEffect(() => {
    if (connection.status !== 'connected') {
      return;
    }

    setConversationFeedback((current) => {
      if (!current) {
        return current;
      }

      if (current === connection.message || current.includes('resume when the connection returns')) {
        return undefined;
      }

      return current;
    });
  }, [connection.message, connection.status]);

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      setEventStreamStatus('idle');
      return;
    }

    let mounted = true;
    let activeAbortController: AbortController | undefined;
    const seenEventIds = new Set<string>();
    const rememberEvent = (event: GlobalEvent['payload']) => {
      const id = getStableRecoveryEventId(event);
      if (!id) return true;
      if (seenEventIds.has(id)) return false;
      seenEventIds.add(id);
      if (seenEventIds.size > 2048) {
        const oldest = seenEventIds.values().next().value;
        if (oldest) seenEventIds.delete(oldest);
      }
      return true;
    };

    const handleEvent = (event: GlobalEvent['payload']) => {
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          coalescedRefreshSessions.trigger();
          return;
        case 'session.deleted':
          coalescedRefreshSessions.trigger();
          coalescedRefreshArchivedSessions.trigger();
          return;
        case 'session.status': {
          const sessionId = event.properties.sessionID;
          setSessionStatuses((current) => ({
            ...current,
            [sessionId]: event.properties.status,
          }));
          scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true });
          return;
        }
        case 'session.idle': {
          const sessionId = event.properties.sessionID;
          setSessionStatuses((current) => ({
            ...current,
            [sessionId]: { type: 'idle' },
          }));
          scheduleSessionRefresh(sessionId, { sessions: true, messages: true, diff: true, todos: true, delayMs: 50 });
          coalescedIdleRefresh.trigger();
          return;
        }
        case 'session.error': {
          const sessionId = event.properties.sessionID;
          const error = event.properties.error;
          const message = error && 'data' in error && error.data && 'message' in error.data
            ? error.data.message
            : error && 'message' in error
              ? error.message
              : 'OpenCode could not complete the request.';
          setPromptError({
            message: error?.name ? `${error.name}: ${message}` : String(message),
            occurredAt: Date.now(),
            sessionId,
          });
          if (sessionId) {
            scheduleSessionRefresh(sessionId, { sessions: true, messages: true });
          }
          return;
        }
        case 'message.updated': {
          scheduleSessionRefresh(event.properties.sessionID, { messages: true });
          return;
        }
        case 'message.removed':
          setMessagesBySession((current) => ({
            ...current,
            [event.properties.sessionID]: pruneSessionMessage(
              current[event.properties.sessionID] || [],
              event.properties.messageID,
            ),
          }));
          scheduleSessionRefresh(event.properties.sessionID, { messages: true });
          return;
        case 'message.part.updated':
        case 'message.part.removed': {
          scheduleSessionRefresh(event.properties.sessionID, { messages: true });
          return;
        }
        case 'session.compacted': {
          scheduleSessionRefresh(event.properties.sessionID, { sessions: true, diff: true, todos: true });
          void replaceSessionMessages(event.properties.sessionID, true);
          return;
        }
        case 'project.updated':
          void refreshWorkspaceCatalog(true);
          return;
        case 'file.edited':
        case 'vcs.branch.updated':
          void refreshServerFeatures();
          return;
        case 'pty.created':
        case 'pty.updated':
        case 'pty.exited':
        case 'pty.deleted':
          void refreshTerminals();
          return;
        case 'worktree.ready':
        case 'worktree.failed':
          void refreshWorktrees();
          void refreshWorkspaceCatalog(true);
          return;
        case 'mcp.tools.changed':
        case 'mcp.browser.open.failed':
          void refreshMcpServers();
          return;
        case 'lsp.updated':
          void refreshDiagnostics();
          return;
        case 'session.diff': {
          const sessionId = event.properties.sessionID;
          if (event.properties.diff.length > 0) {
            setDiffsBySession((current) => ({
              ...current,
              [sessionId]: event.properties.diff,
            }));
          } else {
            scheduleSessionRefresh(sessionId, { diff: true, delayMs: 50 });
          }
          return;
        }
        case 'todo.updated': {
          const sessionId = event.properties.sessionID;
          setTodosBySession((current) => ({
            ...current,
            [sessionId]: event.properties.todos,
          }));
          return;
        }
        case 'permission.asked': {
          const request = event.properties;
          setPendingPermissionsBySession((current) => ({
            ...current,
            [request.sessionID]: [
              ...(current[request.sessionID] || []).filter((item) => item.id !== request.id),
              request,
            ],
          }));
          return;
        }
        case 'permission.replied': {
          const { sessionID, requestID } = event.properties;
          setPendingPermissionsBySession((current) => ({
            ...current,
            [sessionID]: (current[sessionID] || []).filter((item) => item.id !== requestID),
          }));
          return;
        }
        case 'question.asked': {
          const request = event.properties;
          setPendingQuestionsBySession((current) => ({
            ...current,
            [request.sessionID]: [
              ...(current[request.sessionID] || []).filter((item) => item.id !== request.id),
              request,
            ],
          }));
          return;
        }
        case 'question.replied':
        case 'question.rejected': {
          const { sessionID, requestID } = event.properties;
          setPendingQuestionsBySession((current) => ({
            ...current,
            [sessionID]: (current[sessionID] || []).filter((item) => item.id !== requestID),
          }));
          return;
        }
        default:
          return;
      }
    };

    const subscribe = async () => {
      let retryAttempt = 0;
      let reachabilityFailureReported = false;
      while (mounted) {
        const abortController = new AbortController();
        activeAbortController = abortController;
        setEventStreamStatus(retryAttempt === 0 ? 'connecting' : 'error');

        try {
          // React Native's XHR-backed fetch cannot stream SSE (issue #1287):
          // the generated SDK subscription hangs forever on device without
          // erroring. Native platforms stream through expo/fetch instead;
          // web keeps the SDK path, which streams correctly in browsers.
          let envelopeStream: AsyncIterable<{ directory?: string; payload?: GlobalEvent['payload'] }>;
          if (Platform.OS !== 'web') {
            envelopeStream = (pairedHostClient
              ? streamPairedGlobalEvents(pairedHostClient, activeProjectPath, abortController.signal)
              : (() => {
                  const request = buildGlobalEventStreamRequest(settings);
                  return streamDirectGlobalEvents(request.url, request.headers, abortController.signal);
                })()) as AsyncIterable<{ directory?: string; payload?: GlobalEvent['payload'] }>;
          } else {
            const eventClient = pairedHostClient ? client : catalogClient;
            const subscription = await eventClient.global.event({ signal: abortController.signal, sseMaxRetryAttempts: 1 });
            envelopeStream = subscription.stream;
          }
          await Promise.all([
            refreshSessions(true),
            refreshArchivedSessions(),
            refreshPendingInteractions(),
            refreshServerFeatures(),
            refreshCurrentSession(true),
          ]);
          for await (const envelope of envelopeStream) {
            if (!mounted || abortController.signal.aborted) {
              break;
            }
            // Any received envelope proves the stream is live. Only then is
            // the 5s polling fallback allowed to stand down — a stream that
            // opens but never delivers must not silence the safety net.
            setEventStreamStatus('connected');
            retryAttempt = 0;
            reachabilityFailureReported = false;
            if (envelope?.directory === activeProjectPath && envelope.payload) {
              if (rememberEvent(envelope.payload)) {
                handleEvent(envelope.payload);
              }
            }
          }
          if (mounted && !abortController.signal.aborted) {
            throw new Error('OpenCode event stream ended.');
          }
        } catch {
          if (!mounted || abortController.signal.aborted) {
            break;
          }
          setEventStreamStatus('error');
          if (pairedHostClient && !reachabilityFailureReported) {
            reachabilityFailureReported = true;
            void refreshPairedHost();
          }
          const retryDelay = getRecoveryDelayMs(retryAttempt);
          retryAttempt += 1;
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    };

    void subscribe();

    return () => {
      mounted = false;
      activeAbortController?.abort();
    };
  }, [activeProjectPath, catalogClient, client, coalescedIdleRefresh, coalescedRefreshArchivedSessions, coalescedRefreshSessions, connection.status, pairedHostClient, refreshArchivedSessions, refreshChatCapabilities, refreshCurrentSession, refreshDiagnostics, refreshMcpServers, refreshPairedHost, refreshPendingInteractions, refreshServerFeatures, refreshSessions, refreshTerminals, refreshWorktrees, refreshWorkspaceCatalog, replaceSessionMessages, scheduleSessionRefresh, settings]);

  useEffect(
    () => () => {
      Object.values(sessionRefreshTimeoutsRef.current).forEach((timeout) => clearTimeout(timeout));
      sessionRefreshTimeoutsRef.current = {};
      sessionRefreshOptionsRef.current = {};
      if (conversationResumeTimeoutRef.current) {
        clearTimeout(conversationResumeTimeoutRef.current);
      }
      if (conversationFinalResultTimeoutRef.current) {
        clearTimeout(conversationFinalResultTimeoutRef.current);
      }

      void stopSpeaking().catch(() => undefined);
      void unloadWorkingSoundAsync().catch(() => undefined);
      terminalSocketRef.current?.close();
      openProjectSessionControllerRef.current?.cancelOpenProjectSession();
    },
    [],
  );

  useEffect(() => {
    if (connection.status !== 'connected' || !activeProjectPath) {
      return;
    }

    const hasBusySession = Object.values(sessionStatuses).some((status) => status.type !== 'idle');
    const hasConversationActivity = conversationPhase !== 'off';
    const useSafetyPolling = eventStreamStatus !== 'connected';
    const shouldKeepSafetyPoll = useSafetyPolling || hasBusySession || sendingState.active || hasConversationActivity;

    if (!shouldKeepSafetyPoll) {
      return;
    }

    const interval = setInterval(() => {
      const currentHasBusySession = Object.values(sessionStatuses).some((status) => status.type !== 'idle');
      const currentHasConversationActivity = conversationPhase !== 'off';

      if (currentHasConversationActivity || currentHasBusySession || sendingState.active || useSafetyPolling) {
        void refreshSessions(true);
        void refreshPendingInteractions();
      }

      if (currentSessionId && (currentHasConversationActivity || currentHasBusySession || sendingState.active || useSafetyPolling)) {
        void Promise.all([
          refreshMessages(currentSessionId, true),
          refreshSessionDiff(currentSessionId, true),
          refreshSessionTodos(currentSessionId),
        ]);
      }

      if (conversationSessionId && conversationSessionId !== currentSessionId && (currentHasConversationActivity || currentHasBusySession || sendingState.active || useSafetyPolling)) {
        void Promise.all([
          refreshMessages(conversationSessionId, true),
          refreshSessionDiff(conversationSessionId, true),
          refreshSessionTodos(conversationSessionId),
        ]);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeProjectPath, connection.status, conversationPhase, conversationSessionId, currentSessionId, eventStreamStatus, refreshMessages, refreshPendingInteractions, refreshSessionDiff, refreshSessionTodos, refreshSessions, sendingState.active, sessionStatuses]);

  useEffect(() => {
    const busy = sendingState.active || Object.values(sessionStatuses).some((status) => status.type !== 'idle');
    const shouldPlay = Platform.OS !== 'web' && chatPreferences.workingSoundEnabled && busy && conversationPhase !== 'listening' && conversationPhase !== 'speaking';
    if (shouldPlay) {
      void startWorkingSoundAsync(chatPreferences.workingSoundVariant, chatPreferences.workingSoundVolume).catch(() => undefined);
      return;
    }
    void stopWorkingSoundAsync().catch(() => undefined);
  }, [chatPreferences.workingSoundEnabled, chatPreferences.workingSoundVariant, chatPreferences.workingSoundVolume, conversationPhase, sendingState.active, sessionStatuses]);

  useEffect(() => {
    let cancelled = false;

    async function flushCompletedNotifications() {
      const pendingIds = [...pendingNotificationSessionIdsRef.current];
      if (pendingIds.length === 0) {
        return;
      }

      for (const sessionId of pendingIds) {
        const status = sessionStatuses[sessionId];
        const oldEnough = Date.now() - (notificationRequestedAtRef.current.get(sessionId) || Date.now()) >= 5000;
        if ((!busyNotificationSessionIdsRef.current.has(sessionId) && !oldEnough) || (status && status.type !== 'idle') || (sendingState.active && sendingState.sessionId === sessionId)) {
          continue;
        }

        const session = sessions.find((item) => item.id === sessionId);
        if (!session) {
          pendingNotificationSessionIdsRef.current.delete(sessionId);
          busyNotificationSessionIdsRef.current.delete(sessionId);
          notificationRequestedAtRef.current.delete(sessionId);
          await clearTrackedPendingNotification(sessionId).catch(() => undefined);
          continue;
        }
        await clearTrackedPendingNotification(sessionId);
        if (cancelled) {
          return;
        }

        pendingNotificationSessionIdsRef.current.delete(sessionId);
        busyNotificationSessionIdsRef.current.delete(sessionId);
        notificationRequestedAtRef.current.delete(sessionId);
        const title = session.title || 'Task complete';
        await notifyTaskFinished('OpenCode finished a task', title);
      }
    }

    void flushCompletedNotifications();

    return () => {
      cancelled = true;
    };
  }, [clearTrackedPendingNotification, sendingState.active, sendingState.sessionId, sessionStatuses, sessions]);

  const updateSettings = useCallback((patch: Partial<OpencodeConnectionSettings>) => {
    const connectionChanged = (['serverUrl', 'username', 'password'] as const)
      .some((key) => patch[key] !== undefined && patch[key] !== settingsRef.current[key]);
    if (connectionChanged) {
      if (Platform.OS === 'web' && !pairedHost.client && !pairedHost.host) {
        const nextSettings = { ...settingsRef.current, ...patch };
        connectionTargetRef.current =
          `direct:${nextSettings.serverUrl}:${nextSettings.username}:${nextSettings.password}`;
      }
      scopeGenerationRef.current += 1;
      serverGenerationRef.current += 1;
      setConnection({ status: 'idle', message: 'Connection settings changed. Reconnect to apply them.' });
      setActiveProjectPath(undefined);
      clearProjectState();
      setMessagesBySession({});
      setDiffsBySession({});
      setTodosBySession({});
      setServerProjects([]);
      setCurrentProjectPath(undefined);
      setServerRootPath(undefined);
      setDiagnostics(undefined);
    }
    setSettings((current) => ({
      ...current,
      ...patch,
    }));
  }, [clearProjectState, pairedHost.client, pairedHost.host]);
  const clearPromptError = useCallback(() => setPromptError(undefined), []);

  useEffect(() => {
    const nextSessionId = reconcileSessionSelectionAfterRefresh({
      activeProjectId: activeProjectPath,
      currentSessionId,
      lastSessionByProject,
      openState: openProjectSessionState,
      sessions,
    });
    if (nextSessionId !== currentSessionId) {
      setCurrentSessionId(nextSessionId);
    }
  }, [
    activeProjectPath,
    currentSessionId,
    lastSessionByProject,
    openProjectSessionState,
    sessions,
  ]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const currentMessages = useMemo(
    () => (currentSessionId ? messagesBySession[currentSessionId] || [] : []),
    [currentSessionId, messagesBySession],
  );
  const currentDiffs = useMemo(
    () => (currentSessionId ? diffsBySession[currentSessionId] || [] : []),
    [currentSessionId, diffsBySession],
  );
  const currentTodos = useMemo(
    () => (currentSessionId ? todosBySession[currentSessionId] || [] : []),
    [currentSessionId, todosBySession],
  );
  const currentPendingPermissions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingPermissionsBySession),
    [currentSessionId, pendingPermissionsBySession, sendingState.sessionId],
  );
  const currentPendingQuestions = useMemo(
    () => getCurrentPendingRequests(currentSessionId, sendingState.sessionId, pendingQuestionsBySession),
    [currentSessionId, pendingQuestionsBySession, sendingState.sessionId],
  );
  const configuredProviders = useMemo(() => getConfiguredProviders(availableProviders), [availableProviders]);
  const usagePricingByModel = useMemo(
    () => Object.fromEntries(availableModels.flatMap((model) => model.pricing ? [[`${model.providerID}/${model.modelID}`, model.pricing] as const] : [])),
    [availableModels],
  );
  const currentUsage = useMemo(() => aggregateSessionUsage(currentMessages, usagePricingByModel), [currentMessages, usagePricingByModel]);
  const latestAssistantTurnUsage = useMemo(
    () => getLatestAssistantTurnUsage(currentMessages, usagePricingByModel),
    [currentMessages, usagePricingByModel],
  );
  const currentTranscript = useMemo(() => getTranscript(currentMessages), [currentMessages]);
  const hasOlderMessages = Boolean(
    currentSessionId && hasOlderMessagesBySession[currentSessionId],
  );
  const conversationMessages = useMemo(
    () => (conversationSessionId ? messagesBySession[conversationSessionId] || [] : []),
    [conversationSessionId, messagesBySession],
  );
  const conversationTranscript = useMemo(() => getTranscript(conversationMessages), [conversationMessages]);
  const conversationCurrentActivityLabel = useMemo(() => getTranscriptActivityLabelForEntries(conversationTranscript), [conversationTranscript]);
  const conversationActive = conversationPhase !== 'off';
  const conversationStatusLabel = useMemo(() => getConversationStatusLabel(conversationPhase, conversationCurrentActivityLabel), [conversationCurrentActivityLabel, conversationPhase]);
  const sessionPreviewById = useMemo(() => getSessionPreviewById(messagesBySession), [messagesBySession]);

  const contextValue = useMemo<OpencodeContextValue>(
    () => ({
      isHydrated,
      settings,
      buildScopedClient,
      updateSettings,
      connection,
      projects,
      activeProjectPath,
      activeProject,
      selectProject,
      serverProjects,
      currentProjectPath,
      serverRootPath,
      isRefreshingWorkspaceCatalog,
      refreshWorkspaceCatalog,
      refreshWorkspaceStatus: refreshServerFeatures,
      sessions,
      archivedSessions,
      sessionStatuses,
      currentSessionId,
      activeSession,
      currentMessages,
      hasOlderMessages,
      currentUsage,
      latestAssistantTurnUsage,
      currentDiffs,
      currentTranscript,
      currentTodos,
      currentPendingPermissions,
      currentPendingQuestions,
      sessionPreviewById,
      isRefreshingSessions,
      isRefreshingMessages,
      isRefreshingDiffs,
      isBootstrappingChat,
      currentConfig,
      availableProviders,
      providerAuthMethodsById,
      configuredProviders,
      availableModels,
      availableAgents,
      loadSessionProfiles,
      chatPreferences,
      updateChatPreferences,
      updateSessionPreferences,
      conversation: {
        active: conversationActive,
        feedback: conversationFeedback,
        isListening: isConversationListening,
        level: conversationListeningLevel,
        latestHeardText: conversationLatestHeardText,
        phase: conversationPhase,
        sessionId: conversationSessionId,
        statusLabel: conversationStatusLabel,
      },
      clearConversationFeedback,
      toggleConversationMode,
      configureProvider,
      completeAutomaticProviderOAuth,
      setProviderAuth,
      removeProvider,
      startProviderOAuth,
      completeProviderOAuth,
      setAutoApprove,
      sendingState,
      promptError,
      clearPromptError,
      connect,
      refreshSessions,
      openProjectSessionState,
      openProjectSession,
      cancelOpenProjectSession,
      openSession,
      refreshCurrentSession,
      loadOlderMessages,
      refreshCurrentTodos,
      ensureActiveSession,
      createSession,
      deleteSession,
      archiveSession,
      restoreSession,
      refreshArchivedSessions,
      renameSession,
      forkSession,
      revertSession,
      unrevertSession,
      getSessionChildren,
      deleteSessionMessage,
      updateSessionTextPart,
      deleteSessionPart,
      initializeSession,
      runSessionShell,
      sendPrompt,
      abortSession,
      replyToPermission,
      replyToQuestion,
      rejectQuestion,
      commands,
      executeCommand,
      workspaceFiles,
      workspaceFileStatuses,
      selectedWorkspaceFile,
      vcsInfo,
      searchWorkspaceFiles,
      listWorkspaceDirectory,
      searchWorkspaceText,
      searchWorkspaceSymbols,
      getWorkspaceVcsStatus,
      getWorkspaceVcsDiff,
      getWorkspaceRawVcsDiff,
      openWorkspaceFile,
      saveWorkspaceFile,
      updateProjectMetadata,
      initializeProjectGit,
      worktrees,
      refreshWorktrees,
      createWorktree,
      resetWorktree,
      removeWorktree,
      mcpStatuses,
      refreshMcpServers,
      addMcpServer,
      connectMcpServer,
      disconnectMcpServer,
      setMcpServerEnabled,
      startMcpOAuth,
      completeMcpOAuth,
      removeMcpOAuth,
      loadOpenCodeInspection,
      reloadOpenCodeSkills,
      reloadOpenCodeConfig,
      terminals,
      terminalShells,
      activeTerminalId,
      terminalOutput,
      terminalConnection,
      refreshTerminals,
      createTerminal,
      getTerminalDetail,
      resizeTerminal,
      openTerminal,
      sendTerminalInput,
      closeTerminal,
      diagnostics,
      refreshDiagnostics,
      eventStreamStatus,
    }),
    [
      activeSession,
      activeProject,
      activeProjectPath,
      connect,
      connection,
      currentConfig,
      availableProviders,
      providerAuthMethodsById,
      configuredProviders,
      currentDiffs,
      createSession,
      deleteSession,
      renameSession,
      forkSession,
      revertSession,
      unrevertSession,
      getSessionChildren,
      deleteSessionMessage,
      updateSessionTextPart,
      deleteSessionPart,
      initializeSession,
      runSessionShell,
      configureProvider,
      completeAutomaticProviderOAuth,
      currentMessages,
      hasOlderMessages,
      currentUsage,
      latestAssistantTurnUsage,
      currentSessionId,
      currentTranscript,
      currentTodos,
      currentPendingPermissions,
      currentPendingQuestions,
      chatPreferences,
      clearConversationFeedback,
      clearPromptError,
      cancelOpenProjectSession,
      conversationActive,
      conversationFeedback,
      conversationLatestHeardText,
      conversationListeningLevel,
      conversationPhase,
      conversationSessionId,
      conversationStatusLabel,
      ensureActiveSession,
      availableAgents,
      availableModels,
      loadSessionProfiles,
      isConversationListening,
      isBootstrappingChat,
      isRefreshingDiffs,
      isHydrated,
      isRefreshingMessages,
      isRefreshingWorkspaceCatalog,
      isRefreshingSessions,
      openSession,
      openProjectSession,
      openProjectSessionState,
      promptError,
      currentProjectPath,
      projects,
      refreshCurrentSession,
      loadOlderMessages,
      refreshCurrentTodos,
      refreshWorkspaceCatalog,
      refreshServerFeatures,
      refreshSessions,
      replyToPermission,
      replyToQuestion,
      rejectQuestion,
      selectProject,
      setAutoApprove,
      sendPrompt,
      abortSession,
      sendingState,
      serverRootPath,
      sessionPreviewById,
      sessionStatuses,
      sessions,
      serverProjects,
      settings,
      buildScopedClient,
      setProviderAuth,
      removeProvider,
      startProviderOAuth,
      completeProviderOAuth,
      toggleConversationMode,
      updateChatPreferences,
      updateSessionPreferences,
      updateSettings,
      commands,
      executeCommand,
      workspaceFiles,
      workspaceFileStatuses,
      selectedWorkspaceFile,
      vcsInfo,
      searchWorkspaceFiles,
      listWorkspaceDirectory,
      searchWorkspaceText,
      searchWorkspaceSymbols,
      getWorkspaceVcsStatus,
      getWorkspaceVcsDiff,
      getWorkspaceRawVcsDiff,
      openWorkspaceFile,
      diagnostics,
      refreshDiagnostics,
      eventStreamStatus,
      archivedSessions,
      archiveSession,
      restoreSession,
      refreshArchivedSessions,
      saveWorkspaceFile,
      updateProjectMetadata,
      initializeProjectGit,
      worktrees,
      refreshWorktrees,
      createWorktree,
      resetWorktree,
      removeWorktree,
      mcpStatuses,
      refreshMcpServers,
      addMcpServer,
      connectMcpServer,
      disconnectMcpServer,
      setMcpServerEnabled,
      startMcpOAuth,
      completeMcpOAuth,
      removeMcpOAuth,
      loadOpenCodeInspection,
      reloadOpenCodeSkills,
      reloadOpenCodeConfig,
      terminals,
      terminalShells,
      activeTerminalId,
      terminalOutput,
      terminalConnection,
      refreshTerminals,
      createTerminal,
      getTerminalDetail,
      resizeTerminal,
      openTerminal,
      sendTerminalInput,
      closeTerminal,
    ],
  );

  return <OpencodeContext.Provider value={contextValue}>{children}</OpencodeContext.Provider>;
}

export function useOpencode() {
  const context = useContext(OpencodeContext);
  if (!context) {
    throw new Error('useOpencode must be used inside OpencodeProvider');
  }

  return context;
}
