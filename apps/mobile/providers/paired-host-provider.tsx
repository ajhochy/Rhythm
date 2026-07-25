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
import Constants from 'expo-constants';

import {
  PairedHostStore,
  PAIRED_DEVICE_SECURE_KEY,
  type PairedHost,
  type PairedHostSnapshot,
  type PairedHostState,
} from '@/lib/pairing/paired-host-store';
import { RHYTHM_SESSION_SECURE_KEY } from '@/lib/auth/rhythm-session-store';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';

const e2eCredentials = new Map<string, string>([
  [RHYTHM_SESSION_SECURE_KEY, 'e2e-cloud-session'],
]);

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
  const [store] = useState(() => {
    const e2eMode = Constants.expoConfig?.extra?.e2eMode === true;
    const e2eServerUrl = Constants.expoConfig?.extra?.e2eServerUrl;
    if (!e2eMode || typeof e2eServerUrl !== 'string') {
      return new PairedHostStore();
    }
    const storageFailureEnabled = async () => {
      const response = await fetch(
        `${e2eServerUrl.replace(/\/$/, '')}/__control/mobile-storage-failure`,
      );
      if (!response.ok) return false;
      return ((await response.json()) as { enabled?: boolean }).enabled === true;
    };
    return new PairedHostStore({
      getCredential: async (key) => e2eCredentials.get(key) ?? null,
      setCredential: async (key, value) => {
        if (
          key === PAIRED_DEVICE_SECURE_KEY &&
          await storageFailureEnabled()
        ) {
          throw new Error('E2E secure storage write failure');
        }
        e2eCredentials.set(key, value);
      },
      deleteCredential: async (key) => {
        if (
          key === PAIRED_DEVICE_SECURE_KEY &&
          await storageFailureEnabled()
        ) {
          throw new Error('E2E secure storage delete failure');
        }
        e2eCredentials.delete(key);
      },
      resolveGatewayUrl: (gatewayUrl) =>
        `${e2eServerUrl.replace(/\/$/, '')}/__mobile/${new URL(gatewayUrl).hostname}`,
    });
  });
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
    async () => {
      try {
        return apply(await store.revoke());
      } catch (error) {
        apply(store.snapshot());
        throw error;
      }
    },
    [apply, store],
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
