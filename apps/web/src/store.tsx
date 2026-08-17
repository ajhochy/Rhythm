import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FIXED_NOW, seedDiff, seedFiles, seedProfiles, seedSessions, seedTodos } from './fixtures';
import { useGateway } from './gateway/context';
import type { GatewayMode } from './gateway';
import { mapPart, SessionGatewayError, type ProfileMutation, type SessionSocket, type SessionWireEvent } from './gateway/sessions';
import type { DomainNotification } from './gateway/notifications';
import { isSessionOffline } from './sessionState';
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
  name: string;
  cwd: string;
  profileId: string;
  isolateWorktree: boolean;
  worktreeName?: string;
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
  sessions: Session[]; profiles: Profile[]; todos: TodoItem[]; files: FixtureFile[]; diff: string;
  selectedId: string; selected: Session; scope: SessionScope; theme: Theme; inspectorTab: InspectorTab; demo: DemoState;
  toast: string; connectionMessage: string; runMessage: string; activeFile: string; terminalOutput: string[]; loading: boolean;
  unreadThreads: number; setUnreadThreads(count: number): void;
  selectSession(id: string): void; setScope(scope: SessionScope): void; setTheme(theme: Theme): void; setInspectorTab(tab: InspectorTab): void;
  setDemo(demo: DemoState): void; notify(message: string): void; createSession(input?: Partial<NewSessionInput>): string;
  updateSession(id: string, patch: Partial<Session>): void; archiveSession(id: string): void; unarchiveSession(id: string): void;
  deleteSession(id: string): void; resumeSession(id: string): void; cancelSession(id: string): void; forkSession(id: string): void;
  revertSession(id: string, messageId: string): void; unrevertSession(id: string): void; summarizeSession(id: string): void;
  loadOlder(id: string): void; replyPermission(reply: 'once' | 'always' | 'reject', reason?: string): void;
  answerQuestion(answer: string): void; rejectQuestion(): void; sendInput(input: string, attachments?: ComposerAttachment[]): void; reconnect(): void;
  runShell(command: string): void; setActiveFile(path: string): void; resetWorktree(): void; removeWorktree(): void;
  createProfile(): string; updateProfile(id: string, patch: Partial<Profile>): Promise<string>; duplicateProfile(id: string): string;
  deleteProfile(id: string): Promise<void>; setDefaultProfile(id: string): void; resetFixtures(): void;
  sessionGatewayMode: GatewayMode; liveSessionError: string | null;
  createLiveSession(input: LiveSessionInput): Promise<string>; deleteLiveSession(id: string): Promise<void>;
  refreshLiveSessions(): Promise<void>; selectLiveSession(id: string): Promise<void>;
  sendLiveInput(input: string, attachments?: ComposerAttachment[]): void;
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
  const live = gateway.mode === 'live';
  const [sessions, setSessions] = useState<Session[]>(() => live ? [] : readStoredFixtureSessions());
  const [profiles, setProfiles] = useState<Profile[]>(() => live ? [emptyLiveProfile()] : cloneProfiles());
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
  const [toast, setToast] = useState('Ready');
  const [connectionMessage, setConnectionMessage] = useState('Desktop connected');
  const [runMessage, setRunMessage] = useState('Sunday service handoff is working');
  const [activeFile, setActiveFile] = useState(seedFiles[0].path);
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['$ pwd', '/workspace/rhythm']);
  const [loading, setLoading] = useState(false);
  const [liveSessionError, setLiveSessionError] = useState<string | null>(null);
  const [resumeGone, setResumeGone] = useState<{ id: string; message: string } | null>(null);
  const [liveChildView, setLiveChildView] = useState<LiveChildView | null>(null);
  const [notifications, setNotifications] = useState<DomainNotification[]>([]);
  const [pushNotifications, setPushNotifications] = useState<PushNotification[]>([]);
  const pushSeenIdsRef = useRef(new Set<number>());
  const sessionSocketRef = useRef<SessionSocket | null>(null);
  const streamedPartsRef = useRef(new Set<string>());
  const stableEngineRef = useRef<Promise<void>>(Promise.resolve());
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  // Global Messages unread badge; seeded to match the Messages page fixtures (6 unread threads).
  const [unreadThreads, setUnreadThreads] = useState(6);

  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? emptyLiveSession();
  const notify = (message: string) => setToast(message);
  const setTheme = (next: Theme) => { setThemeState(next); persistTheme(next); };
  const selectSession = (id: string) => { setSelectedId(id); const session = sessions.find((item) => item.id === id); if (session) setRunMessage(`${session.name}: ${session.status}`); };

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
      ? current.map((session) => session.id === incoming.id ? incoming : session)
      : [incoming, ...current]);
  };

  const rememberLiveSelection = (id: string) => {
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
        return;
      }
      if (event.type === 'session.updated' && event.session && typeof event.session === 'object') {
        const wire = event.session as { id?: unknown; status?: unknown; working?: unknown };
        if (typeof wire.id === 'string') {
          setSessions((current) => current.map((session) => session.id === wire.id ? {
            ...session,
            status: wire.working === true || wire.status === 'working' ? 'working' : wire.status === 'idle' ? 'idle' : session.status,
          } : session));
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
        // c2d: message-level info (role/tokens/cost) refresh. Every renderable field it can
        // carry is already tracked via message.part.updated/message.part.delta above; this
        // frame still must not be silently dropped as an unhandled event type.
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
        setSessions((current) => current.map((session) => session.id === sessionId ? {
          ...session,
          livePermission: { permissionID, directory: directory ?? '', tool: tool ?? '', patterns: Array.isArray(patterns) ? patterns : [], title: title ?? '', createdAt: createdAt ?? new Date().toISOString() },
        } : session));
        return;
      }
      if (event.type === 'permission.replied' && event.sessionId && event.permissionID) {
        const { sessionId, permissionID } = event;
        setSessions((current) => current.map((session) => session.id === sessionId && session.livePermission?.permissionID === permissionID ? { ...session, livePermission: undefined } : session));
        return;
      }
      // c1d: translated question.asked/question.resolved — the full canonical question array,
      // never collapsed into a single options:string[] fixture prompt.
      if (event.type === 'question.asked' && event.sessionId && event.requestId && event.callId) {
        const { sessionId, requestId, callId, questions } = event;
        const parsedQuestions = (Array.isArray(questions) ? questions : []) as import('./types').LiveQuestionItem[];
        setSessions((current) => current.map((session) => session.id === sessionId ? {
          ...session,
          liveQuestion: { requestId, callId, questions: parsedQuestions },
        } : session));
        return;
      }
      if (event.type === 'question.resolved' && event.sessionId && event.requestId) {
        const { sessionId, requestId } = event;
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
      if (!id) return;
      sessionSocketRef.current?.send({ v: 1, type: 'session.subscribe', id });
      void sessionGateway.detail(id).then((detail) => { if (active) replaceLiveSession(detail); }).catch(onError);
      rehydratePendingPermission(id);
    };
    sessionSocketRef.current = sessionGateway.connect(onEvent, onError, onReconnect);
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
    rememberLiveSelection(id);
    setLiveSessionError(null);
    try { replaceLiveSession(await gateway.domains.sessions!.detail(id)); }
    catch { setLiveSessionError('Session could not be loaded'); }
  };

  const refreshLiveSessions = async () => {
    if (!live) return;
    setLiveSessionError(null);
    try {
      if (selectedId) replaceLiveSession(await gateway.domains.sessions!.detail(selectedId));
      else {
        const next = await gateway.domains.sessions!.list();
        setSessions(next);
      }
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
      if (selectedId === id) rememberLiveSelection(remaining[0]?.id ?? '');
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
    const selectedProfile = profiles.find((profile) => profile.id === selected.profileId);
    const modelOverride = selectedProfile?.modelProvider && selectedProfile.modelId
      ? { providerId: selectedProfile.modelProvider, modelId: selectedProfile.modelId }
      : undefined;
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
      ? { v: 1, type: 'session.input', id: selected.id, parts, ...(modelOverride ? { modelOverride } : {}) }
      : { v: 1, type: 'session.input', id: selected.id, data: trimmed, ...(modelOverride ? { modelOverride } : {}) });
    setRunMessage('Message delivered · agent is working');
    notify('Message sent');
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
  const archiveSession = (id: string) => { updateSession(id, { group: 'archived', status: 'closed' }); notify('Session archived'); };
  const unarchiveSession = (id: string) => { updateSession(id, { group: 'resumable', status: 'resumable' }); notify('Session restored'); };
  const deleteSession = (id: string) => { setSessions((current) => current.filter((session) => session.id !== id)); setSelectedId('session-sunday-handoff'); notify('Session permanently deleted'); };
  const resumeSession = (id: string) => {
    if (live) {
      setResumeGone(null);
      void gateway.domains.sessions!.resume(id).then((updated) => {
        replaceLiveSession(updated);
        setRunMessage(`${updated.name} resumed and is working`);
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
    try {
      const messages = await gateway.domains.sessions!.childMessages(selected.id, childId);
      setLiveChildView({ parentId: selected.id, childId, title, messages });
    } catch {
      setLiveSessionError('Child session could not be loaded');
    }
  };
  const closeLiveChildView = () => setLiveChildView(null);
  const forkSession = (id: string) => { const source = sessions.find((session) => session.id === id); if (!source) return; const nextId = createSession({ name: `${source.name} · fork`, cwd: source.cwd, branch: `${source.branch}-fork`, isolateWorktree: true }); updateSession(nextId, { messages: structuredClone(source.messages), profileId: source.profileId, model: source.model }); notify('Fork created in an isolated worktree'); };
  const revertSession = (id: string, messageId: string) => { updateSession(id, { revertedMessageId: messageId }); notify('History reverted after selected message'); };
  const unrevertSession = (id: string) => { updateSession(id, { revertedMessageId: undefined }); notify('Reverted history restored'); };
  const summarizeSession = (id: string) => { updateSession(id, { inputTokens: Math.max(0, selected.inputTokens - 4200) }); notify('Context compacted'); };
  const loadOlder = (id: string) => {
    if (live) {
      // c2f: canonical cursor pagination — exclusive `before`, follow `pageInfo.nextCursor`
      // until `hasMore` is false. apps/api_server/src/controllers/agent_sessions_controller.ts:2365-2393.
      const target = sessions.find((session) => session.id === id);
      const cursor = target?.transcriptCursor;
      if (!cursor) return;
      void gateway.domains.sessions!.pageOlder(id, cursor).then((page) => {
        setSessions((current) => current.map((session) => session.id === id ? {
          ...session,
          messages: [...page.messages, ...session.messages],
          transcriptCursor: page.pageInfo.nextCursor,
          transcriptHasMore: page.pageInfo.hasMore,
        } : session));
      }).catch(() => setLiveSessionError('Older messages could not be loaded'));
      return;
    }
    const older = { id: `msg-older-${id}`, role: 'system' as const, createdAt: '2026-08-12T13:58:00-07:00', blocks: [{ id: `b-older-${id}`, kind: 'markdown' as const, content: 'Earlier session context loaded from the fixture transcript.' }] };
    updateSession(id, { messages: [older, ...selected.messages] });
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

  const createProfile = () => { const id = `profile-created-${profiles.length + 1}`; const profile: Profile = { id, icon: 'NP', label: 'New profile', systemPrompt: '', managerAgent: false, allowedDelegates: [], selectable: true, enabled: true, modelProvider: 'openai', modelId: 'gpt-5.6', provider: 'OpenAI', model: 'gpt-5.6', defaultAccount: 'Rhythm workspace', mcps: [], skills: [], permissionRules: { shell: 'ask', files: 'ask', network: 'deny' }, managedSkills: false, isDefault: false, updatedAt: FIXED_NOW }; setProfiles((current) => [...current, profile]); notify(live ? 'New profile draft' : 'Profile created'); return id; };
  const profileMutation = (profile: Profile): ProfileMutation => ({
    label: profile.label, icon: profile.icon, enabled: profile.enabled,
    isAgent: profile.isAgent ?? true, isManager: profile.managerAgent,
    systemPrompt: profile.systemPrompt || null,
    allowedMcpsJson: profile.allowedMcpsJson ?? JSON.stringify(profile.mcps),
    allowedSkillsJson: profile.allowedSkillsJson ?? JSON.stringify(profile.skills),
    corePermissionsJson: profile.corePermissionsJson ?? JSON.stringify(profile.permissionRules),
    allowedDelegatesJson: profile.allowedDelegatesJson ?? JSON.stringify(profile.allowedDelegates),
    presetId: profile.presetId ?? null, sortOrder: profile.sortOrder ?? 0,
    modelProvider: profile.modelProvider, modelId: profile.modelId,
    ocAgent: profile.ocAgent ?? null, sessionSelectable: profile.selectable,
    modelTierHint: profile.modelTierHint ?? null,
    defaultAnthropicAccountId: profile.defaultAnthropicAccountId ?? null,
  });
  const updateProfile = async (id: string, patch: Partial<Profile>) => {
    const existing = profiles.find((profile) => profile.id === id);
    if (!existing) return id;
    const next = { ...existing, ...patch, updatedAt: FIXED_NOW };
    if (!live) {
      setProfiles((current) => current.map((profile) => profile.id === id ? next : profile));
      notify('Profile changes saved');
      return id;
    }
    const saved = id.startsWith('profile-created-')
      ? await gateway.domains.sessions!.createProfile(profileMutation(next))
      : await gateway.domains.sessions!.patchProfile(id, profileMutation(next));
    setProfiles((current) => current.map((profile) => profile.id === id ? saved : profile));
    notify('Profile changes saved');
    return saved.id;
  };
  const duplicateProfile = (id: string) => { const source = profiles.find((profile) => profile.id === id); if (!source) return id; const nextId = `${id}-copy-${profiles.length}`; setProfiles((current) => [...current, { ...structuredClone(source), id: nextId, label: `${source.label} copy`, isDefault: false, updatedAt: FIXED_NOW }]); notify('Profile duplicated'); return nextId; };
  const deleteProfile = async (id: string) => { if (profiles.find((profile) => profile.id === id)?.isDefault) { notify('Choose another default before deleting this profile'); return; } if (live && !id.startsWith('profile-created-')) await gateway.domains.sessions!.deleteProfile(id); setProfiles((current) => current.filter((profile) => profile.id !== id)); notify('Profile deleted'); };
  const setDefaultProfile = (id: string) => { setProfiles((current) => current.map((profile) => ({ ...profile, isDefault: profile.id === id }))); notify('Default profile updated'); };
  const resetFixtures = () => { setSessions(cloneSessions()); setProfiles(cloneProfiles()); setTodos(structuredClone(seedTodos)); setUnreadThreads(6); setSelectedId('session-sunday-handoff'); setScope('chats'); setInspectorTab('context'); setDemoState('running'); setConnectionMessage('Desktop connected'); setRunMessage('Sunday service handoff is working'); setActiveFile(seedFiles[0].path); setTerminalOutput(['$ pwd', '/workspace/rhythm']); setLoading(false); setToast('Workspace reset'); };

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
  const value = useMemo<FixtureContextValue>(() => ({ sessions, profiles, todos, files: seedFiles, diff: seedDiff, selectedId, selected, scope, theme, inspectorTab, demo, toast, connectionMessage, runMessage, activeFile, terminalOutput, loading, unreadThreads, setUnreadThreads, selectSession, setScope, setTheme, setInspectorTab, setDemo, notify, createSession, updateSession, archiveSession, unarchiveSession, deleteSession, resumeSession, cancelSession, forkSession, revertSession, unrevertSession, summarizeSession, loadOlder, replyPermission, answerQuestion, rejectQuestion, sendInput, reconnect, runShell, setActiveFile, resetWorktree, removeWorktree, createProfile, updateProfile, duplicateProfile, deleteProfile, setDefaultProfile, resetFixtures, sessionGatewayMode: gateway.mode, liveSessionError, createLiveSession, deleteLiveSession, refreshLiveSessions, selectLiveSession, sendLiveInput, resumeGone, dismissResumeGone, liveChildView, openLiveChildSession, closeLiveChildView, notifications, pushNotifications, notificationUnreadCount, markNotificationRead, markAllNotificationsRead, replyLivePermission, replyLiveQuestion, rejectLiveQuestion, updatePermissionMode }), [sessions, profiles, todos, selectedId, selected, scope, theme, inspectorTab, demo, toast, connectionMessage, runMessage, activeFile, terminalOutput, loading, unreadThreads, gateway.mode, liveSessionError, resumeGone, liveChildView, notifications, pushNotifications, notificationUnreadCount]);
  return <FixtureContext.Provider value={value}>{children}</FixtureContext.Provider>;
}

export function useFixtures() {
  const context = useContext(FixtureContext); if (!context) throw new Error('useFixtures must be used within FixtureProvider'); return context;
}
