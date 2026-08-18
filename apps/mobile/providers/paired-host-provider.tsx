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
import { AppState, type AppStateStatus } from 'react-native';

import {
  PairedHostStore,
  type PairedHost,
  type PairedHostSnapshot,
  type PairedHostState,
} from '@/lib/pairing/paired-host-store';
import { runPairedHostStateTransition } from '@/lib/security/connection-account-scope';
import { purgeDirectMacStateForUser } from '@/lib/security/connection-credential-store';
import type { PairedMacClient } from '@/lib/transport/paired-mac-client';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';
import { mobileRuntimeVariant } from '@rhythm/mobile-runtime';

export const PAIRED_HOST_PROBE_TIMEOUT_MS = 4_000;
export const PAIRED_HOST_PROBE_INTERVAL_MS = 5_000;
export const PAIRED_HOST_PROBE_BACKOFF_MS = [
  5_000,
  10_000,
  20_000,
  60_000,
] as const;

export function nextPairedHostProbeInterval(current: number): number {
  const index = PAIRED_HOST_PROBE_BACKOFF_MS.indexOf(
    current as (typeof PAIRED_HOST_PROBE_BACKOFF_MS)[number],
  );
  return PAIRED_HOST_PROBE_BACKOFF_MS[
    Math.min(
      index < 0 ? 1 : index + 1,
      PAIRED_HOST_PROBE_BACKOFF_MS.length - 1,
    )
  ] ?? PAIRED_HOST_PROBE_BACKOFF_MS.at(-1)!;
}

export interface PairedHostContextValue {
  state: PairedHostState;
  host: PairedHost | null;
  client: PairedMacClient | null;
  message: string;
  refreshRevision: number;
  pair: (
    payload: string,
    options?: { replaceExisting?: boolean },
  ) => Promise<PairedHostSnapshot>;
  refresh: () => Promise<PairedHostSnapshot>;
  revoke: () => Promise<PairedHostSnapshot>;
  forget: () => Promise<PairedHostSnapshot>;
  supports: (feature: string) => boolean;
}

const PairedHostContext = createContext<PairedHostContextValue | null>(null);

