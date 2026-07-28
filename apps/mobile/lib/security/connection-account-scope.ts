export const DIRECT_MAC_BACKGROUND_TASK_NAME =
  'opencode-chat-completion-monitor';

const DIRECT_MAC_REGISTRY_PREFIX = 'opencode-mobile.direct-mac-scopes';
const DIRECT_MAC_ACTIVE_SCOPE_PREFIX = 'opencode-mobile.direct-mac-active';
const DIRECT_MAC_SETTINGS_PREFIX = 'opencode-mobile.settings';
const DIRECT_MAC_CREDENTIAL_PREFIX = 'rhythm-agents.connection-password';
const DIRECT_MAC_NOTIFICATIONS_PREFIX =
  'opencode-mobile.pending-notification-sessions';
const DIRECT_MAC_CHAT_PREFERENCES_PREFIX =
  'opencode-mobile.chat-preferences';
const DIRECT_MAC_ACTIVE_PROJECT_PREFIX = 'opencode-mobile.active-project';
const DIRECT_MAC_LAST_SESSION_PREFIX =
  'opencode-mobile.last-session-by-project';
const LEGACY_UNSCOPED_PUBLIC_KEYS = [
  'opencode-mobile.settings',
  'opencode-mobile.pending-notification-sessions',
  'opencode-mobile.chat-preferences',
  'opencode-mobile.active-project',
  'opencode-mobile.last-session-by-project',
];
const LEGACY_UNSCOPED_CREDENTIAL_KEY =
  'rhythm-agents.connection-password';

export type DirectMacConnectionScope = {
  accountUserId: number;
  origin: string;
  registryKey: string;
  activeScopeKey: string;
  settingsKey: string;
  credentialKey: string;
  pendingNotificationsKey: string;
  chatPreferencesKey: string;
  activeProjectKey: string;
  lastSessionByProjectKey: string;
};

type PublicStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};

type SecureStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};

type BackgroundTasks = {
  unregister(name: string): Promise<unknown>;
};

export type DirectMacStateBoundaries = {
  publicStorage: PublicStorage;
  secureStorage: SecureStorage;
  backgroundTasks: BackgroundTasks;
};

export async function runPairedHostStateTransition<T>(
  action: () => Promise<T>,
  accountUserId: number,
  purge: (userId: number) => Promise<unknown>,
): Promise<T> {
  const result = await action();
  await purge(accountUserId);
  return result;
}

export function canWriteDirectMacCredential(
  scope: DirectMacConnectionScope,
  writableScopeKey: string | null,
): boolean {
  return writableScopeKey === scope.settingsKey;
}

function hashOrigin(origin: string): string {
  return Array.from(origin, (character) =>
    /^[A-Za-z0-9]$/.test(character)
      ? character
      : `_${character.codePointAt(0)?.toString(16) ?? '0'}_`,
  ).join('');
}

function validateAccountUserId(accountUserId: number): void {
  if (!Number.isSafeInteger(accountUserId) || accountUserId <= 0) {
    throw new Error('A signed-in Rhythm account is required.');
  }
}

export function createDirectMacConnectionScope(
  accountUserId: number,
  serverUrl: string,
): DirectMacConnectionScope {
  validateAccountUserId(accountUserId);
  const origin = new URL(serverUrl).origin;
  const segment = `account-${accountUserId}.origin-${hashOrigin(origin)}`;
  return {
    accountUserId,
    origin,
    registryKey: `${DIRECT_MAC_REGISTRY_PREFIX}.account-${accountUserId}`,
    activeScopeKey: `${DIRECT_MAC_ACTIVE_SCOPE_PREFIX}.account-${accountUserId}`,
    settingsKey: `${DIRECT_MAC_SETTINGS_PREFIX}.${segment}`,
    credentialKey: `${DIRECT_MAC_CREDENTIAL_PREFIX}.${segment}`,
    pendingNotificationsKey: `${DIRECT_MAC_NOTIFICATIONS_PREFIX}.${segment}`,
    chatPreferencesKey: `${DIRECT_MAC_CHAT_PREFERENCES_PREFIX}.${segment}`,
    activeProjectKey: `${DIRECT_MAC_ACTIVE_PROJECT_PREFIX}.${segment}`,
    lastSessionByProjectKey: `${DIRECT_MAC_LAST_SESSION_PREFIX}.${segment}`,
  };
}

