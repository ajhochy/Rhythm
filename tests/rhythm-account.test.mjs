/**
 * Rhythm Account Shell — contract tests (Task 3)
 *
 * Tests are written against the real module sources transpiled by TypeScript.
 * No React/Expo runtime is available in Node; we exercise session-store logic
 * directly and verify state-machine invariants without mounting components.
 *
 * Run:  node tests/rhythm-account.test.mjs
 *
 * Behaviors tested:
 *  1. Successful token exchange → session persisted, state → signedIn
 *  2. Invalid/expired token (401 on /auth/me) → session cleared, state → expired
 *  3. Missing token on restore → state remains signedOut
 *  4. Logout → session cleared from store, state → signedOut
 *  5. Persisted metadata is secret-free (no sessionToken in AsyncStorage payload)
 *  6. State machine only accepts bounded transitions
 *  7. signIn with a 400 error stays in signedOut (does not get stuck in signingIn)
 *  8. refresh with a 401 transitions to expired (not signedIn)
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Load and transpile rhythm-session-store.ts
// ---------------------------------------------------------------------------

const storeSrc = await readFile(
  new URL('../lib/auth/rhythm-session-store.ts', import.meta.url),
  'utf8',
).catch(() => {
  throw new Error(
    'rhythm-session-store.ts not found — run the implementation step first\n' +
      'Expected path: lib/auth/rhythm-session-store.ts',
  );
});

// Strip runtime imports — this data-URL module receives test doubles below.
function stripImports(src) {
  return src.replace(/^import\b[\s\S]*?from\s+['"][^'"]+['"]\s*;?\n?/gm, '');
}
function stripTypeKeyword(src) {
  return src.replace(/^export\s+type\s+\{[^}]*\}\s*;?\n?/gm, '');
}
function prepare(src) {
  return stripTypeKeyword(stripImports(src));
}

// ---------------------------------------------------------------------------
// Build a minimal stub environment the session store needs
// ---------------------------------------------------------------------------
// The session store depends on:
//   - expo-secure-store  (SecureStore.getItemAsync / setItemAsync / deleteItemAsync)
//   - @react-native-async-storage/async-storage  (AsyncStorage.getItem / setItem / removeItem)
// We inject test doubles via a bundle header.

const stubHeader = `
// ---------- test stubs for Expo / React Native modules ----------

// SecureStore stub backed by a plain Map
const __secureStore = new Map();
const __secureFailures = { get: false, set: false, delete: false };
const getItemAsync = async (key) => {
  if (__secureFailures.get) throw new Error('SecureStore read failed');
  return __secureStore.get(key) ?? null;
};
const setItemAsync = async (key, value) => {
  if (__secureFailures.set) throw new Error('SecureStore write failed');
  __secureStore.set(key, value);
};
const deleteItemAsync = async (key) => {
  if (__secureFailures.delete) throw new Error('SecureStore delete failed');
  __secureStore.delete(key);
};

// AsyncStorage stub backed by a plain Map
const __asyncStorage = new Map();
const __asyncFailures = { get: false, set: false, remove: false };
const AsyncStorage = {
  getItem: async (key) => {
    if (__asyncFailures.get) throw new Error('AsyncStorage read failed');
    return __asyncStorage.get(key) ?? null;
  },
  setItem: async (key, value) => {
    if (__asyncFailures.set) throw new Error('AsyncStorage write failed');
    __asyncStorage.set(key, value);
  },
  removeItem: async (key) => {
    if (__asyncFailures.remove) throw new Error('AsyncStorage remove failed');
    __asyncStorage.delete(key);
  },
};

// Expose helpers for test introspection
export function __getSecureStore() { return __secureStore; }
export function __getAsyncStorage() { return __asyncStorage; }
export function __setSecureFailure(operation, value) { __secureFailures[operation] = value; }
export function __setAsyncFailure(operation, value) { __asyncFailures[operation] = value; }
export function __resetStores() {
  __secureStore.clear();
  __asyncStorage.clear();
  Object.keys(__secureFailures).forEach((key) => { __secureFailures[key] = false; });
  Object.keys(__asyncFailures).forEach((key) => { __asyncFailures[key] = false; });
}

// ---------- end stubs ----------
`;

const bundleSrc = [stubHeader, prepare(storeSrc)].join('\n\n');

const transpiled = ts.transpileModule(bundleSrc, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    strict: false,
  },
}).outputText;

const mod = await import(`data:text/javascript,${encodeURIComponent(transpiled)}`);

const {
  RhythmSessionStore,
  RHYTHM_SESSION_SECURE_KEY,
  RHYTHM_ACCOUNT_META_KEY,
  __resetStores,
  __getSecureStore,
  __getAsyncStorage,
  __setSecureFailure,
  __setAsyncFailure,
} = mod;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function captureThrown(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** Build a minimal /auth/me-style success response body */
function makeMeResponse(overrides = {}) {
  return {
    user: {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      photoUrl: null,
      ...overrides.user,
    },
    workspace: null,
    workspaceRole: null,
    ...overrides,
  };
}