export function PairedHostProvider({ children }: PropsWithChildren) {
  const account = useRhythmAccount();
  const [store] = useState(
    () => mobileRuntimeVariant.createPairedHostStore() ?? new PairedHostStore(),
  );
  const [snapshot, setSnapshot] = useState<PairedHostSnapshot>(() =>
    store.snapshot(),
  );
  const [client, setClient] = useState<PairedMacClient | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef<Promise<PairedHostSnapshot> | null>(null);
  const clientScopeRef = useRef<string | null>(null);
  const [probeIntervalMs, setProbeIntervalMs] = useState(
    PAIRED_HOST_PROBE_INTERVAL_MS,
  );
  const [probeScheduleEpoch, setProbeScheduleEpoch] = useState(0);
  const probeIntervalRef = useRef(PAIRED_HOST_PROBE_INTERVAL_MS);

  const resetProbeInterval = useCallback(() => {
    probeIntervalRef.current = PAIRED_HOST_PROBE_INTERVAL_MS;
    setProbeIntervalMs(PAIRED_HOST_PROBE_INTERVAL_MS);
    setProbeScheduleEpoch((current) => current + 1);
  }, []);

  const backOffProbeInterval = useCallback(() => {
    const next = nextPairedHostProbeInterval(probeIntervalRef.current);
    probeIntervalRef.current = next;
    setProbeIntervalMs(next);
  }, []);

  const apply = useCallback(
    (next: PairedHostSnapshot) => {
      if (mountedRef.current) {
        if (next.state === 'connected') resetProbeInterval();
        setSnapshot(next);
        setRefreshRevision((current) => current + 1);
        const nextClientScope =
          next.host && next.host.rhythmUserId === account.user?.id
            ? [
                next.host.rhythmUserId,
                next.host.hostId,
                next.host.deviceId,
                next.host.gatewayUrl,
                next.host.relayUrl ?? '',
              ].join(':')
            : null;
        if (clientScopeRef.current !== nextClientScope) {
          clientScopeRef.current = nextClientScope;
          setClient(store.client());
        }
      }
      return next;
    },
    [account.user?.id, resetProbeInterval, store],
  );

  const runBoundedRefresh = useCallback(() => {
    const current = store.snapshot();
    if (!current.host) return Promise.resolve(current);
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      PAIRED_HOST_PROBE_TIMEOUT_MS,
    );
    let pending: Promise<PairedHostSnapshot>;
    pending = store.refresh(abortController.signal)
      .then(apply)
      .finally(() => {
        clearTimeout(timeout);
        if (refreshInFlightRef.current === pending) {
          refreshInFlightRef.current = null;
        }
      });
    refreshInFlightRef.current = pending;
    return pending;
  }, [apply, store]);

  useEffect(() => {
    mountedRef.current = true;
    clientScopeRef.current = null;
    setClient(null);
    store.setAccountUserId(account.user?.id ?? null);
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      PAIRED_HOST_PROBE_TIMEOUT_MS,
    );
    void store.restore(abortController.signal)
      .then(apply)
      .finally(() => clearTimeout(timeout));
    return () => {
      mountedRef.current = false;
      abortController.abort();
      refreshInFlightRef.current = null;
      store.cancelPending();
    };
  }, [account.user?.id, apply, store]);

  useEffect(() => {
    const onStateChange = (state: AppStateStatus) => {
      if (state === 'active' && snapshot.host) {
        resetProbeInterval();
        void runBoundedRefresh();
      }
    };
    const subscription = AppState.addEventListener('change', onStateChange);
    return () => subscription.remove();
  }, [resetProbeInterval, runBoundedRefresh, snapshot.host]);

  useEffect(() => {
    if (
      !snapshot.host ||
      !['connected', 'offline', 'tailscaleUnavailable'].includes(snapshot.state)
    ) {
      return;
    }
    const timeout = setTimeout(() => {
      const backoffApplies =
        snapshot.state === 'offline' ||
        snapshot.state === 'tailscaleUnavailable';
      void runBoundedRefresh().then((next) => {
        if (
          backoffApplies &&
          (next.state === 'offline' ||
            next.state === 'tailscaleUnavailable')
        ) {
          backOffProbeInterval();
        }
      });
    }, probeIntervalMs);
    return () => clearTimeout(timeout);
  }, [
    backOffProbeInterval,
    probeIntervalMs,
    probeScheduleEpoch,
    runBoundedRefresh,
    snapshot.host,
    snapshot.state,
  ]);

  const pair = useCallback(
    async (payload: string, options: { replaceExisting?: boolean } = {}) => {
      if (!account.user) {
        throw new Error('Sign in to your Rhythm account before pairing a Mac.');
      }
      setSnapshot({
        ...store.snapshot(),
        state: 'pairing',
        message: 'Pairing securely with your Mac…',
      });
      clientScopeRef.current = null;
      setClient(null);
      try {
        return apply(
          await runPairedHostStateTransition(
            () => store.pair(payload, {
              userId: account.user!.id,
              deviceName: 'Rhythm iPhone',
              replaceExisting: options.replaceExisting,
            }),
            account.user.id,
            purgeDirectMacStateForUser,
          ),
        );
      } catch (error) {
        apply(store.snapshot());
        throw error;
      }
    },
    [account.user, apply, store],
  );

  const refresh = useCallback(
    async () => {
      resetProbeInterval();
      return runBoundedRefresh();
    },
    [resetProbeInterval, runBoundedRefresh],
  );
  const revoke = useCallback(
    async () => {
      try {
        const accountUserId = account.user?.id ?? snapshot.host?.rhythmUserId;
        if (!accountUserId) return apply(await store.revoke());
        return apply(await runPairedHostStateTransition(
          () => store.revoke(),
          accountUserId,
          purgeDirectMacStateForUser,
        ));
      } catch (error) {
        apply(store.snapshot());
        throw error;
      }
    },
    [account.user?.id, apply, snapshot.host?.rhythmUserId, store],
  );
  const forget = useCallback(
    async () => {
      try {
        return apply(await store.forget());
      } catch (error) {
        apply(store.snapshot());
        throw error;
      }
    },
    [apply, store],
  );

  const value = useMemo<PairedHostContextValue>(
    () => ({
      ...snapshot,
      client,
      refreshRevision,
      pair,
      refresh,
      revoke,
      forget,
      supports: (feature) => store.supports(feature),
    }),
    [client, forget, pair, refresh, refreshRevision, revoke, snapshot, store],
  );

  return (
    <PairedHostContext.Provider value={value}>
      {children}
    </PairedHostContext.Provider>
  );
}

export function usePairedHost(): PairedHostContextValue {
  const value = useContext(PairedHostContext);
  if (!value) {
    throw new Error('usePairedHost must be used within PairedHostProvider');
  }
  return value;
}
