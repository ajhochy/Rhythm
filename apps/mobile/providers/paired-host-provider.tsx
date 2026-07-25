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
import { useRhythmAccount } from '@/providers/rhythm-account-provider';

export interface PairedHostContextValue {
  state: PairedHostState;
  host: PairedHost | null;
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
  const [store] = useState(() => new PairedHostStore());
  const [snapshot, setSnapshot] = useState<PairedHostSnapshot>(() =>
    store.snapshot(),
  );
  const mountedRef = useRef(true);

  const apply = useCallback((next: PairedHostSnapshot) => {
    if (mountedRef.current) setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void store.restore().then(apply);
    return () => {
      mountedRef.current = false;
      store.cancelPending();
    };
  }, [apply, store]);

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
      try {
        return apply(
          await store.pair(payload, {
            userId: account.user.id,
            deviceName: 'Rhythm iPhone',
            replaceExisting: options.replaceExisting,
          }),
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
    async () => apply(await store.revoke()),
    [apply, store],
  );
  const forget = useCallback(
    async () => apply(await store.forget()),
    [apply, store],
  );

  const value = useMemo<PairedHostContextValue>(
    () => ({
      ...snapshot,
      pair,
      refresh,
      revoke,
      forget,
      supports: (feature) => store.supports(feature),
    }),
    [forget, pair, refresh, revoke, snapshot, store],
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