/** Build a minimal mobile-exchange success response */
function makeExchangeResponse(token = 'sess-token-abc') {
  return {
    sessionToken: token,
    user: {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      photoUrl: null,
    },
  };
}

// ---------------------------------------------------------------------------
// TEST 1: Successful token exchange → session persisted, state → signedIn
// ---------------------------------------------------------------------------

{
  __resetStores();

  const exchangeToken = 'exchange-session-token-123';

  // Fake cloud client: exchange succeeds, /auth/me succeeds
  let authenticatedExchangeCalled = false;
  const fakeClient = {
    request: async (path, init) => {
      if (path === '/auth/google/mobile-exchange') {
        authenticatedExchangeCalled = true;
      }
      if (path === '/auth/me') {
        return makeMeResponse();
      }
      throw new Error(`Unexpected path: ${path}`);
    },
    requestPublic: async (path) => {
      assert.equal(path, '/auth/google/mobile-exchange');
      return makeExchangeResponse(exchangeToken);
    },
  };

  const store = new RhythmSessionStore({ client: fakeClient });

  const result = await store.signIn({
    code: 'auth-code',
    codeVerifier: 'verifier',
    redirectUri: 'rhythmagents://auth',
    clientId: 'client-id',
  });

  assert.equal(result.state, 'signedIn', 'signIn must return signedIn state');
  assert.ok(result.user, 'signIn must return user');
  assert.equal(result.user.email, 'test@example.com');
  assert.equal(authenticatedExchangeCalled, false, 'mobile exchange must use the public client path');

  // Token must be in SecureStore
  const secureStoreMap = __getSecureStore();
  assert.ok(secureStoreMap.has(RHYTHM_SESSION_SECURE_KEY), 'sessionToken must be in SecureStore');
  const storedToken = secureStoreMap.get(RHYTHM_SESSION_SECURE_KEY);
  assert.equal(storedToken, exchangeToken, 'stored token must match exchange response');

  // Metadata in AsyncStorage must NOT contain the token
  const asyncStorageMap = __getAsyncStorage();
  if (asyncStorageMap.has(RHYTHM_ACCOUNT_META_KEY)) {
    const meta = JSON.parse(asyncStorageMap.get(RHYTHM_ACCOUNT_META_KEY));
    assert.ok(!('sessionToken' in meta), 'AsyncStorage metadata must not contain sessionToken');
    assert.ok(!JSON.stringify(meta).includes(exchangeToken), 'AsyncStorage metadata must not contain token value');
  }

  console.log('  ✓ TEST 1: Successful exchange → signedIn, token in SecureStore, metadata secret-free');
}

// ---------------------------------------------------------------------------
// TEST 2: /auth/me returns 401 (expired token) → session cleared, state → expired
// ---------------------------------------------------------------------------

