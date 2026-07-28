import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const scopeSource = await readFile(
  new URL('../../lib/security/connection-account-scope.ts', import.meta.url),
  'utf8',
).catch(() => '');
const scopeModule = scopeSource
  ? await import(`data:text/javascript,${encodeURIComponent(ts.transpileModule(scopeSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText)}`)
  : {};
const credentialSource = await readFile(
  new URL('../../lib/security/connection-credential-store.ts', import.meta.url),
  'utf8',
);
const persistenceSource = await readFile(
  new URL('../../providers/use-opencode-persistence.ts', import.meta.url),
  'utf8',
);
const sessionSource = await readFile(
  new URL('../../lib/auth/rhythm-session-store.ts', import.meta.url),
  'utf8',
);
const sessionModule = await import(
  `data:text/javascript,${encodeURIComponent(ts.transpileModule(
    sessionSource.replace(
      /^import\b[\s\S]*?from\s+['"][^'"]+['"]\s*;?\n?/gm,
      '',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText)}`
);
const pairedProviderSource = await readFile(
  new URL('../../providers/paired-host-provider.tsx', import.meta.url),
  'utf8',
);
const notificationSource = await readFile(
  new URL('../../lib/notifications.ts', import.meta.url),
  'utf8',
);

function createBoundaries() {
  const publicValues = new Map();
  const secureValues = new Map();
  const unregistered = [];
  return {
    publicValues,
    secureValues,
    unregistered,
    boundaries: {
      publicStorage: {
        getItem: async (key) => publicValues.get(key) ?? null,
        setItem: async (key, value) => void publicValues.set(key, value),
        removeItem: async (key) => void publicValues.delete(key),
      },
      secureStorage: {
        getItem: async (key) => secureValues.get(key) ?? null,
        setItem: async (key, value) => void secureValues.set(key, value),
        removeItem: async (key) => void secureValues.delete(key),
      },
      backgroundTasks: {
        unregister: async (name) => void unregistered.push(name),
      },
    },
  };
}

test('issue-1224-c1: direct-Mac storage keys include account and origin scope', async () => {
  // Regression caught: a single global SecureStore/AsyncStorage key lets the
  // next signed-in account inherit the previous account's Mac connection.
  const createScope = scopeModule.createDirectMacConnectionScope;
  assert.equal(typeof createScope, 'function');
  const aOne = createScope(101, 'https://one.tailnet.ts.net/path');
  const aTwo = createScope(101, 'https://two.tailnet.ts.net');
  const bOne = createScope(202, 'https://one.tailnet.ts.net');
  assert.notEqual(aOne.credentialKey, aTwo.credentialKey);
  assert.notEqual(aOne.credentialKey, bOne.credentialKey);
  assert.notEqual(aOne.settingsKey, bOne.settingsKey);
  assert.notEqual(aOne.pendingNotificationsKey, bOne.pendingNotificationsKey);
  assert.notEqual(aOne.activeProjectKey, bOne.activeProjectKey);
  assert.notEqual(aOne.lastSessionByProjectKey, bOne.lastSessionByProjectKey);
  assert.equal(aOne.origin, 'https://one.tailnet.ts.net');
});

test('issue-1224-c2: sign-out purges all direct-Mac state for the departing account', async () => {
  // Regression caught: deleting only the cloud token leaves direct-Mac
  // credentials and polling jobs active after explicit sign-out.
  const createManager = scopeModule.createDirectMacStateManager;
  assert.equal(typeof createManager, 'function');
  const fake = createBoundaries();
  const manager = createManager(fake.boundaries);
  const scope = scopeModule.createDirectMacConnectionScope(101, 'https://one.tailnet.ts.net');
  await manager.writeConnection(scope, {
    password: 'account-a-secret',
    publicSettings: '{"serverUrl":"https://one.tailnet.ts.net"}',
  });
  await manager.writePendingNotifications(scope, '{"session-a":{}}');
  fake.publicValues.set(scope.activeProjectKey, '/account-a/project');
  fake.publicValues.set(scope.lastSessionByProjectKey, '{"project":"session"}');
  await manager.purgeUser(101);
  assert.equal(fake.secureValues.has(scope.credentialKey), false);
  assert.equal(fake.publicValues.has(scope.settingsKey), false);
  assert.equal(fake.publicValues.has(scope.pendingNotificationsKey), false);
  assert.equal(fake.publicValues.has(scope.activeProjectKey), false);
  assert.equal(fake.publicValues.has(scope.lastSessionByProjectKey), false);
  assert.deepEqual(fake.unregistered, ['opencode-chat-completion-monitor']);
  const purged = [];
  await sessionModule.runSignOutDirectMacCleanup(
    101,
    async (userId) => void purged.push(userId),
  );
  assert.deepEqual(purged, [101]);

  const cleanupEvents = [];
  const cleanupResult = await sessionModule.clearDepartingAccountState?.({
    departingUserId: 101,
    purge: async () => {
      cleanupEvents.push('purge-attempted');
      throw new Error('secure deletion failed');
    },
    removeAccountMeta: async () => {
      cleanupEvents.push('meta-removed');
    },
    report: (message) => cleanupEvents.push(message),
  });
  assert.deepEqual(cleanupEvents, [
    'purge-attempted',
    'meta-removed',
    'Departing account cleanup encountered 1 storage error.',
  ]);
  assert.equal(cleanupResult?.errorCount, 1);
});

