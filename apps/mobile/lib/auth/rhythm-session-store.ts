import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

export const RHYTHM_SESSION_SECURE_KEY = 'rhythm.cloud.session';
export const RHYTHM_ACCOUNT_META_KEY = 'rhythm.cloud.account.meta';

export type RhythmAccountState =
  | 'signedOut'
  | 'signingIn'
  | 'signedIn'
  | 'refreshing'
  | 'expired'
  | 'offline'
  | 'error';

export type RhythmAccountErrorKind =
  | 'offline'
  | 'forbidden'
  | 'server'
  | 'malformed'
  | 'storage'
  | 'authentication'
  | 'unknown';

export interface RhythmAccountError {
  kind: RhythmAccountErrorKind;
  message: string;
  retryable: boolean;
}

export interface RhythmUser {
  id: number;
  email: string;
  name: string;
  photoUrl: string | null;
}

export interface RhythmSessionResult {
  state: RhythmAccountState;
  user: RhythmUser | null;
  error?: RhythmAccountError;
}

export interface SignInParams {
  code: string;
  codeVerifier: string;
  nonce: string;
}

export interface SessionStoreClient {
  request<T = unknown>(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
  ): Promise<T>;
  requestPublic<T = unknown>(
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
  ): Promise<T>;
  requestWithToken?<T = unknown>(
    token: string,
    path: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
  ): Promise<T>;
}

interface ExchangeResponse {
  sessionToken: string;
  user: RhythmUser;
}

interface MeResponse {
  user: RhythmUser;
}

type ApiErrorShape = {
  status?: number;
  code?: string;
  message?: string;
  retryable?: boolean;
};

function isUser(value: unknown): value is RhythmUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === 'number' &&
    typeof user.email === 'string' &&
    typeof user.name === 'string' &&
    (typeof user.photoUrl === 'string' || user.photoUrl === null)
  );
}

export function classifyRhythmAccountError(error: unknown): RhythmAccountError {
  const value = error && typeof error === 'object' ? error as ApiErrorShape : {};
  const message = typeof value.message === 'string'
    ? value.message
    : 'Rhythm account request failed.';
  if (value.status === 0 && value.code === 'NETWORK_ERROR') {
    return { kind: 'offline', message, retryable: true };
  }
  if (value.code === 'TOKEN_UNAVAILABLE') {
    return { ...storageError(), message };
  }
  if (value.status === 401) {
    return { kind: 'authentication', message, retryable: false };
  }
  if (value.status === 403) {
    return { kind: 'forbidden', message, retryable: false };
  }
  if (value.code === 'INVALID_JSON' || value.code === 'BODY_READ_ERROR') {
    return { kind: 'malformed', message, retryable: Boolean(value.retryable) };
  }
  if (typeof value.status === 'number' && value.status >= 500) {
    return { kind: 'server', message, retryable: Boolean(value.retryable) };
  }
  return { kind: 'unknown', message, retryable: Boolean(value.retryable) };
}

const storageError = (): RhythmAccountError => ({
  kind: 'storage',
  message: 'Secure account storage is unavailable. Unlock the device and try again.',
  retryable: true,
});

async function neutralizeSessionToken(): Promise<void> {
  try {
    await deleteItemAsync(RHYTHM_SESSION_SECURE_KEY);
  } catch (deleteError) {
    try {
      // An empty value is unusable by every token-bearing client. This is the
      // safe fallback when a platform keychain refuses deletion.
      await setItemAsync(RHYTHM_SESSION_SECURE_KEY, '');
    } catch {
      throw deleteError;
    }
  }
  credentialGeneration += 1;
}

// SecureStore is process-global, so credential mutation ownership must also
// span every store instance. Providers are intentionally remountable; an
// instance-local queue lets cleanup from the unmounted store erase the new
// store's successfully persisted token.
let credentialQueue: Promise<void> = Promise.resolve();
let credentialGeneration = 0;

async function persistSessionToken(token: string): Promise<void> {
  await setItemAsync(RHYTHM_SESSION_SECURE_KEY, token);
  credentialGeneration += 1;
}

interface CredentialSnapshot {
  token: string;
  generation: number;
}

