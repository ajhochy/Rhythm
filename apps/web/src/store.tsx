import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { FIXED_NOW, seedDiff, seedFiles, seedProfiles, seedSessions, seedTodos } from './fixtures';
import { useGateway } from './gateway/context';
import type { GatewayMode } from './gateway';
import { mapPart, reconcileMessageInfo, SessionGatewayError, toSessionViewModel, type ProfileMutation, type SessionSocket, type SessionWireEvent, type IdentityProfile, type ModelChoice, type AccountChoice, type SessionSettings, type TurnOverride } from './gateway/sessions';
import { useAuthUser } from './gateway/auth';
import type { DomainNotification } from './gateway/notifications';
import type { MessageThread } from './gateway/messages';
import { ApprovalGatewayError, type PendingApproval } from './gateway/approvals';
import { signApprovalDecision } from './security/humanApprovalSigner';
import { isSessionOffline } from './sessionState';
import { addPermission, addQuestion, clearPendingDecisions, rehydrateDecisions, removeDecision } from './pending-decisions';
import type { ComposerAttachment, DemoState, FixtureFile, InspectorTab, Profile, Session, SessionScope, Theme, TodoItem, TranscriptMessage } from './types';

// c4c: a live agent push notification — apps/api_server/src/controllers/notifications_agent_controller.ts:6-32.
// Kept in a separate bucket from `DomainNotification` rows: its `id` is a WS-broadcast integer from
// a different sequence, never a persisted notifications-table id, so the two must never be conflated.
export interface PushNotification { id: number; title: string; body: string }

interface NewSessionInput {
  name: string; cwd: string; branch: string; createBranch: boolean; isolateWorktree: boolean;
  taskId: string; worktreeName: string; stash: boolean; anthropicAccountId: string;
}

interface LiveSessionInput {
  taskId?: string;
  anthropicAccountId?: string;
  name: string;
  cwd: string;
  profileId: string;
  isolateWorktree: boolean;
  worktreeName?: string;
  // post-m1-phase-6 c3a: canonical branch fields — sent through verbatim to gateway.create().
  branch?: string;
  createBranch?: boolean;
  stash?: 'stash' | 'discard';
}

// c2j: a live child-session view is deliberately NOT a row in `sessions` — the child's
// SDK id must never be treated as a local session id. `parentId` is the parent's local id.
interface LiveChildView {
  parentId: string;
  childId: string;
  title: string;
  messages: TranscriptMessage[];
}

interface FixtureContextValue {
  sessions: Session[]; profiles: IdentityProfile[]; todos: TodoItem[]; files: FixtureFile[]; diff: string;
  models: ModelChoice[]; accounts: AccountChoice[]; catalogError: string;
  turnOverride: TurnOverride; stageTurnOverride(patch: TurnOverride): void;
  saveSessionSettings(id: string, input: SessionSettings): Promise<void>;
  selectedId: string; selected: Session; scope: SessionScope; theme: Theme; inspectorTab: InspectorTab; demo: DemoState;
  toast: { message: string; id: number }; connectionMessage: string; runMessage: string; activeFile: string; terminalOutput: string[]; loading: boolean;
  unreadThreads: number; setUnreadThreads(count: number): void;
  liveMessageThreads: MessageThread[]; setLiveMessageThreads: Dispatch<SetStateAction<MessageThread[]>>;
  liveMessagesLoading: boolean; liveMessagesError: string;
  refreshLiveMessageThreads(): Promise<void>;
  selectSession(id: string): void; setScope(scope: SessionScope): void; setTheme(theme: Theme): void; setInspectorTab(tab: InspectorTab): void;
  setDemo(demo: DemoState): void; notify(message: string): void; createSession(input?: Partial<NewSessionInput>): string;
  updateSession(id: string, patch: Partial<Session>): void; archiveSession(id: string): void; unarchiveSession(id: string): void;
  deleteSession(id: string): void; resumeSession(id: string): void; cancelSession(id: string): void; forkSession(id: string, messageId?: string): void;
  revertSession(id: string, messageId: string): Promise<boolean>; unrevertSession(id: string): Promise<boolean>; summarizeSession(id: string): Promise<boolean>;
  prepareLiveSession(id: string): Promise<boolean>; startFreshSession(id: string): Promise<boolean>; reconnectLiveSession(): Promise<void>;
  loadOlder(id: string): Promise<void>; replyPermission(reply: 'once' | 'always' | 'reject', reason?: string): void;
  answerQuestion(answer: string): void; rejectQuestion(): void; sendInput(input: string, attachments?: ComposerAttachment[]): void; reconnect(): void;
  runShell(command: string): void; setActiveFile(path: string): void; resetWorktree(): void; removeWorktree(): void;
  createProfile(): string; updateProfile(id: string, patch: Partial<IdentityProfile>): Promise<string>; duplicateProfile(id: string): string;
  deleteProfile(id: string): Promise<void>; setDefaultProfile(id: string): void; resetFixtures(): void;
  sessionGatewayMode: GatewayMode; liveSessionError: string | null;
  createLiveSession(input: LiveSessionInput): Promise<string>; deleteLiveSession(id: string): Promise<void>;
  refreshLiveSessions(): Promise<void>; selectLiveSession(id: string): Promise<void>;
  sendLiveInput(input: string, attachments?: ComposerAttachment[]): void;
  // post-m1-phase-5 c3g: a recognized live slash command travels as its own WS frame,
  // never folded into session.input as plain text.
  sendLiveCommand(command: string, args: string): void;
  // c3d: resume's honest 410 — the persisted sdkSessionId is gone server-side. Kept
  // separate from liveSessionError so it renders as an actionable alert, not a generic banner.
  resumeGone: { id: string; message: string } | null; dismissResumeGone(): void;
  // c2j: live child-session transcript, fetched by parent local id + child SDK id.
  liveChildView: LiveChildView | null;
  openLiveChildSession(childId: string, title: string): Promise<void>;
  closeLiveChildView(): void;
  // c4a-c4c: persisted recipient-scoped domain notifications + transient WS agent pushes.
  notifications: DomainNotification[];
  pushNotifications: PushNotification[];
  notificationUnreadCount: number;
  markNotificationRead(id: number): void;
  markAllNotificationsRead(): void;
  // post-m1-phase-5: live permission/question decisions and canonical permission-mode persistence.
  replyLivePermission(reply: 'once' | 'always' | 'reject', message?: string): Promise<void>;
  replyLiveQuestion(answers: string[][]): Promise<void>;
  rejectLiveQuestion(): Promise<void>;
  updatePermissionMode(mode: string): Promise<void>;
  // post-m1-phase-7 c4d: pending human-gated approvals surfaced as actionable cards in the
  // Notifications bell (same GET /agent-approvals?status=pending boundary Review Queue reads).
  pendingApprovals: PendingApproval[];
  decideApproval(id: string, status: 'approved' | 'rejected'): Promise<void>;
}

const FixtureContext = createContext<FixtureContextValue | null>(null);
const cloneSessions = () => structuredClone(seedSessions) as Session[];
const cloneProfiles = () => structuredClone(seedProfiles) as Profile[];
const THEME_STORAGE_KEY = 'rhythm-agents-theme';
const FIXTURE_SESSIONS_STORAGE_KEY = 'rhythm-agents-fixture-sessions';
const FIXTURE_SELECTED_SESSION_KEY = 'rhythm-agents-fixture-selected-session';
const LIVE_SELECTED_SESSION_KEY = 'rhythm-agents-live-selected-session';

const emptyLiveSession = (): Session => ({
  id: '', name: 'Live sessions', scope: 'chats', group: 'active', status: 'idle', connectionState: 'online', profileId: '',
  projectId: '', projectName: 'Live workspace', cwd: '', branch: 'main', dirtyCount: 0, isolateWorktree: false,
  model: 'Configured model', thinkingBudget: 'Medium', permissionMode: 'Default', fastMode: false,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), cost: 0, inputTokens: 0, outputTokens: 0,
  cachedTokens: 0, totalBudget: 0, childIds: [], messages: [], artifacts: [],
});