test('issue-1224-c3: pairing replacement and revocation purge superseded direct-Mac state', async () => {
  // Regression caught: replacing/revoking a Mac leaves its Basic-auth
  // credential and queued notification polling available on the device.
  const fake = createBoundaries();
  const manager = scopeModule.createDirectMacStateManager(fake.boundaries);
  const oldScope = scopeModule.createDirectMacConnectionScope(101, 'https://old.tailnet.ts.net');
  await manager.writeConnection(oldScope, {
    password: 'superseded-secret',
    publicSettings: '{"serverUrl":"https://old.tailnet.ts.net"}',
  });
  await manager.writePendingNotifications(oldScope, '{"session-old":{}}');
  await manager.purgeUser(101);
  assert.equal(await manager.readPassword(oldScope), undefined);
  assert.equal(await manager.readPublicSettings(oldScope), null);
  assert.equal(await manager.readPendingNotifications(oldScope), null);
  const order = [];
  const result = await scopeModule.runPairedHostStateTransition(
    async () => {
      order.push('pair-or-revoke');
      return 'connected';
    },
    101,
    async (userId) => void order.push(`purge-${userId}`),
  );
  assert.equal(result, 'connected');
  assert.deepEqual(order, ['pair-or-revoke', 'purge-101']);
  assert.match(pairedProviderSource, /runPairedHostStateTransition/);
});