function parseScopes(raw: string | null): DirectMacConnectionScope[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (scope): scope is DirectMacConnectionScope =>
        Boolean(scope) &&
        typeof scope === 'object' &&
        Number.isSafeInteger(
          (scope as DirectMacConnectionScope).accountUserId,
        ) &&
        typeof (scope as DirectMacConnectionScope).origin === 'string' &&
        typeof (scope as DirectMacConnectionScope).settingsKey === 'string' &&
        typeof (scope as DirectMacConnectionScope).credentialKey ===
          'string' &&
        typeof (scope as DirectMacConnectionScope).pendingNotificationsKey ===
          'string' &&
        typeof (scope as DirectMacConnectionScope).chatPreferencesKey ===
          'string' &&
        typeof (scope as DirectMacConnectionScope).activeProjectKey ===
          'string' &&
        typeof (scope as DirectMacConnectionScope).lastSessionByProjectKey ===
          'string',
    );
  } catch {
    return [];
  }
}

export function createDirectMacStateManager(
  boundaries: DirectMacStateBoundaries,
) {
  const accountQueues = new Map<number, Promise<unknown>>();
  const runSerialized = async <T>(
    accountUserId: number,
    action: () => Promise<T>,
  ): Promise<T> => {
    const previous = accountQueues.get(accountUserId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    accountQueues.set(accountUserId, current);
    try {
      return await current;
    } finally {
      if (accountQueues.get(accountUserId) === current) {
        accountQueues.delete(accountUserId);
      }
    }
  };

  const registerScope = async (scope: DirectMacConnectionScope) => {
    const existing = parseScopes(
      await boundaries.publicStorage.getItem(scope.registryKey),
    );
    const scopes = existing.filter(
      (candidate) =>
        candidate.credentialKey !== scope.credentialKey ||
        candidate.origin !== scope.origin,
    );
    scopes.push(scope);
    await boundaries.publicStorage.setItem(
      scope.registryKey,
      JSON.stringify(scopes),
    );
  };

  return {
    async purgeLegacyUnscopedState() {
      const operations: (() => Promise<unknown>)[] = [
        ...LEGACY_UNSCOPED_PUBLIC_KEYS.map(
          (key) => () => boundaries.publicStorage.removeItem(key),
        ),
        () =>
          boundaries.secureStorage.removeItem(
            LEGACY_UNSCOPED_CREDENTIAL_KEY,
          ),
      ];
      const results = await Promise.allSettled(
        operations.map((operation) => Promise.resolve().then(operation)),
      );
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          `Legacy Direct-Mac cleanup encountered ${errors.length} storage errors.`,
        );
      }
    },

    async getActiveScope(accountUserId: number) {
      validateAccountUserId(accountUserId);
      const raw = await boundaries.publicStorage.getItem(
        `${DIRECT_MAC_ACTIVE_SCOPE_PREFIX}.account-${accountUserId}`,
      );
      return parseScopes(raw ? `[${raw}]` : null)[0] ?? null;
    },

    async selectActiveScope(scope: DirectMacConnectionScope) {
      await runSerialized(scope.accountUserId, async () => {
        await registerScope(scope);
        await boundaries.publicStorage.setItem(
          scope.activeScopeKey,
          JSON.stringify(scope),
        );
      });
    },

    async writeConnection(
      scope: DirectMacConnectionScope,
      value: { password: string; publicSettings: string },
    ) {
      await runSerialized(scope.accountUserId, async () => {
        await registerScope(scope);
        if (value.password) {
          await boundaries.secureStorage.setItem(
            scope.credentialKey,
            value.password,
          );
        } else {
          await boundaries.secureStorage.removeItem(scope.credentialKey);
        }
        await boundaries.publicStorage.setItem(
          scope.settingsKey,
          value.publicSettings,
        );
      });
    },

    async writePassword(scope: DirectMacConnectionScope, password: string) {
      await runSerialized(scope.accountUserId, async () => {
        await registerScope(scope);
        if (password) {
          await boundaries.secureStorage.setItem(scope.credentialKey, password);
        } else {
          await boundaries.secureStorage.removeItem(scope.credentialKey);
        }
      });
    },

    async writePublicSettings(
      scope: DirectMacConnectionScope,
      publicSettings: string,
    ) {
      await runSerialized(scope.accountUserId, async () => {
        await registerScope(scope);
        await boundaries.publicStorage.setItem(
          scope.settingsKey,
          publicSettings,
        );
      });
    },

    async readPassword(scope: DirectMacConnectionScope) {
      return (
        (await boundaries.secureStorage.getItem(scope.credentialKey)) ??
        undefined
      );
    },

    async readPublicSettings(scope: DirectMacConnectionScope) {
      return boundaries.publicStorage.getItem(scope.settingsKey);
    },

    async readAuxiliaryState(scope: DirectMacConnectionScope) {
      const [chatPreferences, activeProject, lastSessionByProject] =
        await Promise.all([
          boundaries.publicStorage.getItem(scope.chatPreferencesKey),
          boundaries.publicStorage.getItem(scope.activeProjectKey),
          boundaries.publicStorage.getItem(scope.lastSessionByProjectKey),
        ]);
      return { chatPreferences, activeProject, lastSessionByProject };
    },

    async writeAuxiliaryValue(
      scope: DirectMacConnectionScope,
      key: 'chatPreferencesKey' | 'activeProjectKey' | 'lastSessionByProjectKey',
      value: string | null,
    ) {
      await runSerialized(scope.accountUserId, async () => {
        await registerScope(scope);
        if (value === null) {
          await boundaries.publicStorage.removeItem(scope[key]);
        } else {
          await boundaries.publicStorage.setItem(scope[key], value);
        }
      });
    },

    async writePendingNotifications(
      scope: DirectMacConnectionScope,
      serialized: string | null,
    ) {
      await runSerialized(scope.accountUserId, async () => {
        await registerScope(scope);
        if (serialized == null) {
          await boundaries.publicStorage.removeItem(
            scope.pendingNotificationsKey,
          );
        } else {
          await boundaries.publicStorage.setItem(
            scope.pendingNotificationsKey,
            serialized,
          );
        }
      });
    },

    async readPendingNotifications(scope: DirectMacConnectionScope) {
      return boundaries.publicStorage.getItem(
        scope.pendingNotificationsKey,
      );
    },

    async purgeUser(accountUserId: number) {
      validateAccountUserId(accountUserId);
      await runSerialized(accountUserId, async () => {
        const registryKey = `${DIRECT_MAC_REGISTRY_PREFIX}.account-${accountUserId}`;
        const activeScopeKey = `${DIRECT_MAC_ACTIVE_SCOPE_PREFIX}.account-${accountUserId}`;
        const errors: unknown[] = [];
        let scopes: DirectMacConnectionScope[] = [];
        try {
          scopes = parseScopes(
            await boundaries.publicStorage.getItem(registryKey),
          );
        } catch (error) {
          errors.push(error);
        }
        const operations: (() => Promise<unknown>)[] = [
          ...scopes.flatMap((scope) => [
            () =>
              boundaries.secureStorage.removeItem(scope.credentialKey),
            () => boundaries.publicStorage.removeItem(scope.settingsKey),
            () =>
              boundaries.publicStorage.removeItem(
                scope.pendingNotificationsKey,
              ),
            () =>
              boundaries.publicStorage.removeItem(
                scope.chatPreferencesKey,
              ),
            () =>
              boundaries.publicStorage.removeItem(scope.activeProjectKey),
            () =>
              boundaries.publicStorage.removeItem(
                scope.lastSessionByProjectKey,
              ),
          ]),
          () => boundaries.publicStorage.removeItem(registryKey),
          () => boundaries.publicStorage.removeItem(activeScopeKey),
          () =>
            boundaries.backgroundTasks.unregister(
              DIRECT_MAC_BACKGROUND_TASK_NAME,
            ),
        ];
        const results = await Promise.allSettled(
          operations.map((operation) =>
            Promise.resolve().then(operation),
          ),
        );
        for (const result of results) {
          if (result.status === 'rejected') errors.push(result.reason);
        }
        if (errors.length > 0) {
          throw new AggregateError(
            errors,
            `Direct-Mac cleanup encountered ${errors.length} storage errors.`,
          );
        }
      });
    },
  };
}
