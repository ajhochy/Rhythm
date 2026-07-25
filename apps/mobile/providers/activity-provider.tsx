import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
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

import type { ToolScreenStateKind } from '@/components/tools/tool-screen-state';
import {
  listActivity,
  sanitizeActivityCache,
  type ActivityFilters,
  type ActivityItem,
  type ActivityPage,
  type ActivityTransport,
} from '@/providers/services/activity-service';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';

const ACTIVITY_CACHE_PREFIX = 'rhythm.agent-activity.read-cache.v1';

export type ActivityAvailability =
  | 'connected'
  | 'offline'
  | 'expired-auth'
  | 'forbidden';

interface ActivityContextValue {
  items: ActivityItem[];
  filters: ActivityFilters;
  loading: boolean;
  refreshing: boolean;
  offline: boolean;
  hasMore: boolean;
  error: string | null;
  errorState: Extract<
    ToolScreenStateKind,
    'expired-auth' | 'forbidden' | 'error'
  > | null;
  setFilters: (filters: ActivityFilters) => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

function cacheKey(scope: string): string {
  const safeScope = scope.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'signed-out';
  return `${ACTIVITY_CACHE_PREFIX}.${safeScope}`;
}

function safeMessage(reason: unknown): string {
  if (
    reason &&
    typeof reason === 'object' &&
    typeof (reason as { message?: unknown }).message === 'string'
  ) {
    return (reason as { message: string }).message;
  }
  return 'Could not load activity from your paired Mac.';
}

function errorState(
  reason: unknown,
): ActivityContextValue['errorState'] {
  const status =
    reason && typeof reason === 'object'
      ? Number((reason as { status?: unknown }).status)
      : 0;
  if (status === 401) return 'expired-auth';
  if (status === 403) return 'forbidden';
  return 'error';
}

export function ActivityProvider({
  availability,
  cacheScope,
  children,
  transport,
}: PropsWithChildren<{
  availability: ActivityAvailability;
  cacheScope: string;
  transport: ActivityTransport | null;
}>) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [filters, setFiltersState] = useState<ActivityFilters>({ limit: 30 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestErrorState, setRequestErrorState] =
    useState<ActivityContextValue['errorState']>(null);
  const itemsRef = useRef<ActivityItem[]>([]);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const connected = availability === 'connected' && transport !== null;
  const storageKey = cacheKey(cacheScope);

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    itemsRef.current = [];
    setItems([]);
    setNextCursor(null);
    setError(null);
    setRequestErrorState(null);
    setLoading(true);
    void AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (!raw) return;
        try {
          const cached = sanitizeActivityCache(JSON.parse(raw));
          itemsRef.current = cached;
          setItems(cached);
        } catch {
          itemsRef.current = [];
          setItems([]);
        }
      })
      .finally(() => {
        if (mountedRef.current && generation === generationRef.current) {
          setLoading(false);
        }
      });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [storageKey]);

  const requestPage = useCallback(
    async (cursor: string | undefined, append: boolean) => {
      if (!transport || availability !== 'connected') return;
      const generation = ++generationRef.current;
      if (append || itemsRef.current.length === 0) setLoading(true);
      else setRefreshing(true);
      setError(null);
      setRequestErrorState(null);
      try {
        const page: ActivityPage = await listActivity(transport, {
          ...filters,
          cursor,
        });
        if (!mountedRef.current || generation !== generationRef.current) return;
        const safePage = sanitizeActivityCache(page.items);
        const merged = append
          ? sanitizeActivityCache([...itemsRef.current, ...safePage])
          : safePage;
        itemsRef.current = merged;
        setItems(merged);
        setNextCursor(page.nextCursor);
        await AsyncStorage.setItem(storageKey, JSON.stringify(merged));
      } catch (reason) {
        if (!mountedRef.current || generation !== generationRef.current) return;
        setError(safeMessage(reason));
        setRequestErrorState(errorState(reason));
      } finally {
        if (mountedRef.current && generation === generationRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [availability, filters, storageKey, transport],
  );

  const refresh = useCallback(
    async () => requestPage(undefined, false),
    [requestPage],
  );
  const loadMore = useCallback(
    async () => {
      if (nextCursor && !loading) await requestPage(nextCursor, true);
    },
    [loading, nextCursor, requestPage],
  );
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, filtersKey, refresh]);

  const setFilters = useCallback((next: ActivityFilters) => {
    setFiltersState({ ...next, cursor: undefined, limit: next.limit ?? 30 });
    setNextCursor(null);
  }, []);

  const availabilityErrorState =
    availability === 'expired-auth'
      ? 'expired-auth'
      : availability === 'forbidden'
        ? 'forbidden'
        : null;
  const value = useMemo<ActivityContextValue>(
    () => ({
      items,
      filters,
      loading,
      refreshing,
      offline: !connected,
      hasMore: nextCursor !== null,
      error,
      errorState: availabilityErrorState ?? requestErrorState,
      setFilters,
      refresh,
      loadMore,
    }),
    [
      availabilityErrorState,
      connected,
      error,
      filters,
      items,
      loadMore,
      loading,
      nextCursor,
      refresh,
      refreshing,
      requestErrorState,
      setFilters,
    ],
  );

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

function e2eActivityTransport(baseUrl: string): ActivityTransport {
  return {
    async request<T>(
      path: string,
      init: Omit<RequestInit, 'headers'> & {
        headers?: Record<string, string>;
      },
    ): Promise<T> {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, init);
      if (!response.ok) {
        const error = new Error(
          `Activity request failed (${response.status})`,
        ) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      return (await response.json()) as T;
    },
  };
}

export function AppActivityProvider({ children }: PropsWithChildren) {
  const account = useRhythmAccount();
  const pairedHost = usePairedHost();
  const e2eServerUrl =
    Constants.expoConfig?.extra?.e2eMode === true &&
    typeof Constants.expoConfig?.extra?.e2eServerUrl === 'string'
      ? Constants.expoConfig.extra.e2eServerUrl
      : null;
  const transport = useMemo<ActivityTransport | null>(
    () =>
      pairedHost.client ??
      (e2eServerUrl ? e2eActivityTransport(e2eServerUrl) : null),
    [e2eServerUrl, pairedHost.client],
  );
  const availability: ActivityAvailability = e2eServerUrl
    ? 'connected'
    : account.state === 'expired'
      ? 'expired-auth'
      : pairedHost.state === 'accountMismatch'
        ? 'forbidden'
        : pairedHost.state === 'connected'
          ? 'connected'
          : 'offline';
  const cacheScope =
    account.user && pairedHost.host
      ? `${account.user.id}:${pairedHost.host.hostId}:${pairedHost.host.deviceId}`
      : e2eServerUrl
        ? 'e2e-user'
        : 'signed-out';

  return (
    <ActivityProvider
      availability={availability}
      cacheScope={cacheScope}
      transport={transport}>
      {children}
    </ActivityProvider>
  );
}

export function useActivity(): ActivityContextValue {
  const value = useContext(ActivityContext);
  if (!value) {
    throw new Error('useActivity must be used within ActivityProvider');
  }
  return value;
}