test('issue-1224-c4: account B cannot resolve account A connection state', async () => {
  // Regression caught: account and origin are omitted from derived storage
  // keys, so two accounts resolve the same persisted connection.
  const fake = createBoundaries();
  const manager = scopeModule.createDirectMacStateManager(fake.boundaries);
  const accountA = scopeModule.createDirectMacConnectionScope(101, 'https://one.tailnet.ts.net');
  const accountB = scopeModule.createDirectMacConnectionScope(202, 'https://one.tailnet.ts.net');
  await manager.writeConnection(accountA, {
    password: 'account-a-secret',
    publicSettings: '{"serverUrl":"https://one.tailnet.ts.net","username":"a"}',
  });
  assert.equal(
    scopeModule.canWriteDirectMacCredential(
      accountB,
      accountA.settingsKey,
    ),
    false,
  );
  await manager.writeAuxiliaryValue(
    accountA,
    'chatPreferencesKey',
    '{"modelId":"account-a-model"}',
  );
  await manager.writeAuxiliaryValue(
    accountA,
    'activeProjectKey',
    '/account-a/project',
  );
  await manager.writeAuxiliaryValue(
    accountA,
    'lastSessionByProjectKey',
    '{"/account-a/project":"session-a"}',
  );
  assert.equal(await manager.readPassword(accountB), undefined);
  assert.equal(await manager.readPublicSettings(accountB), null);
  assert.deepEqual(await manager.readAuxiliaryState(accountB), {
    chatPreferences: null,
    activeProject: null,
    lastSessionByProject: null,
  });
  fake.publicValues.set('opencode-mobile.settings', '{"password":"legacy"}');
  fake.publicValues.set('opencode-mobile.active-project', '/legacy');
  fake.secureValues.set('rhythm-agents.connection-password', 'legacy-secret');
  await manager.purgeLegacyUnscopedState();
  assert.equal(fake.publicValues.has('opencode-mobile.settings'), false);
  assert.equal(fake.publicValues.has('opencode-mobile.active-project'), false);
  assert.equal(
    fake.secureValues.has('rhythm-agents.connection-password'),
    false,
  );
  assert.match(credentialSource, /scope\.credentialKey/);
  assert.match(persistenceSource, /accountUserId/);
  assert.match(
    persistenceSource,
    /writableAuxiliaryScopeKey !== connectionScope\.settingsKey/,
  );
  assert.match(
    persistenceSource,
    /canWriteDirectMacCredential\(scope, writableCredentialScopeKey\)/,
  );
  assert.match(notificationSource, /writePendingNotifications\(scope/);
});

test('issue-1224-c5: token loss and authentication expiry revoke background authorization', () => {
  // Regression caught: restore/refresh/401 clears only the token, leaving
  // account metadata that authorizes the background task to poll old hosts.
  assert.match(sessionSource, /clearDepartingAccountState/);
  assert.match(
    sessionSource,
    /if \(!token\)[\s\S]*?clearDepartingAccountState/,
  );
  assert.match(
    sessionSource,
    /classified\.kind === 'authentication'[\s\S]*?clearDepartingAccountState/,
  );
  const output = execFileSync(
    process.execPath,
    [new URL('../rhythm-account.test.mjs', import.meta.url).pathname],
    { encoding: 'utf8' },
  );
  assert.match(output, /TEST 23: tokenless restore revokes stale account background scope/);
  assert.match(output, /TEST 24: 401 expiry revokes stale account background scope/);
  assert.match(output, /TEST 25: purge failure still removes background account authorization/);
});

test('issue-1224-c6: purge attempts every cleanup even when individual boundaries fail', async () => {
  // Regression caught: Promise.all rejection skips registry removal and task
  // unregister, so stale metadata can continue authorizing background work.
  const attempted = [];
  const fake = createBoundaries();
  const manager = scopeModule.createDirectMacStateManager({
    publicStorage: {
      ...fake.boundaries.publicStorage,
      removeItem: async (key) => {
        attempted.push(`public:${key}`);
        if (key.includes('.settings.')) throw new Error('settings failed');
        fake.publicValues.delete(key);
      },
    },
    secureStorage: {
      ...fake.boundaries.secureStorage,
      removeItem: async (key) => {
        attempted.push(`secure:${key}`);
        throw new Error('secure failed');
      },
    },
    backgroundTasks: {
      unregister: async (name) => {
        attempted.push(`background:${name}`);
        throw new Error('unregister failed');
      },
    },
  });
  const scope = scopeModule.createDirectMacConnectionScope(
    101,
    'https://one.tailnet.ts.net',
  );
  await manager.writeConnection(scope, {
    password: 'secret',
    publicSettings: '{}',
  });
  await assert.rejects(() => manager.purgeUser(101), AggregateError);
  assert.ok(attempted.includes(`secure:${scope.credentialKey}`));
  assert.ok(attempted.includes(`public:${scope.settingsKey}`));
  assert.ok(attempted.includes(`public:${scope.registryKey}`));
  assert.ok(
    attempted.includes(
      `background:${scopeModule.DIRECT_MAC_BACKGROUND_TASK_NAME}`,
    ),
  );
});

test('issue-1224-c7: notification completion clears the originating scope after A to B switch', async () => {
  // Regression caught: completion resolves the currently active B scope and
  // leaves A's pending session behind forever.
  const pendingModuleSource = await readFile(
    new URL('../../lib/pending-notification-state.ts', import.meta.url),
    'utf8',
  ).catch(() => '');
  const pendingModule = pendingModuleSource
    ? await import(`data:text/javascript,${encodeURIComponent(ts.transpileModule(
        pendingModuleSource,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        },
      ).outputText)}`)
    : {};
  assert.equal(typeof pendingModule.clearPendingSessionInScope, 'function');
  const accountA = scopeModule.createDirectMacConnectionScope(
    101,
    'https://a.tailnet.ts.net',
  );
  const accountB = scopeModule.createDirectMacConnectionScope(
    101,
    'https://b.tailnet.ts.net',
  );
  const byScope = new Map([
    [accountA.pendingNotificationsKey, { session: { sessionId: 'session' } }],
    [accountB.pendingNotificationsKey, { other: { sessionId: 'other' } }],
  ]);
  await pendingModule.clearPendingSessionInScope({
    scope: accountA,
    sessionId: 'session',
    read: async (scope) => byScope.get(scope.pendingNotificationsKey) ?? {},
    write: async (scope, value) => {
      byScope.set(scope.pendingNotificationsKey, value);
    },
  });
  assert.deepEqual(byScope.get(accountA.pendingNotificationsKey), {});
  assert.deepEqual(byScope.get(accountB.pendingNotificationsKey), {
    other: { sessionId: 'other' },
  });
  const opencodeProviderSource = await readFile(
    new URL('../../providers/opencode-provider.tsx', import.meta.url),
    'utf8',
  );
  assert.match(opencodeProviderSource, /pendingNotificationOriginBySessionIdRef/);
  assert.match(opencodeProviderSource, /clearTrackedPendingNotification/);
});

test('issue-1224-c8: stale writes cannot replace explicitly selected active origin', async () => {
  // Regression caught: delayed session/polling writes call registerScope and
  // silently move active origin from B back to stale A.
  const fake = createBoundaries();
  const manager = scopeModule.createDirectMacStateManager(fake.boundaries);
  const accountA = scopeModule.createDirectMacConnectionScope(
    101,
    'https://a.tailnet.ts.net',
  );
  const accountB = scopeModule.createDirectMacConnectionScope(
    101,
    'https://b.tailnet.ts.net',
  );
  assert.equal(typeof manager.selectActiveScope, 'function');
  await manager.selectActiveScope(accountB);
  await manager.writePendingNotifications(accountA, '{"stale":{}}');
  assert.equal(
    (await manager.getActiveScope(101))?.settingsKey,
    accountB.settingsKey,
  );
});