export class RhythmSessionStore {
  private readonly client: SessionStoreClient;
  private state: RhythmAccountState = 'signedOut';
  private user: RhythmUser | null = null;
  private error: RhythmAccountError | undefined;
  private operation = 0;

  constructor({ client }: { client: SessionStoreClient }) {
    this.client = client;
  }

  async getState(): Promise<RhythmAccountState> {
    return this.state;
  }

  cancelPending(): void {
    this.operation += 1;
  }

  private snapshot(): RhythmSessionResult {
    return { state: this.state, user: this.user, ...(this.error ? { error: this.error } : {}) };
  }

  private current(operation: number): boolean {
    return operation === this.operation;
  }

  private async neutralizeForOperation(operation: number): Promise<boolean> {
    if (!this.current(operation)) return false;
    await neutralizeSessionToken();
    return true;
  }

  private async withCredentialLock<T>(action: () => Promise<T>): Promise<T> {
    const previous = credentialQueue;
    let release!: () => void;
    credentialQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  private fail(error: RhythmAccountError, user: RhythmUser | null = this.user): RhythmSessionResult {
    this.state = error.kind === 'offline' ? 'offline' : 'error';
    this.user = user;
    this.error = error;
    return this.snapshot();
  }

  async restore(): Promise<RhythmSessionResult> {
    const operation = ++this.operation;
    const credential = await this.withCredentialLock(async () => {
      let token: string | null;
      try {
        token = await getItemAsync(RHYTHM_SESSION_SECURE_KEY);
      } catch {
        if (!this.current(operation)) return this.snapshot();
        return this.fail(storageError());
      }
      if (!this.current(operation)) return this.snapshot();
      if (!token) {
        this.state = 'signedOut';
        this.user = null;
        this.error = undefined;
        return this.snapshot();
      }
      return { token, generation: credentialGeneration };
    });
    if (!('token' in credential)) return credential;
    return this.validateToken(operation, credential);
  }

  async refresh(): Promise<RhythmSessionResult> {
    const operation = ++this.operation;
    this.state = 'refreshing';
    this.error = undefined;
    const credential = await this.withCredentialLock(async () => {
      let token: string | null;
      try {
        token = await getItemAsync(RHYTHM_SESSION_SECURE_KEY);
      } catch {
        if (!this.current(operation)) return this.snapshot();
        return this.fail(storageError());
      }
      if (!this.current(operation)) return this.snapshot();
      if (!token) {
        this.state = 'signedOut';
        this.user = null;
        return this.snapshot();
      }
      return { token, generation: credentialGeneration };
    });
    if (!('token' in credential)) return credential;
    return this.validateToken(operation, credential);
  }

  private async validateToken(
    operation: number,
    credential: CredentialSnapshot,
  ): Promise<RhythmSessionResult> {
    try {
      const response = this.client.requestWithToken
        ? await this.client.requestWithToken<MeResponse>(
            credential.token,
            '/auth/me',
            { method: 'GET' },
          )
        : await this.client.request<MeResponse>('/auth/me', { method: 'GET' });
      if (!this.current(operation)) return this.snapshot();
      if (!isUser(response?.user)) {
        return this.fail({
          kind: 'malformed',
          message: 'Rhythm returned invalid account data.',
          retryable: false,
        });
      }
      return this.withCredentialLock(async () => {
        if (
          !this.current(operation) ||
          credential.generation !== credentialGeneration
        ) return this.snapshot();
        const token = await getItemAsync(RHYTHM_SESSION_SECURE_KEY);
        if (token !== credential.token) return this.snapshot();
        try {
          await this.persistMeta(response.user);
        } catch {
          if (!this.current(operation)) return this.snapshot();
          return this.fail(storageError(), response.user);
        }
        if (!this.current(operation)) {
          await AsyncStorage.removeItem(RHYTHM_ACCOUNT_META_KEY).catch(() => undefined);
          return this.snapshot();
        }
        this.state = 'signedIn';
        this.user = response.user;
        this.error = undefined;
        return this.snapshot();
      });
    } catch (error) {
      if (!this.current(operation)) return this.snapshot();
      const classified = classifyRhythmAccountError(error);
      if (classified.kind === 'authentication') {
        try {
          const neutralized = await this.withCredentialLock(async () => {
            if (
              !this.current(operation) ||
              credential.generation !== credentialGeneration
            ) return false;
            const token = await getItemAsync(RHYTHM_SESSION_SECURE_KEY);
            if (token !== credential.token) return false;
            return this.neutralizeForOperation(operation);
          });
          if (!neutralized) return this.snapshot();
        } catch {
          if (!this.current(operation)) return this.snapshot();
          return this.fail(storageError());
        }
        if (!this.current(operation)) return this.snapshot();
        this.state = 'expired';
        this.user = null;
        this.error = classified;
        return this.snapshot();
      }
      const cachedUser = await this.loadMeta();
      if (!this.current(operation)) return this.snapshot();
      return this.withCredentialLock(async () => {
        if (
          !this.current(operation) ||
          credential.generation !== credentialGeneration
        ) return this.snapshot();
        return this.fail(classified, cachedUser);
      });
    }
  }

  async signIn(params: SignInParams): Promise<RhythmSessionResult> {
    const operation = ++this.operation;
    this.state = 'signingIn';
    this.error = undefined;
    let persistenceStarted = false;
    try {
      const exchange = await this.client.requestPublic<ExchangeResponse>(
        '/auth/google/mobile-exchange',
        {
          method: 'POST',
          body: JSON.stringify(params),
          headers: { 'Content-Type': 'application/json' },
        },
      );
      if (!this.current(operation)) return this.snapshot();
      if (!exchange?.sessionToken || !isUser(exchange.user)) {
        throw Object.assign(new Error('Rhythm returned invalid sign-in data.'), {
          code: 'INVALID_JSON',
          status: 200,
        });
      }
      persistenceStarted = true;
      return await this.withCredentialLock(async () => {
        if (!this.current(operation)) return this.snapshot();
        let tokenWritten = false;
        try {
          await persistSessionToken(exchange.sessionToken);
          tokenWritten = true;
          if (!this.current(operation)) {
            await neutralizeSessionToken();
            return this.snapshot();
          }
          await this.persistMeta(exchange.user);
          if (!this.current(operation)) {
            await neutralizeSessionToken();
            await AsyncStorage.removeItem(RHYTHM_ACCOUNT_META_KEY).catch(() => undefined);
            return this.snapshot();
          }
          this.state = 'signedIn';
          this.user = exchange.user;
          return this.snapshot();
        } catch (error) {
          if (tokenWritten) {
            try { await neutralizeSessionToken(); } catch { /* report below */ }
          }
          throw error;
        }
      });
    } catch (error) {
      if (!this.current(operation)) return this.snapshot();
      const classified = persistenceStarted ? storageError() : classifyRhythmAccountError(error);
      this.fail(classified, null);
      throw Object.assign(error instanceof Error ? error : new Error(classified.message), {
        accountError: classified,
      });
    }
  }

  async signOut(): Promise<RhythmSessionResult> {
    const operation = ++this.operation;
    let token: string | null = null;
    try {
      const signedOut = await this.withCredentialLock(async () => {
        if (!this.current(operation)) return false;
        try { token = await getItemAsync(RHYTHM_SESSION_SECURE_KEY); } catch { /* deletion still works */ }
        await neutralizeSessionToken();
        await AsyncStorage.removeItem(RHYTHM_ACCOUNT_META_KEY);
        return true;
      });
      if (!signedOut) return this.snapshot();
    } catch {
      if (!this.current(operation)) return this.snapshot();
      return this.fail(storageError());
    }
    if (!this.current(operation)) return this.snapshot();
    this.state = 'signedOut';
    this.user = null;
    this.error = undefined;

    if (token) {
      const logout = this.client.requestWithToken
        ? this.client.requestWithToken(token, '/auth/logout', { method: 'POST' })
        : this.client.request('/auth/logout', { method: 'POST' });
      void logout.catch(() => undefined);
    }
    return this.snapshot();
  }

  private async persistMeta(user: RhythmUser): Promise<void> {
    await AsyncStorage.setItem(RHYTHM_ACCOUNT_META_KEY, JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
      photoUrl: user.photoUrl,
    }));
  }

  private async loadMeta(): Promise<RhythmUser | null> {
    try {
      const raw = await AsyncStorage.getItem(RHYTHM_ACCOUNT_META_KEY);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      return isUser(value) ? value : null;
    } catch {
      return null;
    }
  }
}