{
  __resetStores();

  // Pre-seed a stored token
  __getSecureStore().set(RHYTHM_SESSION_SECURE_KEY, 'stale-token-xyz');

  // Fake cloud client: /auth/me returns 401
  const fakeClient = {
    request: async (path, _init) => {
      if (path === '/auth/me') {
        const err = Object.assign(new Error('Unauthorized'), {
          name: 'ApiError',
          status: 401,
          code: 'UNAUTHORIZED',
          retryable: false,
          source: 'cloud',
        });
        throw err;
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  const store = new RhythmSessionStore({ client: fakeClient });

  const result = await store.restore();

  assert.equal(result.state, 'expired', 'restore with 401 on /auth/me must transition to expired');

  // Token must be cleared from SecureStore after 401
  const storedAfter = __getSecureStore().get(RHYTHM_SESSION_SECURE_KEY);
  assert.ok(!storedAfter, 'sessionToken must be cleared from SecureStore on 401');

  console.log('  ✓ TEST 2: 401 on /auth/me → expired, token cleared from SecureStore');
}

// ---------------------------------------------------------------------------
// TEST 3: No stored token → state remains signedOut
// ---------------------------------------------------------------------------

{
  __resetStores();

  const fakeClient = {
    request: async (_path, _init) => {
      throw new Error('Should not be called with no token');
    },
  };

  const store = new RhythmSessionStore({ client: fakeClient });
  const result = await store.restore();

  assert.equal(result.state, 'signedOut', 'restore with no token must return signedOut');
  assert.ok(!result.user, 'signedOut state must have no user');

  console.log('  ✓ TEST 3: No stored token → signedOut, no /auth/me call made');
}

// ---------------------------------------------------------------------------
// TEST 4: Logout → session cleared from store, state → signedOut
// ---------------------------------------------------------------------------

{
  __resetStores();

  // Pre-seed a stored token
  const token = 'valid-session-token-logout';
  __getSecureStore().set(RHYTHM_SESSION_SECURE_KEY, token);

  let logoutCalled = false;
  const fakeClient = {
    request: async (path, _init) => {
      if (path === '/auth/logout') {
        logoutCalled = true;
        return; // 204 with no body → void
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  const store = new RhythmSessionStore({ client: fakeClient });
  const result = await store.signOut();

  assert.equal(result.state, 'signedOut', 'signOut must return signedOut state');
  assert.ok(logoutCalled, 'signOut must call POST /auth/logout');

  const storedAfter = __getSecureStore().get(RHYTHM_SESSION_SECURE_KEY);
  assert.ok(!storedAfter, 'sessionToken must be cleared from SecureStore after logout');

  console.log('  ✓ TEST 4: Logout → POST /auth/logout called, token cleared, signedOut');
}

// ---------------------------------------------------------------------------
// TEST 5: Persisted metadata is secret-free (AsyncStorage never stores sessionToken)
// ---------------------------------------------------------------------------

{
  __resetStores();

  const SECRET = 'super-secret-session-token-NEVER-STORE-THIS';

  const fakeClient = {
    request: async (path, _init) => {
      if (path === '/auth/me') {
        return makeMeResponse();
      }
      throw new Error(`Unexpected path: ${path}`);
    },
    requestPublic: async (path) => {
      if (path === '/auth/google/mobile-exchange') return makeExchangeResponse(SECRET);
      throw new Error(`Unexpected public path: ${path}`);
    },
  };

  const store = new RhythmSessionStore({ client: fakeClient });
  await store.signIn({
    code: 'code',
    codeVerifier: 'verifier',
    redirectUri: 'rhythmagents://auth',
    clientId: 'client-id',
  });

  // Inspect every value in AsyncStorage
  const asyncMap = __getAsyncStorage();
  for (const [key, value] of asyncMap.entries()) {
    assert.ok(
      !String(value).includes(SECRET),
      `AsyncStorage key "${key}" must not contain the session token`,
    );
  }

  console.log('  ✓ TEST 5: AsyncStorage never stores sessionToken value');
}

// ---------------------------------------------------------------------------
// TEST 6: State machine — bounded transitions only
// ---------------------------------------------------------------------------

{
  __resetStores();

  // signIn while already in signingIn should not stack
  const fakeClient = {
    request: async (path, _init) => {
      if (path === '/auth/me') return makeMeResponse();
      throw new Error(`Unexpected path: ${path}`);
    },
    requestPublic: async (path) => {
      if (path === '/auth/google/mobile-exchange') return makeExchangeResponse();
      throw new Error(`Unexpected public path: ${path}`);
    },
  };

  const store = new RhythmSessionStore({ client: fakeClient });

  // Sequential calls should both resolve without deadlock/crash
  await store.signIn({ code: 'c1', codeVerifier: 'v1', redirectUri: 'r', clientId: 'ci' });
  const result2 = await store.signIn({ code: 'c2', codeVerifier: 'v2', redirectUri: 'r', clientId: 'ci' });

  assert.ok(
    ['signedIn', 'signingIn', 'signedOut'].includes(result2.state),
    `Second signIn must return a valid state, got: ${result2.state}`,
  );

  // Valid states are the full bounded set
  const VALID_STATES = ['signedOut', 'signingIn', 'signedIn', 'refreshing', 'expired', 'offline', 'error'];
  assert.ok(
    VALID_STATES.includes(result2.state),
    `State must be one of the bounded set, got: ${result2.state}`,
  );

  console.log('  ✓ TEST 6: State machine bounded — all states within allowed set');
}

// ---------------------------------------------------------------------------
// TEST 7: signIn with a 400 error → stays signedOut, not stuck in signingIn
// ---------------------------------------------------------------------------

{
  __resetStores();

  const fakeClient = {
    request: async (path, _init) => {
      throw new Error(`Unexpected authenticated path: ${path}`);
    },
    requestPublic: async (path) => {
      if (path === '/auth/google/mobile-exchange') {
        const err = Object.assign(new Error('Bad Request'), {
          name: 'ApiError',
          status: 400,
          code: 'BAD_REQUEST',
          retryable: false,
          source: 'cloud',
        });
        throw err;
      }
      throw new Error(`Unexpected public path: ${path}`);
    },
  };

  const store = new RhythmSessionStore({ client: fakeClient });
  const err = await captureThrown(() =>
    store.signIn({ code: 'c', codeVerifier: 'v', redirectUri: 'r', clientId: 'ci' }),
  );

  assert.ok(err, 'signIn with 400 must throw');

  // After failure the store must expose a bounded actionable error (not stay busy).
  const state = await store.getState();
  assert.equal(state, 'error', 'state must be error after failed signIn — not stuck in signingIn');

  console.log('  ✓ TEST 7: signIn failure → throws, state becomes actionable error (not stuck)');
}

// ---------------------------------------------------------------------------
// TEST 8: refresh with a 401 → transitions to expired (not signedIn)
// ---------------------------------------------------------------------------

{
  __resetStores();

  // Pre-seed a stored token and user metadata
  __getSecureStore().set(RHYTHM_SESSION_SECURE_KEY, 'token-to-expire');
  __getAsyncStorage().set(
    RHYTHM_ACCOUNT_META_KEY,
    JSON.stringify({ email: 'test@example.com', name: 'Test User', photoUrl: null }),
  );

  let callCount = 0;
  const fakeClient = {
    request: async (path, _init) => {
      callCount++;
      if (path === '/auth/me') {
        const err = Object.assign(new Error('Unauthorized'), {
          name: 'ApiError',
          status: 401,
          code: 'UNAUTHORIZED',
          retryable: false,
          source: 'cloud',
        });
        throw err;
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  const store = new RhythmSessionStore({ client: fakeClient });
  const result = await store.refresh();

  assert.equal(result.state, 'expired', 'refresh with 401 must transition to expired');
  assert.ok(callCount > 0, '/auth/me must be called during refresh');

  // Token must be cleared
  const storedToken = __getSecureStore().get(RHYTHM_SESSION_SECURE_KEY);
  assert.ok(!storedToken, 'token must be cleared from SecureStore when refresh gets 401');

  console.log('  ✓ TEST 8: refresh with 401 → expired, token cleared');
}

// ---------------------------------------------------------------------------
// TEST 9: A stale restore cannot overwrite a newer local sign-out
// ---------------------------------------------------------------------------

{
  __resetStores();
  __getSecureStore().set(RHYTHM_SESSION_SECURE_KEY, 'restore-token');
  let resolveMe;
  const mePending = new Promise((resolve) => { resolveMe = resolve; });
  const fakeClient = {
    request: async (path) => {
      if (path === '/auth/me') return mePending;
      if (path === '/auth/logout') return undefined;
      throw new Error(`Unexpected path: ${path}`);
    },
    requestPublic: async () => { throw new Error('Unexpected public request'); },
  };
  const store = new RhythmSessionStore({ client: fakeClient });

  const restoring = store.restore();
  const signedOut = await store.signOut();
  resolveMe(makeMeResponse());
  const staleResult = await restoring;

  assert.equal(signedOut.state, 'signedOut');
  assert.equal(staleResult.state, 'signedOut', 'stale restore must return the newer state');
  assert.equal(__getSecureStore().has(RHYTHM_SESSION_SECURE_KEY), false);
  assert.equal(__getAsyncStorage().has(RHYTHM_ACCOUNT_META_KEY), false);
  console.log('  ✓ TEST 9: stale restore completion cannot overwrite sign-out');
}

// ---------------------------------------------------------------------------
// TEST 10: SecureStore read failure is actionable and never false signedOut
// ---------------------------------------------------------------------------

{
  __resetStores();
  __setSecureFailure('get', true);
  const store = new RhythmSessionStore({
    client: {
      request: async () => { throw new Error('must not request'); },
      requestPublic: async () => { throw new Error('must not request'); },
    },
  });
  const result = await store.restore();
  assert.equal(result.state, 'error');
  assert.equal(result.error?.kind, 'storage');
  console.log('  ✓ TEST 10: SecureStore failure surfaces bounded storage error');
}

// ---------------------------------------------------------------------------
// TEST 11: Normalized API errors remain distinguishable
// ---------------------------------------------------------------------------

{
  const cases = [
    [{ status: 0, code: 'NETWORK_ERROR', retryable: true }, 'offline', 'offline'],
    [{ status: 403, code: 'FORBIDDEN', retryable: false }, 'error', 'forbidden'],
    [{ status: 503, code: 'UNAVAILABLE', retryable: true }, 'error', 'server'],
    [{ status: 200, code: 'INVALID_JSON', retryable: false }, 'error', 'malformed'],
    [{ status: 0, code: 'TOKEN_UNAVAILABLE', retryable: true }, 'error', 'storage'],
  ];
  for (const [apiShape, expectedState, expectedKind] of cases) {
    __resetStores();
    __getSecureStore().set(RHYTHM_SESSION_SECURE_KEY, 'stored-token');
    const store = new RhythmSessionStore({
      client: {
        request: async () => {
          throw Object.assign(new Error('safe message'), apiShape, { source: 'cloud' });
        },
        requestPublic: async () => { throw new Error('must not request'); },
      },
    });
    const result = await store.restore();
    assert.equal(result.state, expectedState);
    assert.equal(result.error?.kind, expectedKind);
  }
  console.log('  ✓ TEST 11: offline, forbidden, server, and malformed errors stay distinct');
}

// ---------------------------------------------------------------------------
// TEST 12: Cloud logout failure cannot block local credential removal
// ---------------------------------------------------------------------------

{
  __resetStores();
  __getSecureStore().set(RHYTHM_SESSION_SECURE_KEY, 'offline-logout-token');
  const store = new RhythmSessionStore({
    client: {
      request: async () => { throw Object.assign(new Error('offline'), { status: 0, code: 'NETWORK_ERROR' }); },
      requestPublic: async () => { throw new Error('must not request'); },
    },
  });
  const result = await store.signOut();
  assert.equal(result.state, 'signedOut');
  assert.equal(__getSecureStore().has(RHYTHM_SESSION_SECURE_KEY), false);
  console.log('  ✓ TEST 12: offline cloud logout does not block local sign-out');
}

// ---------------------------------------------------------------------------
// TEST 13: Offline metadata preserves the real non-secret user ID
// ---------------------------------------------------------------------------

{
  __resetStores();
  __getSecureStore().set(RHYTHM_SESSION_SECURE_KEY, 'offline-token');
  __getAsyncStorage().set(
    RHYTHM_ACCOUNT_META_KEY,
    JSON.stringify({ id: 42, email: 'cached@example.com', name: 'Cached', photoUrl: null }),
  );
  const store = new RhythmSessionStore({
    client: {
      request: async () => { throw Object.assign(new Error('offline'), { status: 0, code: 'NETWORK_ERROR' }); },
      requestPublic: async () => { throw new Error('must not request'); },
    },
  });
  const result = await store.restore();
  assert.equal(result.user?.id, 42);
  console.log('  ✓ TEST 13: cached metadata retains real user ID without a sentinel');
}

// ---------------------------------------------------------------------------
// TEST 14: Metadata persistence failure rolls back the newly stored token
// ---------------------------------------------------------------------------

{
  __resetStores();
  __setAsyncFailure('set', true);
  const store = new RhythmSessionStore({
    client: {
      request: async () => { throw new Error('must not request'); },
      requestPublic: async () => makeExchangeResponse('rollback-token'),
    },
  });
  const error = await captureThrown(() => store.signIn({
    code: 'code', codeVerifier: 'verifier', redirectUri: 'uri', clientId: 'client',
  }));
  assert.ok(error);
  assert.equal(__getSecureStore().has(RHYTHM_SESSION_SECURE_KEY), false);
  assert.equal(await store.getState(), 'error');
  console.log('  ✓ TEST 14: failed metadata write rolls back SecureStore token');
}

// ---------------------------------------------------------------------------
// TEST 15: A hanging cloud logout cannot delay local sign-out completion
// ---------------------------------------------------------------------------

{
  __resetStores();
  __getSecureStore().set(RHYTHM_SESSION_SECURE_KEY, 'hanging-logout-token');
  const never = new Promise(() => undefined);
  const store = new RhythmSessionStore({
    client: {
      request: async () => never,
      requestWithToken: async () => never,
      requestPublic: async () => { throw new Error('must not request'); },
    },
  });
  const result = await Promise.race([
    store.signOut(),
    new Promise((resolve) => setTimeout(() => resolve('timed-out'), 25)),
  ]);
  assert.notEqual(result, 'timed-out', 'cloud logout must be detached from local sign-out');
  assert.equal(result.state, 'signedOut');
  console.log('  ✓ TEST 15: hanging cloud logout cannot delay local sign-out');
}

// ---------------------------------------------------------------------------
// TEST 16: SecureStore write failure is classified as persistence failure
// ---------------------------------------------------------------------------

{
  __resetStores();
  __setSecureFailure('set', true);
  const store = new RhythmSessionStore({
    client: {
      request: async () => { throw new Error('must not request'); },
      requestPublic: async () => makeExchangeResponse('unwritten-token'),
    },
  });
  const error = await captureThrown(() => store.signIn({
    code: 'code', codeVerifier: 'verifier', redirectUri: 'uri', clientId: 'client',
  }));
  assert.equal(error?.accountError?.kind, 'storage');
  assert.equal(await store.getState(), 'error');
  console.log('  ✓ TEST 16: SecureStore write failure remains a storage error');
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log('\nAll rhythm-account tests passed ✓');