export const emptyLiveProfile = (): Profile => ({
  id: '', icon: 'AG', label: 'Loading profiles', systemPrompt: '', managerAgent: false, allowedDelegates: [],
  selectable: false, enabled: false, modelProvider: null, modelId: null, provider: 'Live session service', model: 'Configured model', defaultAccount: '',
  mcps: [], skills: [], permissionRules: {}, managedSkills: false, isDefault: false, updatedAt: new Date(0).toISOString(),
});

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Sandboxed Studio previews intentionally run without storage access.
  }
}

function readStoredFixtureSessions(): Session[] {
  try {
    const stored = window.localStorage.getItem(FIXTURE_SESSIONS_STORAGE_KEY);
    const sessions = stored ? JSON.parse(stored) : null;
    return Array.isArray(sessions) ? sessions as Session[] : cloneSessions();
  } catch {
    return cloneSessions();
  }
}

function persistFixtureSessions(sessions: Session[]) {
  try {
    window.localStorage.setItem(FIXTURE_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Sandboxed Studio previews intentionally run without storage access.
  }
}

// c4b: the mocked/real GET /notifications always returns unread rows regardless of a prior
// mark-read call (the repository simply excludes read_at IS NOT NULL rows going forward), but
// a page reload throws away all in-memory React state. Without a persisted "already marked
// read locally" set, a reload would re-show a row this tab already marked read moments ago.
const NOTIFICATIONS_READ_IDS_KEY = 'rhythm-agents-notifications-read-ids';

function readLocallyReadIds(): Set<number> {
  try {
    const stored = window.localStorage.getItem(NOTIFICATIONS_READ_IDS_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : []);
  } catch {
    return new Set();
  }
}

function persistLocallyReadIds(ids: Set<number>) {
  try {
    window.localStorage.setItem(NOTIFICATIONS_READ_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // Sandboxed Studio previews intentionally run without storage access.
  }
}

export function FixtureProvider({ children }: { children: React.ReactNode }) {
  const gateway = useGateway();
  const auth = useAuthUser();
  const accountId = auth?.user.id ?? null;
  const live = gateway.mode === 'live';
  const [sessions, setSessions] = useState<Session[]>(() => live ? [] : readStoredFixtureSessions());
  const [profileRows, setProfiles] = useState<IdentityProfile[]>(() => live ? [] : cloneProfiles());
  // Local to this signed-in account and renderer lifetime. The API has no default-profile preference.
  const [localDefault, setLocalDefault] = useState<{ accountId: number | null; profileId: string } | null>(null);
  const profiles = useMemo(() => live ? profileRows.map(profile => ({ ...profile, isDefault: localDefault?.accountId === accountId && localDefault?.profileId === profile.id })) : profileRows, [profileRows, live, localDefault, accountId]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const turnOverrides = useRef<Record<string, TurnOverride>>({});
  const [overrideVersion, setOverrideVersion] = useState(0);
  const stageTurnOverride = (patch: TurnOverride) => { const id = selectedIdRef.current; if (!id) return; turnOverrides.current[id] = { ...turnOverrides.current[id], ...patch }; setOverrideVersion(v => v + 1); };
  const settingsWrites = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    if (!live) return;
    let active = true;
    setModels([]); setAccounts([]); setCatalogError('');
    void gateway.domains.sessions?.models?.().then(rows => { if (active) setModels(rows); }).catch(() => { if (active) setCatalogError('Model catalog unavailable'); });
    void gateway.domains.sessions?.accounts?.().then(rows => { if (active) setAccounts(rows); }).catch(() => { if (active) setCatalogError(value => `${value} Account catalog unavailable`.trim()); });
    return () => { active = false; };
  }, [gateway, live]);
  const [todos, setTodos] = useState<TodoItem[]>(() => structuredClone(seedTodos));
  const [selectedId, setSelectedId] = useState(() => {
    if (!live) {
      // A fixture session created (or sent to) before reload must still be the one shown
      // after reload — the same "reload preserves selection" contract live mode already
      // gets from LIVE_SELECTED_SESSION_KEY, needed for c1b's created-session round trip.
      try { return window.localStorage.getItem(FIXTURE_SELECTED_SESSION_KEY) ?? 'session-sunday-handoff'; } catch { return 'session-sunday-handoff'; }
    }
    try { return window.localStorage.getItem(LIVE_SELECTED_SESSION_KEY) ?? ''; } catch { return ''; }
  });
  const [scope, setScope] = useState<SessionScope>('chats');
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('context');
  const [demo, setDemoState] = useState<DemoState>('running');
  const [toast, setToast] = useState({ message: 'Ready', id: 0 });
  const [connectionMessage, setConnectionMessage] = useState('Desktop connected');
  const [runMessage, setRunMessage] = useState('Sunday service handoff is working');
  const [activeFile, setActiveFile] = useState(seedFiles[0].path);
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['$ pwd', '/workspace/rhythm']);
  const [loading, setLoading] = useState(false);
  const [liveSessionError, setLiveSessionError] = useState<string | null>(null);
  const [resumeGone, setResumeGone] = useState<{ id: string; message: string } | null>(null);
  const [liveChildView, setLiveChildView] = useState<LiveChildView | null>(null);
  const childStack = useRef<LiveChildView[]>([]);
  const childViewRequestRef = useRef(0);
  const [notifications, setNotifications] = useState<DomainNotification[]>([]);
  const [pushNotifications, setPushNotifications] = useState<PushNotification[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const pushSeenIdsRef = useRef(new Set<number>());
  const sessionSocketRef = useRef<SessionSocket | null>(null);
  const streamedPartsRef = useRef(new Set<string>());
  const stableEngineRef = useRef<Promise<void>>(Promise.resolve());
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  const reconcileLiveSessionsRef = useRef<(() => Promise<void>) | null>(null);
  // Fixture mode starts from its six seeded unread threads. Live mode starts unknown/zero and is
  // hydrated only from GET /message-threads — never show fixture unread state in production.
  const [unreadThreads, setUnreadThreads] = useState(() => live ? 0 : 6);
  const [liveMessageThreads, setLiveMessageThreads] = useState<MessageThread[]>([]);
  const [liveMessagesLoading, setLiveMessagesLoading] = useState(live);
  const [liveMessagesError, setLiveMessagesError] = useState('');
  const liveMessagesRefreshRef = useRef<Promise<void> | null>(null);

  const selected = sessions.find((session) => session.id === selectedId) ?? (live ? emptyLiveSession() : sessions[0]) ?? emptyLiveSession();
  const pendingSessionRef = useRef(selected);
  pendingSessionRef.current = selected;
  useEffect(() => {
    clearPendingDecisions();
    return clearPendingDecisions;
  }, [gateway, accountId]);
  useEffect(() => {
    childViewRequestRef.current++;
    childStack.current = [];
    setLiveChildView(null);
    if (live && selected.id) void rehydrateDecisions(gateway, selected).catch(() => setLiveSessionError('Pending decisions could not be loaded'));
  }, [gateway, live, accountId, selected.id, selected.sdkSessionId, selected.cwd]);
  const notify = (message: string) => setToast((current) => ({ message, id: current.id + 1 }));
  const setTheme = (next: Theme) => { setThemeState(next); persistTheme(next); };
  const selectSession = (id: string) => { setSelectedId(id); const session = sessions.find((item) => item.id === id); if (session) setRunMessage(`${session.name}: ${session.status}`); };

  const refreshLiveMessageThreads = useCallback(() => {
    if (!live || !gateway.domains.messages) return Promise.resolve();
    if (liveMessagesRefreshRef.current) return liveMessagesRefreshRef.current;
    const request = gateway.domains.messages.threads()
      .then((threads) => {
        setLiveMessageThreads(threads);
        setUnreadThreads(threads.filter((thread) => thread.unreadCount > 0).length);
        setLiveMessagesError('');
      })
      .catch(() => { setLiveMessagesError('Messages service unavailable'); })
      .finally(() => {
        setLiveMessagesLoading(false);
        if (liveMessagesRefreshRef.current === request) liveMessagesRefreshRef.current = null;
      });
    liveMessagesRefreshRef.current = request;
    return request;
  }, [gateway.domains.messages, live]);

  useEffect(() => {
    if (live) setUnreadThreads(liveMessageThreads.filter((thread) => thread.unreadCount > 0).length);
  }, [live, liveMessageThreads]);

  useEffect(() => {
    if (!live || !gateway.domains.messages) return;
    void refreshLiveMessageThreads();
    const onFocus = () => { void refreshLiveMessageThreads(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void refreshLiveMessageThreads(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const refreshTimer = window.setInterval(() => { void refreshLiveMessageThreads(); }, 30_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(refreshTimer);
    };
  }, [gateway.domains.messages, live, refreshLiveMessageThreads]);

  useEffect(() => {
    if (!live) persistFixtureSessions(sessions);
  }, [live, sessions]);

  useEffect(() => {
    if (live) return;
    try { window.localStorage.setItem(FIXTURE_SELECTED_SESSION_KEY, selectedId); } catch {
      // Sandboxed Studio previews intentionally run without storage access.
    }
  }, [live, selectedId]);

  const replaceLiveSession = (incoming: Session) => {
    setSessions((current) => current.some((session) => session.id === incoming.id)
      ? current.map((session) => session.id === incoming.id ? {
        ...session, ...incoming,
        messages: incoming.messages.length ? incoming.messages : session.messages,
        artifacts: incoming.artifacts.length ? incoming.artifacts : session.artifacts,
        queuedDraft: session.queuedDraft, queuedAttachments: session.queuedAttachments, pendingAttachments: session.pendingAttachments,
        retry: session.retry, permission: session.permission, question: session.question,
        livePermission: session.livePermission, liveQuestion: session.liveQuestion, revertedMessageId: session.revertedMessageId,
      } : session)
      : [incoming, ...current]);
  };

  const saveSessionSettings = (id: string, input: SessionSettings): Promise<void> => {
    if (!id) return Promise.reject(new Error('Choose a session first'));
    const save = async () => {
      if (!live) return;
      const patch = gateway.domains.sessions?.patchSettings;
      if (!patch) throw new Error('Session settings unavailable');
      replaceLiveSession(await patch(id, input));
    };
    const pending = (settingsWrites.current.get(id) ?? Promise.resolve()).catch(() => {}).then(save);
    settingsWrites.current.set(id, pending);
    return pending.finally(() => { if (settingsWrites.current.get(id) === pending) settingsWrites.current.delete(id); });
  };

  const rememberLiveSelection = (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    try {
      if (id) window.localStorage.setItem(LIVE_SELECTED_SESSION_KEY, id);
      else window.localStorage.removeItem(LIVE_SELECTED_SESSION_KEY);
    } catch {
      // Live selection still works when storage is unavailable.
    }
  };

  useEffect(() => {
    if (!live) return;
    const sessionGateway = gateway.domains.sessions!;
    let active = true;
    stableEngineRef.current = new Promise((resolve) => window.setTimeout(resolve, 2_200))
      .then(() => gateway.health.engine())
      .then(() => undefined);
    const onError = () => { if (active) setLiveSessionError('Session service unavailable'); };
    const mergeMetadata = (existing: Session, incoming: Session): Session => ({
      ...existing, ...incoming,
      messages: incoming.messages.length ? incoming.messages : existing.messages,
      artifacts: incoming.artifacts.length ? incoming.artifacts : existing.artifacts,
      queuedDraft: existing.queuedDraft, queuedAttachments: existing.queuedAttachments, pendingAttachments: existing.pendingAttachments,
      retry: existing.retry, permission: existing.permission, question: existing.question,
      livePermission: existing.livePermission, liveQuestion: existing.liveQuestion, revertedMessageId: existing.revertedMessageId,
    });
    const reconcileMembership = async () => {
      const currentScope = scopeRef.current;
      const incoming = sessionGateway.listPage
        ? (await Promise.all([sessionGateway.listPage({ scope: currentScope }), sessionGateway.listPage({ scope: currentScope, archivedOnly: true })]))
          .flatMap((page) => [...page.ancestors, ...page.sessions])
        : await sessionGateway.list();
      if (!active) return;
      setSessions((current) => {
        const next = new Map(current.filter((session) => session.scope !== currentScope || session.id === selectedIdRef.current).map((session) => [session.id, session]));
        for (const session of incoming) {
          const existing = next.get(session.id) ?? current.find((item) => item.id === session.id);
          next.set(session.id, existing ? mergeMetadata(existing, session) : session);
        }
        return [...next.values()];
      });
      const id = selectedIdRef.current;
      if (!id) return;
      try { replaceLiveSession(await sessionGateway.detail(id)); }
      catch (error) {
        if (error instanceof SessionGatewayError && error.status === 404) {
          setSessions((current) => current.filter((session) => session.id !== id));
          rememberLiveSelection('');
        } else throw error;
      }
    };
    let reconcileInFlight: Promise<void> | null = null;
    const requestReconcile = () => reconcileInFlight ??= reconcileMembership().finally(() => { reconcileInFlight = null; });
    reconcileLiveSessionsRef.current = requestReconcile;
    const reconcileOnFocus = () => { void requestReconcile().catch(onError); };
    const reconcileOnVisibility = () => { if (document.visibilityState === 'visible') reconcileOnFocus(); };
    window.addEventListener('focus', reconcileOnFocus);
    document.addEventListener('visibilitychange', reconcileOnVisibility);
    const reconcileTimer = window.setInterval(reconcileOnFocus, 2_000);
    // c3c/general race fix: the initial mount kicks off list()+detail() to hydrate the
    // transcript, but a WS event (delta/status) for the same session can legitimately land
    // before that detail() resolves. Without this, the slower initial fetch would overwrite
    // the fresher live-driven state (e.g. a working turn's partial text) with the stale
    // snapshot it started from. Track which sessions a live event has already touched so the
    // initial hydration below can skip clobbering them.
    const liveTouched = new Set<string>();
    const onEvent = (event: SessionWireEvent) => {
      if (!active) return;
      if (event.type === 'session.removed' && event.id) {
        setSessions((current) => current.filter((session) => session.id !== event.id));
        if (selectedIdRef.current === event.id) rememberLiveSelection('');
        return;
      }
      if ((event.type === 'session.created' || event.type === 'session.updated') && event.session && typeof event.session === 'object') {
        const wire = event.session as Record<string, unknown>;
        if (typeof wire.id === 'string') {
          liveTouched.add(wire.id);
          setSessions((current) => {
            const existing = current.find((session) => session.id === wire.id);
            const incoming = toSessionViewModel({ ...existing, ...wire });
            if (!existing) return [incoming, ...current];
            return current.map((session) => session.id === wire.id ? mergeMetadata(session, incoming) : session);
          });
        }
        return;
      }
      if (event.type === 'message.part.delta' && event.id && event.messageId && event.partId && event.field === 'text' && typeof event.delta === 'string') {
        // c2b: accumulate every delta onto the same part instead of keeping only the first
        // fragment. The previous `streamedPartsRef` gate below dropped every delta after the
        // first for a given (session, message, part) triple, so partial output never grew.
        const { id: sessionId, messageId, partId, delta } = event;
        liveTouched.add(sessionId);
        setSessions((current) => current.map((session) => {
          if (session.id !== sessionId) return session;
          const existing = session.messages.find((message) => message.id === messageId);
          if (existing) {
            return { ...session, status: 'working', retry: undefined, messages: session.messages.map((message) => message.id === messageId ? {
              ...message,
              blocks: message.blocks.some((block) => block.id === partId)
                ? message.blocks.map((block) => block.id === partId ? { ...block, content: `${block.content}${delta}` } : block)
                : [...message.blocks, { id: partId, kind: 'markdown', content: delta }],
            } : message) };
          }
          return { ...session, status: 'working', retry: undefined, messages: [...session.messages, {
            id: messageId, role: 'assistant', createdAt: new Date().toISOString(),
            blocks: [{ id: partId, kind: 'markdown', content: delta }],
          }] };
        }));
        return;
      }
      if (event.type === 'message.part.updated' && event.id && event.messageId && event.partId && event.part && typeof event.part === 'object') {
        // c2d: a full part supersedes any delta-built placeholder and carries its real
        // canonical type (reasoning/tool/file/agent/...) via the shared `mapPart` mapper,
        // instead of the delta path's plain-markdown fragments.
        const { id: sessionId, messageId, partId, part } = event;
        liveTouched.add(sessionId);
        const block = mapPart(part as Record<string, unknown>, partId);
        setSessions((current) => current.map((session) => {
          if (session.id !== sessionId) return session;
          const existing = session.messages.find((message) => message.id === messageId);
          if (existing) {
            return { ...session, messages: session.messages.map((message) => message.id === messageId ? {
              ...message,
              blocks: message.blocks.some((item) => item.id === partId)
                ? message.blocks.map((item) => item.id === partId ? block : item)
                : [...message.blocks, block],
            } : message) };
          }
          return { ...session, messages: [...session.messages, { id: messageId, role: 'assistant', createdAt: new Date().toISOString(), blocks: [block] }] };
        }));
        return;
      }
      if (event.type === 'message.updated' && event.id) {
        const info = event.info && typeof event.info === 'object' ? event.info as Record<string, unknown> : {};
        if (typeof info.id !== 'string' || !info.id) return;
        liveTouched.add(event.id);
        setSessions(current => current.map(session => {
          if (session.id !== event.id) return session;
          const existing = session.messages.find(message => message.id === info.id);
          const message = reconcileMessageInfo(existing, info);
          return { ...session, messages: existing ? session.messages.map(item => item.id === message.id ? message : item) : [...session.messages, message] };
        }));
        return;
      }
      if (event.type === 'message.removed' && event.id && event.messageId) {
        liveTouched.add(event.id);
        setSessions(current => current.map(session => session.id === event.id ? { ...session, messages: session.messages.filter(message => message.id !== event.messageId) } : session));
        return;
      }
      if (event.type === 'error' && event.id) {
        liveTouched.add(event.id);
        setSessions(current => current.map(session => session.id === event.id ? { ...session, status: 'error', retry: undefined, statusMessage: typeof event.message === 'string' ? event.message : 'Session request failed' } : session));
        return;
      }
      if (event.type === 'session.status' && event.id) {
        liveTouched.add(event.id);
        // c3e: a transient provider-retry frame. It never carries a persisted session
        // status (busy/idle) and must not clobber `status` — only the retry banner state.
        if (event.status === 'retrying') {
          const attempt = typeof event.attempt === 'number' ? event.attempt : 0;
          const reason = typeof event.reason === 'string' ? event.reason : '';
          setSessions((current) => current.map((session) => session.id === event.id ? { ...session, retry: { attempt, reason } } : session));
          return;
        }
        const working = event.working === true;
        setSessions((current) => current.map((session) => session.id === event.id ? { ...session, status: working ? 'working' : 'idle', retry: undefined } : session));
        if (!working) {
          for (const key of streamedPartsRef.current) if (key.startsWith(`${event.id}:`)) streamedPartsRef.current.delete(key);
          void sessionGateway.detail(event.id).then((detail) => { if (active) replaceLiveSession(detail); }).catch(onError);
        }
      }
      if (event.type === 'agent-configs.changed') {
        void sessionGateway.profiles().then((next) => { if (active) setProfiles(next); }).catch(onError);
      }
      // post-m1-phase-5 c1a/c1c: translated permission.asked/permission.replied — sessionId here
      // is always the LOCAL session id, never the SDK id. A replied frame closes the matching
      // card (by permissionID) without ever sending another reply for it.
      if (event.type === 'permission.asked' && event.sessionId && event.permissionID) {
        const { sessionId, permissionID, directory, tool, patterns, title, createdAt } = event;
        addPermission(sessionId, { permissionID, directory: directory ?? '', tool: tool ?? '', patterns: Array.isArray(patterns) ? patterns : [], title: title ?? '', createdAt: createdAt ?? new Date().toISOString() });
        setSessions((current) => current.map((session) => session.id === sessionId ? {
          ...session,
          livePermission: { permissionID, directory: directory ?? '', tool: tool ?? '', patterns: Array.isArray(patterns) ? patterns : [], title: title ?? '', createdAt: createdAt ?? new Date().toISOString() },
        } : session));
        return;
      }
      if (event.type === 'permission.replied' && event.sessionId && event.permissionID) {
        const { sessionId, permissionID } = event;
        removeDecision(sessionId, 'permissions', permissionID);
        setSessions((current) => current.map((session) => session.id === sessionId && session.livePermission?.permissionID === permissionID ? { ...session, livePermission: undefined } : session));
        return;
      }
      // c1d: translated question.asked/question.resolved — the full canonical question array,
      // never collapsed into a single options:string[] fixture prompt.
      if (event.type === 'question.asked' && event.sessionId && event.requestId && event.callId) {
        const { sessionId, requestId, callId, questions } = event;
        const parsedQuestions = (Array.isArray(questions) ? questions : []) as import('./types').LiveQuestionItem[];
        addQuestion(sessionId, { requestId, callId, questions: parsedQuestions });
        setSessions((current) => current.map((session) => session.id === sessionId ? {
          ...session,
          liveQuestion: { requestId, callId, questions: parsedQuestions },
        } : session));
        return;
      }
      if (event.type === 'question.resolved' && event.sessionId && event.requestId) {
        const { sessionId, requestId } = event;
        removeDecision(sessionId, 'questions', requestId);
        setSessions((current) => current.map((session) => session.id === sessionId && session.liveQuestion?.requestId === requestId ? { ...session, liveQuestion: undefined } : session));
        return;
      }
      if (event.type === 'notification.push') {
        // c4c: the wire frame is {v:1,type:'notification.push',id,title,body} — `id` here is a
        // numeric WS-broadcast id, not the string session id the shared SessionWireEvent type
        // declares, so it is read through an unchecked cast rather than widening that field.
        const push = event as unknown as { id?: number; title?: string; body?: string };
        if (typeof push.id === 'number' && typeof push.title === 'string' && typeof push.body === 'string' && !pushSeenIdsRef.current.has(push.id)) {
          pushSeenIdsRef.current.add(push.id);
          const { id, title, body } = push as { id: number; title: string; body: string };
          setPushNotifications((current) => [{ id, title, body }, ...current]);
        }
      }
    };

    // post-m1-phase-5 c1c: rehydrate at most the FIRST pending permission for a session — the
    // renderer never invents a WS event to recover one lost to a reconnect gap.
    const rehydratePendingPermission = (id: string) => {
      void gateway.domains.permissions!.pending(id).then((pending) => {
        const first = pending[0];
        if (!active || !first) return;
        setSessions((current) => current.map((session) => session.id === id ? {
          ...session,
          livePermission: { permissionID: first.permissionID, directory: first.directory, tool: first.tool, patterns: first.patterns, title: first.title, createdAt: first.createdAt },
        } : session));
      }).catch(() => undefined);
    };

    // c3a: on every reconnect (never the first connect), resubscribe by local session id
    // and refetch its detail so the transcript rehydrates instead of showing stale content.
    const onReconnect = () => {
      if (!active) return;
      const id = selectedIdRef.current;
      if (id) { sessionSocketRef.current?.send({ v: 1, type: 'session.subscribe', id }); rehydratePendingPermission(id); }
      void requestReconcile().catch(onError);
    };
    sessionSocketRef.current = sessionGateway.connect(onEvent, onError, () => {
      onReconnect();
      void rehydrateDecisions(gateway, pendingSessionRef.current).catch(onError);
    });
    setLoading(true);
    setLiveSessionError(null);
    void Promise.all([sessionGateway.profiles(), sessionGateway.list()]).then(async ([nextProfiles, nextSessions]) => {
      if (!active) return;
      setProfiles(nextProfiles);
      // `liveTouched`: a WS event (delta/status/retry) can land before this initial list()/detail()
      // settles. Adopt the fetched snapshot (it already reflects any persisted delta content), but
      // keep `status`/`retry` from the live-driven copy — those are transient/derived fields this
      // static snapshot cannot independently supply, so overwriting them would revert a turn that's
      // already `working` (or has a retry banner) back to a stale idle/no-retry state.
      const keepLiveFields = (incoming: Session, existing: Session | undefined) =>
        existing && liveTouched.has(incoming.id) ? { ...incoming, status: existing.status, retry: existing.retry } : incoming;
      setSessions((current) => nextSessions.map((incoming) => keepLiveFields(incoming, current.find((session) => session.id === incoming.id))));
      const chosen = nextSessions.some((session) => session.id === selectedId) ? selectedId : nextSessions[0]?.id ?? '';
      rememberLiveSelection(chosen);
      if (chosen) {
        const detail = await sessionGateway.detail(chosen);
        if (active) setSessions((current) => current.map((session) => session.id === chosen ? keepLiveFields(detail, session) : session));
        rehydratePendingPermission(chosen);
      }
    }).catch(onError).finally(() => { if (active) setLoading(false); });

    return () => {
      active = false;
      sessionSocketRef.current?.close();
      sessionSocketRef.current = null;
      streamedPartsRef.current.clear();
      reconcileLiveSessionsRef.current = null;
      window.removeEventListener('focus', reconcileOnFocus);
      document.removeEventListener('visibilitychange', reconcileOnVisibility);
      window.clearInterval(reconcileTimer);
    };
  }, [gateway, live]);

  // c4a/c4b: hydrate the recipient-scoped unread list once on mount. Rows this tab already
  // marked read locally are filtered out even though the server response doesn't know that —
  // see NOTIFICATIONS_READ_IDS_KEY above.
  useEffect(() => {
    if (!live) return;
    let active = true;
    const readIds = readLocallyReadIds();
    void gateway.domains.notifications!.list()
      .then((rows) => { if (active) setNotifications(rows.filter((row) => !readIds.has(row.id))); })
      .catch(() => { if (active) notify('Notifications could not be loaded'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, live]);

  // c4d: hydrate the shared pending-approval boundary once on mount — same read Review Queue
  // (LiveReviewTool) uses, so an approval raised against any session shows up here too.
  // Array.isArray guards a harness/host that doesn't recognize the route and falls through to a
  // generic `{ok:true}` shape — ApprovalGateway.listPending() doesn't validate its own JSON parse,
  // so an un-array-shaped body must degrade to [] here rather than reach pendingApprovals.map(...).
  useEffect(() => {
    if (!live) return;
    let active = true;
    void gateway.domains.approvals!.listPending()
      .then((rows) => { if (active) setPendingApprovals(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (active) notify('Pending approvals could not be loaded'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, live]);

  // post-m1-p7-c4d: a real ECDSA P-256 signature over the server-issued decisionNonce/payloadDigest
  // (security/humanApprovalSigner.ts), never fabricated. See that module's doc comment for the one
  // remaining honest gap: this renderer's key/capability are self-generated, not yet synchronized
  // with a live server's HUMAN_APPROVAL_PUBLIC_KEY/HUMAN_APPROVAL_CAPABILITY_SHA256.
  const decideApproval = async (id: string, status: 'approved' | 'rejected') => {
    if (!live) return;
    const approval = pendingApprovals.find((item) => item.id === id);
    if (!approval) return;
    try {
      const material = await signApprovalDecision({
        approvalId: id,
        status,
        decisionNonce: approval.decisionNonce,
        payloadDigest: approval.payloadDigest,
      });
      await gateway.domains.approvals!.decide(id, status, material);
      setPendingApprovals((current) => current.filter((item) => item.id !== id));
      notify(`Approval ${status}`);
      // c4d: focus only the originating owned session, never a different one.
      if (approval.sessionId) await selectLiveSession(approval.sessionId);
    } catch (error) {
      notify(error instanceof ApprovalGatewayError ? error.message : 'Decision could not be sent');
    }
  };

  const markNotificationRead = (id: number) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
    const readIds = readLocallyReadIds();
    readIds.add(id);
    persistLocallyReadIds(readIds);
    if (!live) return;
    void gateway.domains.notifications!.markRead(id).catch(() => notify('Notification could not be marked read'));
  };

  const markAllNotificationsRead = () => {
    const readIds = readLocallyReadIds();
    for (const item of notifications) readIds.add(item.id);
    persistLocallyReadIds(readIds);
    setNotifications([]);
    if (!live) { notify('All notifications marked read'); return; }
    void gateway.domains.notifications!.markAllRead()
      .then(() => notify('All notifications marked read'))
      .catch(() => notify('Notifications could not be marked read'));
  };

  const selectLiveSession = async (id: string) => {
    if (!live) return;
    childViewRequestRef.current += 1;
    childStack.current = [];
    setLiveChildView(null);
    rememberLiveSelection(id);
    setLiveSessionError(null);
    try { replaceLiveSession(await gateway.domains.sessions!.detail(id)); }
    catch { setLiveSessionError('Session could not be loaded'); }
  };

  const refreshLiveSessions = async () => {
    if (!live) return;
    setLiveSessionError(null);
    try {
      if (reconcileLiveSessionsRef.current) await reconcileLiveSessionsRef.current();
      else if (selectedIdRef.current) replaceLiveSession(await gateway.domains.sessions!.detail(selectedIdRef.current));
    } catch { setLiveSessionError('Session could not be refreshed'); }
  };

  const createLiveSession = async (input: LiveSessionInput) => {
    if (!live) throw new Error('Live session creation is unavailable in fixture mode');
    setLiveSessionError(null);
    // Profile/auth changes bounce the supervised engine. The stability wait
    // starts when live mode mounts, so form entry overlaps it instead of
    // consuming the create request's response window.
    await stableEngineRef.current;
    const created = await gateway.domains.sessions!.create(input);
    replaceLiveSession(created);
    setScope('chats');
    rememberLiveSelection(created.id);
    setRunMessage(`${created.name} created`);
    notify(`${created.name} created`);
    return created.id;
  };

  const deleteLiveSession = async (id: string) => {
    if (!live) return;
    setLiveSessionError(null);
    await gateway.domains.sessions!.hardDelete(id);
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== id);
      if (selectedIdRef.current === id) rememberLiveSelection('');
      return remaining;
    });
    notify('Session permanently deleted');
  };

  const sendLiveInput = (input: string, attachments: ComposerAttachment[] = []) => {
    if (!live) return;
    const trimmed = input.trim();
    if (!selected.id || (!trimmed && attachments.length === 0)) return;
    const messageId = `local-user-${Date.now()}`;
    setSessions((current) => current.map((session) => session.id === selected.id ? {
      ...session,
      status: 'working',
      messages: [...session.messages, {
        id: messageId, role: 'user', createdAt: new Date().toISOString(),
        blocks: [{ id: `${messageId}-text`, kind: 'markdown', content: trimmed || 'Attached file context.' }],
        attachments: structuredClone(attachments),
      }],
      pendingAttachments: [],
    } : session));
    const override = turnOverrides.current[selected.id] ?? {};
    delete turnOverrides.current[selected.id];
    setOverrideVersion(v => v + 1);
    const turnProfile = profiles.find(profile => profile.id === override.profileId && profile.enabled && profile.selectable);
    const agent = turnProfile ? turnProfile.ocAgent || turnProfile.id : undefined;
    const modelOverride = override.modelOverride ?? (selected.providerId && selected.modelId
      ? { providerId: selected.providerId, modelId: selected.modelId }
      : undefined);
    // c2e: real attachments travel as canonical `parts` (resolved text content / file data:
    // URL), never dropped in favor of `data` alone — apps/api_server/src/services/ws_gateway.ts:287-350
    // accepts either `{data}` or `{parts:[{type:'text',text}, {type:'file',mime,filename,url}]}`.
    const parts: Array<Record<string, unknown>> = [];
    if (trimmed) parts.push({ type: 'text', text: trimmed });
    for (const attachment of attachments) {
      if (attachment.content !== undefined) parts.push({ type: 'text', text: attachment.content });
      else if (attachment.dataUrl || attachment.fileUrl) parts.push({ type: 'file', mime: attachment.mime, filename: attachment.filename, url: attachment.dataUrl ?? attachment.fileUrl });
    }
    // c3a (reconnect queueing) asserts the plain-text, no-attachment turn travels as
    // canonical `data` (not `parts`) — the same wire alternative the API already accepts.
    // Only route through `parts` when there is a real attachment to carry.
    sessionSocketRef.current?.send(attachments.length > 0
      ? { v: 1, type: 'session.input', id: selected.id, parts, ...(agent ? { agent } : {}), ...(modelOverride ? { modelOverride } : {}) }
      : { v: 1, type: 'session.input', id: selected.id, data: trimmed, ...(agent ? { agent } : {}), ...(modelOverride ? { modelOverride } : {}) });
    setRunMessage('Message delivered · agent is working');
    notify('Message sent');
  };

  // post-m1-phase-5 c3g: apps/api_server/src/services/ws_gateway.ts:202-260 dispatches
  // a `session.command` frame through opencodeClient.dispatchCommand, distinct from the
  // free-text `session.input` path above.
  const sendLiveCommand = (command: string, args: string) => {
    if (!live || !selected.id) return;
    sessionSocketRef.current?.send({ v: 1, type: 'session.command', id: selected.id, command, arguments: args });
    setRunMessage('Command delivered · agent is working');
    notify(`/${command} sent`);
  };

  const createSession = (input: Partial<NewSessionInput> = {}) => {
    const count = sessions.filter((session) => session.id.startsWith('session-created-')).length + 1;
    const id = `session-created-${count}`;
    const profile = profiles.find((item) => item.isDefault) ?? profiles[0];
    const session: Session = {
      id, name: input.name || `New chat ${count}`, scope: 'chats', group: 'active', status: 'idle', connectionState: 'online', profileId: profile.id,
      projectId: selected.projectId, projectName: selected.projectName, cwd: input.cwd || selected.cwd,
      branch: input.branch || selected.branch, dirtyCount: 0, isolateWorktree: input.isolateWorktree ?? false, account: input.anthropicAccountId || profile.defaultAccount,
      model: profile.model, thinkingBudget: 'Medium', permissionMode: 'Default', fastMode: false,
      createdAt: FIXED_NOW, updatedAt: FIXED_NOW, cost: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalBudget: 60000,
      childIds: [], messages: [], artifacts: [],
    };
    setSessions((current) => [session, ...current]); setScope('chats'); setSelectedId(id); setRunMessage(`${session.name} created`); notify(`${session.name} created`); return id;
  };

  const updateSession = (id: string, patch: Partial<Session>) => setSessions((current) => current.map((session) => session.id === id ? { ...session, ...patch, updatedAt: FIXED_NOW } : session));
  // ponytail: serialize lifecycle writes per session; independent sessions stay independent.
  const lifecycleWrites = useRef(new Map<string, Promise<boolean>>()).current;
  const liveLifecycle = (id: string, operation: () => Promise<void>, success: string) => {
    const pending = (lifecycleWrites.get(id) ?? Promise.resolve(true)).then(async () => {
      try { await operation(); notify(success); return true; }
      catch (error) { notify(error instanceof Error ? error.message : 'Session operation failed'); return false; }
    });
    lifecycleWrites.set(id, pending);
    void pending.finally(() => { if (lifecycleWrites.get(id) === pending) lifecycleWrites.delete(id); });
    return pending;
  };
  const readLifecycleSession = async (id: string, boundary?: { revertedMessageId?: string }) => {
    const detail = await gateway.domains.sessions!.detail(id);
    setSessions(current => current.some(session => session.id === id)
      ? current.map(session => session.id === id ? { ...session, ...detail, revertedMessageId: boundary ? boundary.revertedMessageId : session.revertedMessageId } : session)
      : [detail, ...current]);
  };
  const archiveSession = (id: string) => {
    if (live) { void liveLifecycle(id, async () => { await gateway.domains.sessions!.archive!(id, true); await readLifecycleSession(id); }, 'Session archived'); return; }
    updateSession(id, { group: 'archived', status: 'closed' }); notify('Session archived');
  };
  const unarchiveSession = (id: string) => {
    if (live) { void liveLifecycle(id, async () => { await gateway.domains.sessions!.archive!(id, false); await readLifecycleSession(id); }, 'Session restored'); return; }
    updateSession(id, { group: 'resumable', status: 'resumable' }); notify('Session restored');
  };
  const deleteSession = (id: string) => { setSessions((current) => current.filter((session) => session.id !== id)); setSelectedId('session-sunday-handoff'); notify('Session permanently deleted'); };
  const resumeSession = (id: string) => {
    if (live) {
      setResumeGone(null);
      void gateway.domains.sessions!.resume(id).then((updated) => {
        replaceLiveSession(updated);
        setRunMessage(`${updated.name} resumed · ${updated.status}`);
        notify('Session resumed');
      }).catch((error) => {
        // c3d: an honest 410 — the persisted sdkSessionId no longer exists on the engine.
        // Surface it as an actionable start-fresh state; never silently create/substitute one.
        if (error instanceof SessionGatewayError && error.status === 410) setResumeGone({ id, message: error.message });
        else setLiveSessionError('Session could not be resumed');
      });
      return;
    }
    updateSession(id, { group: 'active', status: 'working', completedAt: undefined, stuckSince: undefined, connectionState: 'online' }); setRunMessage('Session resumed and is working'); notify('Session resumed');
  };
  const cancelSession = (id: string) => {
    if (live) {
      void gateway.domains.sessions!.cancel(id).then(() => {
        setSessions((current) => current.map((session) => session.id === id ? { ...session, status: 'idle' } : session));
        setRunMessage('Session canceled safely'); notify('Session canceled');
      }).catch(() => setLiveSessionError('Session could not be canceled'));
      return;
    }
    updateSession(id, { group: 'resumable', status: 'resumable' }); setRunMessage('Session canceled safely'); notify('Session canceled');
  };
  const dismissResumeGone = () => setResumeGone(null);
  const openLiveChildSession = async (childId: string, title: string) => {
    if (!live || !selected.id) return;
    const persisted = sessions.find(session => session.id === childId || session.sdkSessionId === childId);
    if (persisted) { await selectLiveSession(persisted.id); return; }
    const request = ++childViewRequestRef.current;
    const pendingView = { parentId: selected.id, childId, title, messages: [] };
    childStack.current = [...childStack.current, pendingView];
    setLiveChildView(pendingView);
    try {
      const messages = await gateway.domains.sessions!.childMessages(selected.id, childId);
      if (request !== childViewRequestRef.current || selectedIdRef.current !== selected.id) return;
      const view = { parentId: selected.id, childId, title, messages };
      childStack.current = [...childStack.current.slice(0, -1), view];
      setLiveChildView(view);
    } catch {
      if (request === childViewRequestRef.current) setLiveSessionError('Child session could not be loaded');
    }
  };
  const closeLiveChildView = () => {
    childViewRequestRef.current++;
    childStack.current = childStack.current.slice(0, -1);
    setLiveChildView(childStack.current.at(-1) ?? null);
  };
  const forkSession = (id: string, messageId?: string) => {
    if (live) {
      if (!messageId) { notify('Choose a persisted message to fork'); return; }
      void liveLifecycle(id, async () => {
        const child = await gateway.domains.sessions!.fork!(id, messageId);
        await readLifecycleSession(child.id);
        if (selectedIdRef.current === id) { setScope('chats'); rememberLiveSelection(child.id); }
      }, 'Fork created');
      return;
    }
    const source = sessions.find((session) => session.id === id); if (!source) return; const nextId = createSession({ name: `${source.name} · fork`, cwd: source.cwd, branch: `${source.branch}-fork`, isolateWorktree: true }); updateSession(nextId, { messages: structuredClone(source.messages), profileId: source.profileId, model: source.model }); notify('Fork created in an isolated worktree');
  };
  const revertSession = async (id: string, messageId: string) => {
    if (live) return liveLifecycle(id, async () => {
      const result = await gateway.domains.sessions!.revert(id, messageId);
      if (!result) throw new Error('Engine did not confirm reverted history');
      await readLifecycleSession(id, result);
    }, 'History reverted after selected message');
    updateSession(id, { revertedMessageId: messageId }); notify('History reverted after selected message'); return true;
  };
  const unrevertSession = async (id: string) => {
    if (live) return liveLifecycle(id, async () => {
      const result = await gateway.domains.sessions!.unrevert(id);
      if (!result) throw new Error('Engine did not confirm restored history');
      await readLifecycleSession(id, result);
    }, 'Reverted history restored');
    updateSession(id, { revertedMessageId: undefined }); notify('Reverted history restored'); return true;
  };
  const summarizeSession = async (id: string) => {
    if (live) return liveLifecycle(id, async () => { await gateway.domains.sessions!.summarize!(id); await readLifecycleSession(id); }, 'Compaction request completed; session refreshed');
    updateSession(id, { inputTokens: Math.max(0, selected.inputTokens - 4200) }); notify('Context compacted'); return true;
  };
  const prepareLiveSession = (id: string) => liveLifecycle(id, async () => { await gateway.domains.sessions!.init!(id); await readLifecycleSession(id); }, 'Project initialization confirmed; session refreshed');
  const startFreshSession = (id: string) => liveLifecycle(id, async () => {
    const source = sessions.find(session => session.id === id);
    if (!source?.profileId || !source.cwd) throw new Error('Start fresh requires the original profile and working directory');
    await createLiveSession({ profileId: source.profileId, cwd: source.cwd, name: `${source.name} · fresh`, isolateWorktree: source.isolateWorktree });
    setResumeGone(null);
  }, 'Fresh session created');
  const reconnectLiveSession = async () => {
    setConnectionMessage('Reconciling session…');
    try {
      if (!reconcileLiveSessionsRef.current) throw new Error('Session service unavailable');
      await reconcileLiveSessionsRef.current();
      setLiveSessionError(null); setConnectionMessage('Session reconciled');
    } catch (error) {
      setLiveSessionError('Session service unavailable'); setConnectionMessage('Session service unavailable');
      throw error;
    }
  };
  const loadOlder = async (id: string) => {
    if (live) {
      // c2f: canonical cursor pagination — exclusive `before`, follow `pageInfo.nextCursor`
      // until `hasMore` is false. apps/api_server/src/controllers/agent_sessions_controller.ts:2365-2393.
      const target = sessions.find((session) => session.id === id);
      const cursor = target?.transcriptCursor;
      if (!cursor) return;
      await gateway.domains.sessions!.pageOlder(id, cursor).then((page) => {
        setSessions((current) => current.map((session) => session.id === id ? {
          ...session,
          messages: [...page.messages, ...session.messages],
          transcriptCursor: page.pageInfo.nextCursor,
          transcriptHasMore: page.pageInfo.hasMore,
        } : session));
      });
      return;
    }
    const older = { id: `msg-older-${id}`, role: 'system' as const, createdAt: '2026-08-12T13:58:00-07:00', blocks: [{ id: `b-older-${id}`, kind: 'markdown' as const, content: 'Earlier session context loaded from the fixture transcript.' }] };
    const target = sessions.find((session) => session.id === id);
    if (!target || target.messages.some((message) => message.id === older.id)) return;
    updateSession(id, { messages: [older, ...target.messages] });
    notify('Older messages loaded');
  };

  const replyPermission = (reply: 'once' | 'always' | 'reject', reason?: string) => {
    if (!selected.permission) return; updateSession(selected.id, { permission: { ...selected.permission, status: reply === 'reject' ? 'denied' : reply, reason }, status: reply === 'reject' ? 'resumable' : 'working' });
    setRunMessage(`Permission reply recorded: ${reply}`); notify(reply === 'reject' ? 'Permission denied' : reply === 'always' ? 'Permission always allowed for this rule' : 'Permission allowed once');
  };
  const answerQuestion = (answer: string) => { if (!selected.question) return; updateSession(selected.id, { question: { ...selected.question, answer, status: 'answered' }, status: 'working' }); setRunMessage('Agent question answered'); notify('Answer sent to the agent'); };
  const rejectQuestion = () => { if (!selected.question) return; updateSession(selected.id, { question: { ...selected.question, status: 'rejected' }, status: 'resumable' }); setRunMessage('Agent question rejected'); notify('Question rejected'); };

  // post-m1-phase-5 c1a/c1b: exactly one canonical reply per permissionID. The card unmounts
  // as soon as the reply lands, so a second click after success can never fire another POST.
  const replyLivePermission = async (reply: 'once' | 'always' | 'reject', message?: string) => {
    const sessionId = selected.id;
    const permissionID = selected.livePermission?.permissionID;
    if (!live || !permissionID) return;
    try {
      await gateway.domains.permissions!.reply(sessionId, permissionID, reply, message);
      setSessions((current) => current.map((session) => session.id === sessionId && session.livePermission?.permissionID === permissionID ? { ...session, livePermission: undefined } : session));
      notify(reply === 'reject' ? 'Permission denied' : reply === 'always' ? 'Permission always allowed for this rule' : 'Permission allowed once');
    } catch {
      setLiveSessionError('Permission reply could not be sent');
    }
  };
  // c1d: exactly one callId-scoped reply, sent as canonical answers:string[][].
  const replyLiveQuestion = async (answers: string[][]) => {
    const sessionId = selected.id;
    const callId = selected.liveQuestion?.callId;
    if (!live || !callId) return;
    try {
      await gateway.domains.permissions!.replyQuestion(sessionId, callId, answers);
      setSessions((current) => current.map((session) => session.id === sessionId && session.liveQuestion?.callId === callId ? { ...session, liveQuestion: undefined } : session));
      notify('Answer sent to the agent');
    } catch {
      setLiveSessionError('Question reply could not be sent');
    }
  };
  const rejectLiveQuestion = async () => {
    const sessionId = selected.id;
    const callId = selected.liveQuestion?.callId;
    if (!live || !callId) return;
    try {
      await gateway.domains.permissions!.rejectQuestion(sessionId, callId);
      setSessions((current) => current.map((session) => session.id === sessionId && session.liveQuestion?.callId === callId ? { ...session, liveQuestion: undefined } : session));
      notify('Question rejected');
    } catch {
      setLiveSessionError('Question rejection could not be sent');
    }
  };
  // c1e: the ONLY values ever sent are the canonical default|acceptEdits|plan|bypassPermissions.
  const updatePermissionMode = async (mode: string) => {
    if (!live) { updateSession(selected.id, { permissionMode: mode }); return; }
    const sessionId = selected.id;
    try {
      await gateway.domains.sessions!.updatePermissionMode(sessionId, mode);
      setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, permissionMode: mode } : session));
    } catch {
      setLiveSessionError('Permission mode could not be updated');
    }
  };
  const sendInput = (input: string, attachments: ComposerAttachment[] = []) => {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) { notify('Enter a message or attach a file before sending'); return; }
    if (isSessionOffline(selected)) {
      updateSession(selected.id, { queuedDraft: trimmed, queuedAttachments: structuredClone(attachments), pendingAttachments: [] });
      setConnectionMessage('Desktop offline · 1 draft queued locally'); notify('Draft queued locally. Reconnect to send.'); return;
    }
    const userMessage = {
      id: `msg-${selected.id}-${selected.messages.length + 1}`, role: 'user' as const, createdAt: FIXED_NOW,
      blocks: [{ id: `block-${selected.id}-${selected.messages.length + 1}`, kind: 'markdown' as const, content: trimmed || 'Attached file context.' }],
      attachments: structuredClone(attachments),
    };
    updateSession(selected.id, { messages: [...selected.messages, userMessage], pendingAttachments: [], status: 'working' }); setRunMessage('Message delivered · agent is working'); notify('Message sent');
  };
  const reconnect = () => {
    setConnectionMessage('Desktop connected');
    if (selected.queuedDraft || selected.queuedAttachments?.length) {
      const queuedMessage = { id: `msg-${selected.id}-queued`, role: 'user' as const, createdAt: FIXED_NOW, blocks: [{ id: `block-${selected.id}-queued`, kind: 'markdown' as const, content: selected.queuedDraft || 'Attached file context.' }], attachments: structuredClone(selected.queuedAttachments ?? []) };
      updateSession(selected.id, { status: 'working', connectionState: 'online', queuedDraft: undefined, queuedAttachments: undefined, messages: [...selected.messages, queuedMessage] });
      setRunMessage('Queued draft delivered · agent is working');
    }
    notify('Reconnected. Queued draft delivered.');
  };
  const runShell = (command: string) => { const results: Record<string, string> = { pwd: '/workspace/rhythm', 'git status --short': ' M services/2026-08-16/run-sheet.md', 'npm test': '26 tests discovered · browser verification required' }; setTerminalOutput((current) => [...current, `$ ${command}`, results[command] || `fixture: ${command} completed`]); notify('Fixture command completed'); };
  const resetWorktree = () => { updateSession(selected.id, { dirtyCount: 0 }); notify('Fixture worktree reset'); };
  const removeWorktree = () => { updateSession(selected.id, { isolateWorktree: false }); notify('Fixture worktree removed'); };

  const createProfile = () => { const id = `profile-created-${crypto.randomUUID()}`; const profile: Profile = live ? { ...emptyLiveProfile(), id, label: 'New profile', enabled: true, selectable: true, allowedMcpsJson: '{}', allowedSkillsJson: '[]', corePermissionsJson: '{}', allowedDelegatesJson: '[]' } : { id, icon: 'NP', label: 'New profile', systemPrompt: '', managerAgent: false, allowedDelegates: [], selectable: true, enabled: true, modelProvider: 'openai', modelId: 'gpt-5.6', provider: 'OpenAI', model: 'gpt-5.6', defaultAccount: 'Rhythm workspace', mcps: [], skills: [], permissionRules: { shell: 'ask', files: 'ask', network: 'deny' }, managedSkills: false, isDefault: false, updatedAt: FIXED_NOW }; setProfiles((current) => [...current, profile]); notify(live ? 'New profile draft' : 'Profile created'); return id; };
  const profileMutation = (profile: IdentityProfile): ProfileMutation => ({
    label: profile.label, icon: profile.icon, enabled: profile.enabled,
    isAgent: profile.isAgent ?? true, isManager: live ? profile.isManager === true : profile.managerAgent,
    systemPrompt: profile.systemPrompt || null,
    allowedMcpsJson: live ? profile.allowedMcpsJson ?? null : JSON.stringify(profile.mcps),
    allowedSkillsJson: live ? profile.allowedSkillsJson ?? null : JSON.stringify(profile.skills),
    corePermissionsJson: live ? profile.corePermissionsJson ?? null : JSON.stringify(profile.permissionRules),
    allowedDelegatesJson: live ? profile.allowedDelegatesJson ?? null : JSON.stringify(profile.allowedDelegates),
    autoApproveActions: profile.autoApproveActions ?? false,
    reasoningEffort: profile.reasoningEffort ?? null,
    presetId: profile.presetId ?? null, sortOrder: profile.sortOrder ?? 0,
    modelProvider: profile.modelProvider, modelId: profile.modelId,
    ocAgent: profile.ocAgent ?? null, sessionSelectable: profile.selectable,
    modelTierHint: profile.modelTierHint ?? null,
    defaultAnthropicAccountId: profile.defaultAnthropicAccountId ?? null,
  });
  const updateProfile = async (id: string, patch: Partial<IdentityProfile>) => {
    const existing = profiles.find((profile) => profile.id === id);
    if (!existing) return id;
    const next = { ...existing, ...patch, updatedAt: FIXED_NOW };
    if (!live) {
      setProfiles((current) => current.map((profile) => profile.id === id ? next : profile));
      notify('Profile changes saved');
      return id;
    }
    const mutation = profileMutation(next);
    const previous = profileMutation(existing);
    // PATCH only edited canonical fields: preset identity is protected even when unchanged.
    const changed = Object.fromEntries(Object.entries(mutation).filter(([key, value]) => value !== previous[key as keyof ProfileMutation]));
    const saved = id.startsWith('profile-created-')
      ? await gateway.domains.sessions!.createProfile(mutation)
      : await gateway.domains.sessions!.patchProfile(id, changed);
    const readback = (await gateway.domains.sessions!.profiles()).find(profile => profile.id === saved.id);
    if (!readback) throw new Error('Saved profile missing from readback');
    setProfiles((current) => current.map((profile) => profile.id === id ? readback : profile));
    notify('Profile changes saved');
    return saved.id;
  };
  const duplicateProfile = (id: string) => { const source = profiles.find((profile) => profile.id === id); if (!source) return id; const nextId = `profile-created-${crypto.randomUUID()}`; setProfiles((current) => [...current, { ...structuredClone(source), id: nextId, presetId: null, ocAgent: null, label: `${source.label} copy`, isDefault: false, updatedAt: FIXED_NOW }]); notify(live ? 'Duplicate profile draft — save to create' : 'Profile duplicated'); return nextId; };
  const deleteProfile = async (id: string) => { if (profiles.find((profile) => profile.id === id)?.isDefault) { notify('Choose another default before deleting this profile'); return; } if (live && !id.startsWith('profile-created-')) await gateway.domains.sessions!.deleteProfile(id); setProfiles((current) => current.filter((profile) => profile.id !== id)); notify('Profile deleted'); };
  const setDefaultProfile = (id: string) => { if (live) { if (id.startsWith('profile-created-')) { notify('Save this profile before choosing it as default'); return; } setLocalDefault({ accountId, profileId: id }); notify('Default profile updated locally for this account; resets on reload'); return; } setProfiles((current) => current.map((profile) => ({ ...profile, isDefault: profile.id === id }))); notify('Default profile updated'); };
  const resetFixtures = () => { setSessions(cloneSessions()); setProfiles(cloneProfiles()); setTodos(structuredClone(seedTodos)); setUnreadThreads(live ? 0 : 6); setSelectedId('session-sunday-handoff'); setScope('chats'); setInspectorTab('context'); setDemoState('running'); setConnectionMessage('Desktop connected'); setRunMessage('Sunday service handoff is working'); setActiveFile(seedFiles[0].path); setTerminalOutput(['$ pwd', '/workspace/rhythm']); setLoading(false); notify('Workspace reset'); };

  const setDemo = (next: DemoState) => {
    setDemoState(next); setLoading(next === 'loading');
    const targets: Partial<Record<DemoState, string>> = { running: 'session-sunday-handoff', permission: 'session-permission', question: 'session-question', offline: 'session-offline', completed: 'session-completed', resumable: 'session-completed' };
    const target = targets[next]; if (target) { setSelectedId(target); const session = sessions.find((item) => item.id === target); if (session) setScope(session.scope); }
    if (next === 'offline') setConnectionMessage('Desktop offline · local draft queue available');
    else if (next === 'error') setConnectionMessage('Session service unavailable');
    else if (next === 'connecting') setConnectionMessage('Connecting to desktop…');
    else if (next === 'retrying') setConnectionMessage('Retrying desktop connection…');
    else setConnectionMessage('Desktop connected');
    notify(`Demo state: ${next}`);
  };

  const notificationUnreadCount = notifications.length + pushNotifications.length;
  const value = useMemo<FixtureContextValue>(() => ({ prepareLiveSession, startFreshSession, reconnectLiveSession, models, accounts, catalogError, turnOverride: turnOverrides.current[selectedId] ?? {}, stageTurnOverride, saveSessionSettings, sessions, profiles, todos, files: seedFiles, diff: seedDiff, selectedId, selected, scope, theme, inspectorTab, demo, toast, connectionMessage, runMessage, activeFile, terminalOutput, loading, unreadThreads, setUnreadThreads, liveMessageThreads, setLiveMessageThreads, liveMessagesLoading, liveMessagesError, refreshLiveMessageThreads, selectSession, setScope, setTheme, setInspectorTab, setDemo, notify, createSession, updateSession, archiveSession, unarchiveSession, deleteSession, resumeSession, cancelSession, forkSession, revertSession, unrevertSession, summarizeSession, loadOlder, replyPermission, answerQuestion, rejectQuestion, sendInput, reconnect, runShell, setActiveFile, resetWorktree, removeWorktree, createProfile, updateProfile, duplicateProfile, deleteProfile, setDefaultProfile, resetFixtures, sessionGatewayMode: gateway.mode, liveSessionError, createLiveSession, deleteLiveSession, refreshLiveSessions, selectLiveSession, sendLiveInput, sendLiveCommand, resumeGone, dismissResumeGone, liveChildView, openLiveChildSession, closeLiveChildView, notifications, pushNotifications, notificationUnreadCount, markNotificationRead, markAllNotificationsRead, replyLivePermission, replyLiveQuestion, rejectLiveQuestion, updatePermissionMode, pendingApprovals, decideApproval }), [models, accounts, catalogError, overrideVersion, sessions, profiles, todos, selectedId, selected, scope, theme, inspectorTab, demo, toast, connectionMessage, runMessage, activeFile, terminalOutput, loading, unreadThreads, liveMessageThreads, liveMessagesLoading, liveMessagesError, refreshLiveMessageThreads, gateway.mode, liveSessionError, resumeGone, liveChildView, notifications, pushNotifications, notificationUnreadCount, pendingApprovals]);
  return <FixtureContext.Provider value={value}>{children}</FixtureContext.Provider>;
}

export function useFixtures() {
  const context = useContext(FixtureContext); if (!context) throw new Error('useFixtures must be used within FixtureProvider'); return context;
}
