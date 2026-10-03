import AsyncStorage from '@react-native-async-storage/async-storage';
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

import { useOpencode } from '@/providers/opencode-provider';
import { pairedReachabilityAction } from '@/providers/opencode-provider-selectors';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';
import {
  assertOnlineMutation,
  sanitizeOfflineChatCache,
} from '@/providers/services/agent-chat-service';
import {
  archiveSession,
  deleteSession,
  forkSession,
  listSessionsAcrossProjects,
  restoreSession,
  updateSessionTitle,
  type ProjectSessionCatalogEntry,
} from '@/providers/services/session-service';
import {
  acknowledgeMobileGatewayWorkstreamUsage,
  cancelMobileGatewayWorkstream,
  createMobileGatewayWorkstream,
  inspectMobileGatewayWorkstreamEvidence,
  pauseMobileGatewayWorkstream,
  reconcileMobileGatewayWorkstreamUnknown,
  resumeMobileGatewayWorkstream,
  reviseMobileGatewayWorkstream,
  runMobileGatewayWorkstream,
  listMobileGatewayWorkstreams,
  verifyMobileGatewayWorkstreamCriteria,
  waiveMobileGatewayWorkstreamCriteria,
  waiveMobileGatewayWorkstreamCriterion,
  type MobileWorkstream,
  type MobileWorkstreamCreate,
  type MobileWorkstreamPatch,
  type MobileWorkstreamRun,
  type MobileWorkstreamEvidence,
  type MobileWorkstreamStatus,
} from '@/providers/services/workstreams-service';
import type { ChatPreferences } from '@/providers/opencode-provider-types';

const OFFLINE_CHAT_CACHE_KEY = 'rhythm.agent-chat.read-cache.v1';

function chatCacheKey(scope: string): string {
  const safeScope =
    scope.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'signed-out';
  return `${OFFLINE_CHAT_CACHE_KEY}.${safeScope}`;
}

interface AgentChatContextValue {
  sessions: ProjectSessionCatalogEntry[];
  isOnline: boolean;
  isLoading: boolean;
  isOfflineCache: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createChat: (
    projectId: string,
    title?: string,
    preferences?: ChatPreferences,
  ) => Promise<ProjectSessionCatalogEntry>;
  renameChat: (
    projectId: string,
    sessionId: string,
    title: string,
  ) => Promise<void>;
  archiveChat: (projectId: string, sessionId: string) => Promise<void>;
  restoreChat: (projectId: string, sessionId: string) => Promise<void>;
  forkChat: (
    projectId: string,
    sessionId: string,
  ) => Promise<ProjectSessionCatalogEntry>;
  deleteChat: (projectId: string, sessionId: string) => Promise<void>;
  /** Durable coordinator state from the paired Mac; never synthesized offline. */
  workstreams: MobileWorkstreamStatus[];
  workstreamsProjectId: string | null;
  isLoadingWorkstreams: boolean;
  workstreamsError: string | null;
  refreshWorkstreams: (projectId: string) => Promise<void>;
  createWorkstream: (projectId: string, input: MobileWorkstreamCreate) => Promise<MobileWorkstream>;
  reviseWorkstream: (projectId: string, workstreamId: string, input: MobileWorkstreamPatch) => Promise<MobileWorkstream>;
  runWorkstream: (projectId: string, workstreamId: string, input: MobileWorkstreamRun) => Promise<MobileWorkstreamStatus>;
  pauseWorkstream: (projectId: string, workstreamId: string, expectedRevision: number) => Promise<MobileWorkstreamStatus>;
  resumeWorkstream: (projectId: string, workstreamId: string, expectedRevision: number) => Promise<MobileWorkstreamStatus>;
  cancelWorkstream: (projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string }) => Promise<MobileWorkstreamStatus>;
  acknowledgeWorkstreamUsage: (projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string; accept: boolean }) => Promise<MobileWorkstreamStatus>;
  reconcileWorkstreamUnknown: (projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string }) => Promise<MobileWorkstreamStatus>;
  waiveWorkstreamCriterion: (projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string; criterionId: string }) => Promise<MobileWorkstreamStatus>;
  waiveWorkstreamCriteria: (projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string; criterionIds: string[] }) => Promise<MobileWorkstreamStatus>;
  workstreamEvidence: Record<string, MobileWorkstreamEvidence>;
  inspectWorkstreamEvidence: (projectId: string, workstreamId: string, sourceId: string) => Promise<MobileWorkstreamEvidence>;
  verifyWorkstreamCriteria: (projectId: string, workstreamId: string, input: { expectedRevision: number; jobId: string; sourceId: string; criterionIds: string[] }) => Promise<MobileWorkstreamStatus>;
}

