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
}

const AgentChatContext = createContext<AgentChatContextValue | null>(null);

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Could not load chats from your paired Mac.';
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
  const mountedRef = useRef(true);
  const refreshGenerationRef = useRef(0);
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
    await afterMutation(projectId);
    return {
      ...(response as unknown as Record<string, unknown>),
      id: response.id,
      projectId,
      status: 'idle',
    };
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
  }), [
    archiveChat,
    createChat,
    deleteChat,
    error,
    forkChat,
    isLoading,
    isOfflineCache,
    isOnline,
    refresh,
    renameChat,
    restoreChat,
    sessions,
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
