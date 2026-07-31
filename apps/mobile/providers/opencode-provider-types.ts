import type {
  Command,
  Config,
  File,
  FileContent,
  FileDiff,
  FileNode,
  GlobalSession,
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
  Project,
  ProviderAuthMethod,
  Pty,
  PtyShellsResponse,
  Session,
  SessionStatus,
  Skills,
  Symbol,
  Todo,
  VcsFileDiff,
  VcsFileStatus,
  VcsInfo,
  Worktree,
} from '@/lib/opencode/types';
import type {
  OpencodeConnectionSettings,
  ScopedOpencodeClient,
  PendingQuestionAnswer,
  PendingQuestionRequest,
  PendingPermissionRequest,
} from '@/lib/opencode/client';
import type { Diagnostics } from '@/providers/services/diagnostics-service';
import type { SessionMessageRecord, TranscriptEntry } from '@/lib/opencode/format';
import type { SessionUsage } from '@/lib/opencode/usage';
import type { OpenCodeInspection } from '@/providers/services/opencode-inspection-service';
import type { ProjectMetadataUpdate } from '@/providers/services/project-service';
import type { WorkspaceTextMatch } from '@/providers/services/workspace-service';
import type {
  AgentOption as ProviderAgentOption,
  ChatPreferences as ProviderChatPreferences,
  ModelOption as ProviderModelOption,
  ReasoningLevel as ProviderReasoningLevel,
  ResponseScope as ProviderResponseScope,
  SessionExecutionState,
} from '@/providers/opencode-provider-utils';

export type AgentOption = ProviderAgentOption;
export type ChatPreferences = ProviderChatPreferences;
export type ModelOption = ProviderModelOption;
export type ReasoningLevel = ProviderReasoningLevel;
export type ResponseScope = ProviderResponseScope;
export type {
  OpenCodeAgentId,
  RhythmProfileId,
  SessionExecutionState,
} from '@/providers/opencode-provider-utils';
export type { ProviderAuthMethod } from '@/lib/opencode/types';

export type MobileSession = Session & {
  rhythm?: SessionExecutionState;
};

export type ProviderOption = {
  id: string;
  label: string;
  accountLabel?: string;
  modelCount: number;
  configured: boolean;
  connected: boolean;
};

export type ConversationPhase = 'off' | 'listening' | 'submitting' | 'waiting' | 'speaking';

export const CONVERSATION_KEEP_AWAKE_TAG = 'opencode-conversation-mode';
export const CONVERSATION_FINAL_RESULT_SETTLE_MS = 2200;
export const CONVERSATION_LISTENING_RESTART_MS = 350;

export type ConversationState = {
  active: boolean;
  sessionId?: string;
  phase: ConversationPhase;
  statusLabel?: string;
  feedback?: string;
  latestHeardText?: string;
  isListening: boolean;
  level: number;
};

export type OpencodeProject = {
  id?: string;
  label: string;
  path: string;
  source: 'server';
  updatedAt?: number;
  isCurrent?: boolean;
};

export type ConnectionState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  message: string;
  checkedAt?: number;
  projectDirectory?: string;
};

export type WorkspaceCatalog = {
  currentProjectPath?: string;
  serverRootPath?: string;
  serverProjects: Project[];
};

