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

export interface PairedHostContextValue {
  state: PairedHostState;
  host: PairedHost | null;
  client: PairedMacClient | null;
  message: string;
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
  const mountedRef = useRef(true);

  const apply = useCallback(
    (next: PairedHostSnapshot) => {
      if (mountedRef.current) {
        setSnapshot(next);
        setClient(store.client());
      }
      return next;
    },
    [store],
  );

  useEffect(() => {
    mountedRef.current = true;
    setClient(null);
    store.setAccountUserId(account.user?.id ?? null);
    void store.restore().then(apply);
    return () => {
      mountedRef.current = false;
      store.cancelPending();
    };
  }, [account.user?.id, apply, store]);

  useEffect(() => {
    const onStateChange = (state: AppStateStatus) => {
      if (state === 'active') void store.refresh().then(apply);
    };
    const subscription = AppState.addEventListener('change', onStateChange);
    return () => subscription.remove();
  }, [apply, store]);

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
    async () => apply(await store.refresh()),
    [apply, store],
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
      pair,
      refresh,
      revoke,
      forget,
      supports: (feature) => store.supports(feature),
    }),
    [client, forget, pair, refresh, revoke, snapshot, store],
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
