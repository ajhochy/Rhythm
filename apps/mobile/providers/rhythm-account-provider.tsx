/**
 * RhythmAccountProvider
 *
 * React context provider for Rhythm Cloud account state.
 *
 * Wraps RhythmSessionStore and exposes useRhythmAccount() to the component
 * tree. The token-bearing client is injected here so the store itself remains
 * test-friendly with no React dependency.
 *
 * State machine:
 *   signedOut | signingIn | signedIn | refreshing | expired | offline
 *
 * Ownership model (per AGENTS.md):
 *   - Provider owns session state, hydration, signIn/signOut/refresh
 *   - Components own only presentation state
 *   - Token lives in SecureStore; metadata in AsyncStorage (secret-free)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { startGoogleMobileOAuth } from '@/lib/auth/google-mobile-oauth';
import {
  classifyRhythmAccountError,
  RhythmSessionStore,
  RHYTHM_SESSION_SECURE_KEY,
  type RhythmAccountError,
  type RhythmAccountState,
  type RhythmSessionResult,
  type RhythmUser,
} from '@/lib/auth/rhythm-session-store';
import { RhythmCloudClient } from '@/lib/transport/rhythm-cloud-client';
import { getItemAsync } from 'expo-secure-store';

// ---------------------------------------------------------------------------
// Public surface produced by this provider
// ---------------------------------------------------------------------------

export interface RhythmAccountContextValue {
  /** Current state of the account session machine. */
  state: RhythmAccountState;
  /** Authenticated user data; null when not signed in. */
  user: RhythmUser | null;
  error: RhythmAccountError | undefined;
  /**
   * Exchange a Google auth code for a Rhythm Cloud session.
   * Resolves when sign-in succeeds; throws on failure.
   */
  signIn: () => Promise<void>;
  /** Sign out and clear the stored session. */
  signOut: () => Promise<void>;
  /**
   * Re-validate the stored token via /auth/me.
   * Useful when returning from background.
   */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const RhythmAccountContext = createContext<RhythmAccountContextValue | null>(null);

// ---------------------------------------------------------------------------
// Cloud client factory
// ---------------------------------------------------------------------------

const RHYTHM_CLOUD_BASE_URL =
  process.env.EXPO_PUBLIC_RHYTHM_CLOUD_URL ?? 'https://api.vcrcapps.com';
const GOOGLE_MOBILE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_MOBILE_CLIENT_ID ?? '';
const GOOGLE_MOBILE_REDIRECT_URI = process.env.EXPO_PUBLIC_GOOGLE_MOBILE_REDIRECT_URI ?? '';

function buildCloudClient(): RhythmCloudClient {
  return new RhythmCloudClient({
    baseUrl: RHYTHM_CLOUD_BASE_URL,
    getToken: async () => {
      const token = await getItemAsync(RHYTHM_SESSION_SECURE_KEY);
      if (!token) throw new Error('No session token available');
      return token;
    },
  });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function RhythmAccountProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<RhythmAccountState>('signedOut');
  const [user, setUser] = useState<RhythmUser | null>(null);
  const [error, setError] = useState<RhythmAccountError>();
  const operationRef = useRef(0);

  // Stable store instance — created once per provider mount
  const [store] = useState<RhythmSessionStore>(() => {
    const client = buildCloudClient();
    return new RhythmSessionStore({ client });
  });

  const applyResult = useCallback((result: RhythmSessionResult) => {
    setState(result.state);
    setUser(result.user);
    setError(result.error);
  }, []);

  // Hydrate on mount
  useEffect(() => {
    let cancelled = false;
    const operation = ++operationRef.current;

    store.restore().then((result) => {
      if (!cancelled && operation === operationRef.current) applyResult(result);
    }).catch((cause) => {
      if (!cancelled && operation === operationRef.current) {
        setState('error');
        setError(classifyRhythmAccountError(cause));
      }
    });

    return () => {
      cancelled = true;
      operationRef.current += 1;
      store.cancelPending();
    };
  }, [applyResult, store]);

  const signIn = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    setState('signingIn');
    setError(undefined);
    try {
      const oauthParams = await startGoogleMobileOAuth({
        clientId: GOOGLE_MOBILE_CLIENT_ID,
        redirectUri: GOOGLE_MOBILE_REDIRECT_URI,
      });
      if (operation !== operationRef.current) return;
      const result = await store.signIn(oauthParams);
      if (operation === operationRef.current) applyResult(result);
    } catch (cause) {
      if (operation === operationRef.current) {
        const accountError = cause && typeof cause === 'object' && 'accountError' in cause
          ? (cause as { accountError: RhythmAccountError }).accountError
          : classifyRhythmAccountError(cause);
        setState(accountError.kind === 'offline' ? 'offline' : 'error');
        setError(accountError);
      }
      throw cause;
    }
  }, [applyResult, store]);

  const signOut = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    const result = await store.signOut();
    if (operation === operationRef.current) applyResult(result);
  }, [applyResult, store]);

  const refresh = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    setState('refreshing');
    setError(undefined);
    const result = await store.refresh();
    if (operation === operationRef.current) applyResult(result);
  }, [applyResult, store]);

  return (
    <RhythmAccountContext.Provider value={{ state, user, error, signIn, signOut, refresh }}>
      {children}
    </RhythmAccountContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the Rhythm Cloud account session.
 *
 * Throws if used outside of a <RhythmAccountProvider>.
 */
export function useRhythmAccount(): RhythmAccountContextValue {
  const ctx = useContext(RhythmAccountContext);
  if (!ctx) {
    throw new Error('useRhythmAccount must be used within a RhythmAccountProvider');
  }
  return ctx;
}