export type OpencodeContextValue = {
  isHydrated: boolean;
  settings: OpencodeConnectionSettings;
  buildScopedClient: (projectId: string) => ScopedOpencodeClient;
  updateSettings: (patch: Partial<OpencodeConnectionSettings>) => void;
  connection: ConnectionState;
  projects: OpencodeProject[];
  activeProjectPath?: string;
  activeProject?: OpencodeProject;
  selectProject: (path: string) => void;
  serverProjects: Project[];
  currentProjectPath?: string;
  serverRootPath?: string;
  isRefreshingWorkspaceCatalog: boolean;
  refreshWorkspaceCatalog: (silent?: boolean) => Promise<void>;
  refreshWorkspaceStatus: () => Promise<void>;
  sessions: MobileSession[];
  archivedSessions: GlobalSession[];
  sessionStatuses: Record<string, SessionStatus>;
  currentSessionId?: string;
  activeSession?: MobileSession;
  currentMessages: SessionMessageRecord[];
  currentTranscript: TranscriptEntry[];
  currentUsage: SessionUsage;
  latestAssistantTurnUsage?: SessionUsage;
  currentDiffs: FileDiff[];
  currentTodos: Todo[];
  currentPendingPermissions: PendingPermissionRequest[];
  currentPendingQuestions: PendingQuestionRequest[];
  sessionPreviewById: Record<string, string>;
  isRefreshingSessions: boolean;
  isRefreshingMessages: boolean;
  isRefreshingDiffs: boolean;
  isBootstrappingChat: boolean;
  currentConfig?: Config;
  availableProviders: ProviderOption[];
  providerAuthMethodsById: Record<string, ProviderAuthMethod[]>;
  configuredProviders: ProviderOption[];
  availableModels: ModelOption[];
  availableAgents: AgentOption[];
  chatPreferences: ChatPreferences;
  updateChatPreferences: (patch: Partial<ChatPreferences>) => void;
  conversation: ConversationState;
  clearConversationFeedback: () => void;
  toggleConversationMode: () => Promise<void>;
  configureProvider: (providerId: string) => Promise<void>;
  completeAutomaticProviderOAuth: (providerId: string) => Promise<void>;
  setProviderAuth: (providerId: string, values: Record<string, string>) => Promise<void>;
  removeProvider: (providerId: string) => Promise<void>;
  startProviderOAuth: (providerId: string, methodIndex: number, inputs?: Record<string, string>) => Promise<{ url: string; instructions?: string; method: 'auto' | 'code' }>;
  completeProviderOAuth: (providerId: string, methodIndex: number, code: string) => Promise<void>;
  setAutoApprove: (enabled: boolean) => Promise<void>;
  sendingState: {
    sessionId?: string;
    active: boolean;
  };
  promptError?: { message: string; occurredAt: number; sessionId?: string };
  clearPromptError: () => void;
  connect: () => Promise<void>;
  refreshSessions: (silent?: boolean) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  refreshCurrentSession: (silent?: boolean) => Promise<void>;
  refreshCurrentTodos: (silent?: boolean) => Promise<void>;
  ensureActiveSession: () => Promise<string | undefined>;
  createSession: (title?: string) => Promise<MobileSession>;
  deleteSession: (sessionId: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  restoreSession: (sessionId: string) => Promise<void>;
  refreshArchivedSessions: () => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  forkSession: (sessionId: string, messageId?: string) => Promise<MobileSession>;
  revertSession: (sessionId: string, messageId: string) => Promise<void>;
  unrevertSession: (sessionId: string) => Promise<void>;
  getSessionChildren: (sessionId: string) => Promise<MobileSession[]>;
  deleteSessionMessage: (sessionId: string, messageId: string) => Promise<void>;
  updateSessionTextPart: (sessionId: string, messageId: string, partId: string, text: string) => Promise<void>;
  deleteSessionPart: (sessionId: string, messageId: string, partId: string) => Promise<void>;
  initializeSession: (sessionId: string) => Promise<void>;
  runSessionShell: (sessionId: string, command: string) => Promise<void>;
  sendPrompt: (sessionId: string, prompt: string, attachments?: { uri: string; mime?: string; filename?: string }[]) => Promise<boolean>;
  abortSession: (sessionId: string) => Promise<void>;
  replyToPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  replyToQuestion: (requestId: string, answers: PendingQuestionAnswer[]) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
  commands: Command[];
  executeCommand: (sessionId: string, command: string, args: string) => Promise<void>;
  workspaceFiles: string[];
  workspaceFileStatuses: File[];
  selectedWorkspaceFile?: { path: string; content: FileContent };
  vcsInfo?: VcsInfo;
  searchWorkspaceFiles: (query: string) => Promise<void>;
  listWorkspaceDirectory: (path: string) => Promise<FileNode[]>;
  searchWorkspaceText: (pattern: string) => Promise<WorkspaceTextMatch[]>;
  searchWorkspaceSymbols: (query: string) => Promise<Symbol[]>;
  getWorkspaceVcsStatus: () => Promise<VcsFileStatus[]>;
  getWorkspaceVcsDiff: (mode: 'git' | 'branch') => Promise<VcsFileDiff[]>;
  getWorkspaceRawVcsDiff: () => Promise<string>;
  openWorkspaceFile: (path: string) => Promise<void>;
  saveWorkspaceFile: (path: string, expectedContent: string, content: string) => Promise<void>;
  updateProjectMetadata: (projectId: string, update: ProjectMetadataUpdate) => Promise<Project>;
  initializeProjectGit: () => Promise<Project>;
  worktrees: (string | Worktree)[];
  refreshWorktrees: () => Promise<void>;
  createWorktree: (name?: string, startCommand?: string) => Promise<void>;
  resetWorktree: (directory: string) => Promise<void>;
  removeWorktree: (directory: string) => Promise<void>;
  mcpStatuses: Record<string, McpStatus>;
  refreshMcpServers: () => Promise<void>;
  addMcpServer: (name: string, config: McpLocalConfig | McpRemoteConfig) => Promise<void>;
  connectMcpServer: (name: string) => Promise<void>;
  disconnectMcpServer: (name: string) => Promise<void>;
  setMcpServerEnabled: (name: string, enabled: boolean) => Promise<void>;
  startMcpOAuth: (name: string) => Promise<string>;
  completeMcpOAuth: (name: string, code: string) => Promise<void>;
  removeMcpOAuth: (name: string) => Promise<void>;
  loadOpenCodeInspection: (provider?: string, model?: string) => Promise<OpenCodeInspection>;
  reloadOpenCodeSkills: () => Promise<Skills>;
  reloadOpenCodeConfig: () => Promise<void>;
  terminals: Pty[];
  terminalShells: PtyShellsResponse;
  activeTerminalId?: string;
  terminalOutput: string;
  terminalConnection: 'idle' | 'connecting' | 'connected' | 'error';
  refreshTerminals: () => Promise<void>;
  createTerminal: (command?: string, title?: string) => Promise<Pty>;
  getTerminalDetail: (ptyId: string) => Promise<Pty>;
  resizeTerminal: (ptyId: string, rows: number, cols: number) => Promise<Pty>;
  openTerminal: (ptyId: string) => Promise<void>;
  sendTerminalInput: (input: string) => void;
  closeTerminal: (ptyId: string) => Promise<void>;
  diagnostics?: Diagnostics;
  refreshDiagnostics: () => Promise<void>;
  eventStreamStatus: 'idle' | 'connecting' | 'connected' | 'error';
};