const AgentChatContext = createContext<AgentChatContextValue | null>(null);

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Could not load chats from your paired Mac.';
}

function safeWorkstreamError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Could not load workstreams from your paired Mac.';
}

function parseOfflineCache(raw: string | null): ProjectSessionCatalogEntry[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is ProjectSessionCatalogEntry =>
        Boolean(
          item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).id === 'string' &&
          (typeof (item as Record<string, unknown>).projectId === 'string' ||
            ((item as Record<string, unknown>).projectId === null &&
              typeof (item as Record<string, unknown>).routingProjectId ===
                'string')),
        ),
    );
  } catch {
    return [];
  }
}

export function AgentChatProvider({ children }: PropsWithChildren) {
  const opencode = useOpencode();
  const account = useRhythmAccount();
  const pairedHost = usePairedHost();
  const {
    activeProjectPath,
    buildScopedClient,
    connection,
    createSession,
    eventStreamStatus,
    projects,
    refreshCurrentSession,
  } = opencode;
  const [sessions, setSessions] = useState<ProjectSessionCatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOfflineCache, setIsOfflineCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workstreams, setWorkstreams] = useState<MobileWorkstreamStatus[]>([]);
  const [workstreamsProjectId, setWorkstreamsProjectId] = useState<string | null>(null);
  const [isLoadingWorkstreams, setIsLoadingWorkstreams] = useState(false);
  const [workstreamsError, setWorkstreamsError] = useState<string | null>(null);
  const [workstreamEvidence, setWorkstreamEvidence] = useState<Record<string, MobileWorkstreamEvidence>>({});
  const mountedRef = useRef(true);
  const refreshGenerationRef = useRef(0);
  const workstreamGenerationRef = useRef(0);
  const previousStreamStatusRef = useRef(eventStreamStatus);
  const lastSweepCompletedAtRef = useRef(0);
  const isOnline =
    connection.status === 'connected' &&
    (!pairedHost.host || pairedHost.state === 'connected');
  const storageKey = chatCacheKey(
    account.user && pairedHost.host
      ? `${account.user.id}:${pairedHost.host.hostId}:${pairedHost.host.deviceId}`
      : 'signed-out',
  );
  const projectPaths = useMemo(
    () => projects.map((project) => project.path),
    [projects],
  );
  const projectKey = projectPaths.join('\n');

  useEffect(() => {
    mountedRef.current = true;
    refreshGenerationRef.current += 1;
    // Stale-while-revalidate: only an account/host identity change may drop
    // the visible list. Connectivity flips and background sweeps must never
    // flash the list back to "no sessions yet" (#1287 list churn).
    setSessions([]);
    setIsOfflineCache(false);
    setError(null);
    workstreamGenerationRef.current += 1;
    setWorkstreams([]);
    setWorkstreamsProjectId(null);
    setIsLoadingWorkstreams(false);
    setWorkstreamsError(null);
    setWorkstreamEvidence({});
    setIsLoading(true);
    void AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!mountedRef.current) return;
        const cached = parseOfflineCache(raw);
        if (cached.length > 0) {
          setSessions((current) => (current.length > 0 ? current : cached));
          if (!isOnlineRef.current) setIsOfflineCache(true);
        }
      })
      .finally(() => {
        if (mountedRef.current) setIsLoading(false);
      });
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, [storageKey]);

  // Identity-stable refresh: the discovery sweep is expensive (owner-wide
  // pagination plus per-project batches), so its identity must not churn when
  // the active project scope flips during chat opens — that churn re-armed
  // the effects below and re-ran the sweep on every navigation (#1287).
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const usePairedCatalogRef = useRef(Boolean(pairedHost.host));
  usePairedCatalogRef.current = Boolean(pairedHost.host);
  const buildScopedClientRef = useRef(buildScopedClient);
  buildScopedClientRef.current = buildScopedClient;
  const projectPathsRef = useRef(projectPaths);
  projectPathsRef.current = projectPaths;
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;
  const pairedWorkstreamClientRef = useRef(pairedHost.client);
  pairedWorkstreamClientRef.current = pairedHost.client;

  const requireWorkstreamClient = useCallback(() => {
    const client = pairedWorkstreamClientRef.current;
    if (!client) {
      throw new Error('Workstreams require a connected paired Mac.');
    }
    return client;
  }, []);

  const commitWorkstreamStatus = useCallback((projectId: string, next: MobileWorkstreamStatus) => {
    setWorkstreamsProjectId(projectId);
    setWorkstreams((current) => {
      const existing = current.some((item) => item.workstream.id === next.workstream.id);
      return existing
        ? current.map((item) => item.workstream.id === next.workstream.id ? next : item)
        : [next, ...current];
    });
  }, []);

  // Workstream reads are user-initiated by the panel.  Unlike chat discovery,
  // this provider deliberately has no reachability/timer refresh that could
  // become a hidden status sweep or imply an engine wake.
  const refreshWorkstreams = useCallback(async (projectId: string) => {
    if (!isOnlineRef.current) {
      const offline = 'Workstreams are unavailable offline. Reconnect to your paired Mac and refresh.';
      setWorkstreamsError(offline);
      throw new Error(offline);
    }
    const generation = ++workstreamGenerationRef.current;
    setIsLoadingWorkstreams(true);
    setWorkstreamsError(null);
    try {
      const page = await listMobileGatewayWorkstreams(requireWorkstreamClient(), projectId);
      if (!mountedRef.current || generation !== workstreamGenerationRef.current) return;
      setWorkstreamsProjectId(projectId);
      setWorkstreams(page.items);
    } catch (reason) {
      if (mountedRef.current && generation === workstreamGenerationRef.current) {
        setWorkstreamsError(safeWorkstreamError(reason));
      }
      throw reason;
    } finally {
      if (mountedRef.current && generation === workstreamGenerationRef.current) {
        setIsLoadingWorkstreams(false);
      }
    }
  }, [requireWorkstreamClient]);

  const createWorkstream = useCallback(async (projectId: string, input: MobileWorkstreamCreate) => {
    assertOnlineMutation(isOnlineRef.current);
    return createMobileGatewayWorkstream(requireWorkstreamClient(), projectId, input);
  }, [requireWorkstreamClient]);

  const reviseWorkstream = useCallback(async (
    projectId: string,
    workstreamId: string,
    input: MobileWorkstreamPatch,
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    return reviseMobileGatewayWorkstream(requireWorkstreamClient(), projectId, workstreamId, input);
  }, [requireWorkstreamClient]);

  const runWorkstream = useCallback(async (
    projectId: string,
    workstreamId: string,
    input: MobileWorkstreamRun,
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await runMobileGatewayWorkstream(requireWorkstreamClient(), projectId, workstreamId, input);
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const pauseWorkstream = useCallback(async (
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await pauseMobileGatewayWorkstream(requireWorkstreamClient(), projectId, workstreamId, expectedRevision);
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const resumeWorkstream = useCallback(async (
    projectId: string,
    workstreamId: string,
    expectedRevision: number,
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await resumeMobileGatewayWorkstream(requireWorkstreamClient(), projectId, workstreamId, expectedRevision);
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const cancelWorkstream = useCallback(async (
    projectId: string,
    workstreamId: string,
    input: { expectedRevision: number; jobId: string },
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await cancelMobileGatewayWorkstream(requireWorkstreamClient(), projectId, workstreamId, input);
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const acknowledgeWorkstreamUsage = useCallback(async (
    projectId: string,
    workstreamId: string,
    input: { expectedRevision: number; jobId: string; accept: boolean },
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await acknowledgeMobileGatewayWorkstreamUsage(requireWorkstreamClient(), projectId, workstreamId, input);
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const reconcileWorkstreamUnknown = useCallback(async (
    projectId: string,
    workstreamId: string,
    input: { expectedRevision: number; jobId: string },
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await reconcileMobileGatewayWorkstreamUnknown(requireWorkstreamClient(), projectId, workstreamId, input);
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const waiveWorkstreamCriterion = useCallback(async (
    projectId: string,
    workstreamId: string,
    input: { expectedRevision: number; jobId: string; criterionId: string },
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await waiveMobileGatewayWorkstreamCriterion(requireWorkstreamClient(), projectId, workstreamId, input);
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const waiveWorkstreamCriteria = useCallback(async (
    projectId: string,
    workstreamId: string,
    input: { expectedRevision: number; jobId: string; criterionIds: string[] },
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await waiveMobileGatewayWorkstreamCriteria(
      requireWorkstreamClient(), projectId, workstreamId, input,
    );
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const inspectWorkstreamEvidence = useCallback(async (
    projectId: string,
    workstreamId: string,
    sourceId: string,
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const evidence = await inspectMobileGatewayWorkstreamEvidence(
      requireWorkstreamClient(), projectId, workstreamId, sourceId,
    );
    if (mountedRef.current) {
      setWorkstreamEvidence((current) => ({
        ...current,
        [`${workstreamId}:${sourceId}`]: evidence,
      }));
    }
    return evidence;
  }, [requireWorkstreamClient]);

  const verifyWorkstreamCriteria = useCallback(async (
    projectId: string,
    workstreamId: string,
    input: { expectedRevision: number; jobId: string; sourceId: string; criterionIds: string[] },
  ) => {
    assertOnlineMutation(isOnlineRef.current);
    const next = await verifyMobileGatewayWorkstreamCriteria(
      requireWorkstreamClient(), projectId, workstreamId, input,
    );
    commitWorkstreamStatus(projectId, next);
    return next;
  }, [commitWorkstreamStatus, requireWorkstreamClient]);

  const refresh = useCallback(async () => {
    if (!isOnlineRef.current) {
      setIsOfflineCache(true);
      return;
    }
    const generation = ++refreshGenerationRef.current;
    const commitKey = storageKeyRef.current;
    // Keep showing the previous list while revalidating; only an empty list
    // warrants a visible loading state.
    setSessions((current) => {
      if (current.length === 0) setIsLoading(true);
      return current;
    });
    setError(null);
    try {
      const next = await listSessionsAcrossProjects(
        (projectId) => buildScopedClientRef.current(projectId),
        projectPathsRef.current,
        {
          skipProjectScopedSweep: usePairedCatalogRef.current,
          onProgress(progress) {
            if (
              !mountedRef.current ||
              generation !== refreshGenerationRef.current
            ) {
              return;
            }
            const safe = sanitizeOfflineChatCache(progress);
            // Progressive results may momentarily contain fewer chats than
            // the rendered list; never shrink mid-sweep.
            setSessions((current) =>
              safe.length >= current.length ? safe : current);
            setIsOfflineCache(false);
            if (safe.length > 0) setIsLoading(false);
          },
        },
      );
      if (!mountedRef.current || generation !== refreshGenerationRef.current) {
        return;
      }
      const safe = sanitizeOfflineChatCache(next);
      setSessions(safe);
      setIsOfflineCache(false);
      lastSweepCompletedAtRef.current = Date.now();
      await AsyncStorage.setItem(
        commitKey,
        JSON.stringify(safe),
      );
    } catch (reason) {
      if (!mountedRef.current || generation !== refreshGenerationRef.current) {
        return;
      }
      setError(safeError(reason));
      const cached = parseOfflineCache(
        await AsyncStorage.getItem(commitKey),
      );
      if (cached.length > 0) {
        setSessions((current) => (current.length > 0 ? current : cached));
        setIsOfflineCache(true);
      }
    } finally {
      if (mountedRef.current && generation === refreshGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Reachability transitions: losing the paired Mac must surface the offline
  // banner immediately, and regaining it must revalidate without waiting out
  // the sweep throttle.
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    const action = pairedReachabilityAction(wasOnline, isOnline);
    if (action === 'mark-offline') {
      setIsOfflineCache(true);
      return;
    }
    if (action === 'refresh') {
      lastSweepCompletedAtRef.current = 0;
      void refresh();
    }
  }, [isOnline, refresh]);

  useEffect(() => {
    if (!isOnline || projectPaths.length === 0) return;
    // Scope flips during chat opens reorder projectPaths without changing
    // membership; only a real membership change warrants a fresh sweep.
    if (
      lastSweepCompletedAtRef.current > 0 &&
      Date.now() - lastSweepCompletedAtRef.current < 15_000
    ) {
      return;
    }
    void refresh();
  }, [isOnline, projectKey, projectPaths.length, refresh]);

  useEffect(() => {
    const previous = previousStreamStatusRef.current;
    previousStreamStatusRef.current = eventStreamStatus;
    if (
      eventStreamStatus === 'connected' &&
      previous !== 'connected'
    ) {
      // Stream restarts are routine during scope switches; a full discovery
      // sweep per restart saturated the gateway. Sweep only when the last
      // completed sweep is stale.
      if (Date.now() - lastSweepCompletedAtRef.current < 15_000) {
        void refreshCurrentSession(true).catch(() => undefined);
        return;
      }
      void Promise.all([
        refresh(),
        refreshCurrentSession(true),
      ]).catch(() => undefined);
    }
  }, [
    eventStreamStatus,
    refreshCurrentSession,
    refresh,
  ]);

  const scopedClient = useCallback(
    (projectId: string) => buildScopedClient(projectId),
    [buildScopedClient],
  );

  const afterMutation = useCallback(async (projectId: string) => {
    await refresh();
    if (projectId === activeProjectPath) {
      await refreshCurrentSession(true);
    }
  }, [activeProjectPath, refresh, refreshCurrentSession]);

  const createChat = useCallback(async (
    projectId: string,
    title?: string,
    preferences?: ChatPreferences,
  ) => {
    assertOnlineMutation(isOnline);
    const response = await createSession(title, {
      projectId,
      preferences,
    });
    const created = {
      ...(response as unknown as Record<string, unknown>),
      id: response.id,
      projectId,
      status: 'idle',
    } as ProjectSessionCatalogEntry;
    setSessions((current) => [
      created,
      ...current.filter((session) => session.id !== created.id),
    ]);
    void afterMutation(projectId).catch((reason) => {
      if (mountedRef.current) setError(safeError(reason));
    });
    return created;
  }, [afterMutation, createSession, isOnline]);

  const renameChat = useCallback(async (
    projectId: string,
    sessionId: string,
    title: string,
  ) => {
    assertOnlineMutation(isOnline);
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Enter a chat title.');
    await updateSessionTitle(scopedClient(projectId), sessionId, trimmed);
    await afterMutation(projectId);
  }, [afterMutation, isOnline, scopedClient]);

  const archiveChat = useCallback(async (
    projectId: string,
    sessionId: string,
  ) => {
    assertOnlineMutation(isOnline);
    await archiveSession(scopedClient(projectId), sessionId);
    await afterMutation(projectId);
  }, [afterMutation, isOnline, scopedClient]);

  const restoreChat = useCallback(async (
    projectId: string,
    sessionId: string,
  ) => {
    assertOnlineMutation(isOnline);
    await restoreSession(scopedClient(projectId), sessionId);
    await afterMutation(projectId);
  }, [afterMutation, isOnline, scopedClient]);

  const forkChat = useCallback(async (
    projectId: string,
    sessionId: string,
  ) => {
    assertOnlineMutation(isOnline);
    const forked = await forkSession(scopedClient(projectId), sessionId);
    if (!forked) throw new Error('The Mac did not return the forked chat.');
    await afterMutation(projectId);
    return {
      ...(forked as unknown as Record<string, unknown>),
      id: forked.id,
      projectId,
      status: 'idle',
    };
  }, [afterMutation, isOnline, scopedClient]);

  const deleteChat = useCallback(async (
    projectId: string,
    sessionId: string,
  ) => {
    assertOnlineMutation(isOnline);
    await deleteSession(scopedClient(projectId), sessionId);
    await afterMutation(projectId);
  }, [afterMutation, isOnline, scopedClient]);

  const value = useMemo<AgentChatContextValue>(() => ({
    sessions,
    isOnline,
    isLoading,
    isOfflineCache,
    error,
    refresh,
    createChat,
    renameChat,
    archiveChat,
    restoreChat,
    forkChat,
    deleteChat,
    workstreams,
    workstreamsProjectId,
    isLoadingWorkstreams,
    workstreamsError,
    refreshWorkstreams,
    createWorkstream,
    reviseWorkstream,
    runWorkstream,
    pauseWorkstream,
    resumeWorkstream,
    cancelWorkstream,
    acknowledgeWorkstreamUsage,
    reconcileWorkstreamUnknown,
    waiveWorkstreamCriterion,
    waiveWorkstreamCriteria,
    workstreamEvidence,
    inspectWorkstreamEvidence,
    verifyWorkstreamCriteria,
  }), [
    acknowledgeWorkstreamUsage,
    archiveChat,
    cancelWorkstream,
    createChat,
    createWorkstream,
    deleteChat,
    error,
    forkChat,
    isLoading,
    isLoadingWorkstreams,
    isOfflineCache,
    isOnline,
    pauseWorkstream,
    refresh,
    refreshWorkstreams,
    reconcileWorkstreamUnknown,
    renameChat,
    resumeWorkstream,
    reviseWorkstream,
    restoreChat,
    runWorkstream,
    sessions,
    workstreams,
    workstreamEvidence,
    workstreamsError,
    workstreamsProjectId,
    waiveWorkstreamCriterion,
    waiveWorkstreamCriteria,
    inspectWorkstreamEvidence,
    verifyWorkstreamCriteria,
  ]);

  return (
    <AgentChatContext.Provider value={value}>
      {children}
    </AgentChatContext.Provider>
  );
}

export function useAgentChat(): AgentChatContextValue {
  const value = useContext(AgentChatContext);
  if (!value) {
    throw new Error('useAgentChat must be used within AgentChatProvider');
  }
  return value;
}
