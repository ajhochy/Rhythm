import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import {
  migrateLegacyConnectionPassword,
  parseStoredConnectionSettings,
  serializePublicConnectionSettings,
} from '@/lib/opencode/connection-persistence';
import {
  canWriteDirectMacCredential,
  createDirectMacConnectionScope,
  type DirectMacConnectionScope,
} from '@/lib/security/connection-account-scope';
import {
  connectionCredentialStore,
  directMacStateManager,
} from '@/lib/security/connection-credential-store';
import type { ChatPreferences } from '@/providers/opencode-provider-utils';

export function useOpencodePersistence({
  defaultChatPreferences,
  defaultSettings,
  activeProjectPath,
  chatPreferences,
  lastSessionByProject,
  setActiveProjectPath,
  setChatPreferences,
  setLastSessionByProject,
  setSettings,
  settings,
  accountUserId,
}: {
  defaultChatPreferences: ChatPreferences;
  defaultSettings: OpencodeConnectionSettings;
  activeProjectPath?: string;
  chatPreferences: ChatPreferences;
  lastSessionByProject: Record<string, string>;
  setActiveProjectPath: (value?: string) => void;
  setChatPreferences: Dispatch<SetStateAction<ChatPreferences>>;
  setLastSessionByProject: Dispatch<SetStateAction<Record<string, string>>>;
  setSettings: Dispatch<SetStateAction<OpencodeConnectionSettings>>;
  settings: OpencodeConnectionSettings;
  accountUserId: number | null;
}) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isConnectionPersistenceReady, setIsConnectionPersistenceReady] = useState(false);
  const [hydratedAccountUserId, setHydratedAccountUserId] =
    useState<number | null>(null);
  const [connectionScope, setConnectionScope] =
    useState<DirectMacConnectionScope | null>(null);
  const [writableAuxiliaryScopeKey, setWritableAuxiliaryScopeKey] =
    useState<string | null>(null);
  const [writableCredentialScopeKey, setWritableCredentialScopeKey] =
    useState<string | null>(null);
  const hydrationGenerationRef = useRef(0);
  const auxiliaryGenerationRef = useRef(0);
  const { directory, password, serverUrl, username } = settings;

  useEffect(() => {
    async function hydrateState() {
      const generation = ++hydrationGenerationRef.current;
      let hydratedScope: DirectMacConnectionScope | null = null;
      try {
        if (accountUserId === null) {
          auxiliaryGenerationRef.current += 1;
          setWritableAuxiliaryScopeKey(null);
          setWritableCredentialScopeKey(null);
          setConnectionScope(null);
          setHydratedAccountUserId(null);
          setSettings(defaultSettings);
          setChatPreferences(defaultChatPreferences);
          setActiveProjectPath(undefined);
          setLastSessionByProject({});
          setIsConnectionPersistenceReady(false);
          return;
        }
        setHydratedAccountUserId(null);
        setIsConnectionPersistenceReady(false);
        await directMacStateManager.purgeLegacyUnscopedState();
        const activeScope =
          await directMacStateManager.getActiveScope(accountUserId);
        const fallbackScope = createDirectMacConnectionScope(
          accountUserId,
          defaultSettings.serverUrl,
        );
        const scope = activeScope ?? fallbackScope;
        hydratedScope = scope;
        await directMacStateManager.selectActiveScope(scope);
        const auxiliaryState =
          await directMacStateManager.readAuxiliaryState(scope);
        setWritableAuxiliaryScopeKey(null);
        setWritableCredentialScopeKey(null);
        setChatPreferences(defaultChatPreferences);
        setActiveProjectPath(undefined);
        setLastSessionByProject({});
        setConnectionScope(scope);
        await Promise.all([
          (async () => {
            try {
              const storedSettings =
                await directMacStateManager.readPublicSettings(scope);
              const parsed = storedSettings
                ? parseStoredConnectionSettings(storedSettings)
                : { publicSettings: {} };
              const publicSettings = { ...defaultSettings, ...parsed.publicSettings };
              let securePassword: string | undefined;

              try {
                securePassword =
                  await connectionCredentialStore.getPassword(scope);
              } catch {
                if (generation !== hydrationGenerationRef.current) return;
                setSettings(publicSettings);
                console.error('Connection credential could not be read.');
                return;
              }

              const password = securePassword ?? parsed.legacyPassword ?? '';
              if (parsed.legacyPassword) {
                try {
                  if (securePassword) {
                    await directMacStateManager.writePublicSettings(
                      scope,
                      serializePublicConnectionSettings(publicSettings),
                    );
                  } else {
                    await migrateLegacyConnectionPassword({
                      legacyPassword: parsed.legacyPassword,
                      writePassword: (legacyPassword) =>
                        connectionCredentialStore.setPassword(
                          scope,
                          legacyPassword,
                        ),
                      writePublicSettings: () =>
                        directMacStateManager.writePublicSettings(
                          scope,
                          serializePublicConnectionSettings(publicSettings),
                        ),
                    });
                  }
                } catch {
                  if (generation !== hydrationGenerationRef.current) return;
                  setSettings({ ...publicSettings, password });
                  console.error('Connection credential could not be migrated.');
                  return;
                }
              }

              if (generation !== hydrationGenerationRef.current) return;
              setSettings({ ...publicSettings, password });
              setHydratedAccountUserId(accountUserId);
              setIsConnectionPersistenceReady(true);
            } catch {
              // Keep default connection settings when public storage is unavailable.
            }
          })(),
          (async () => {
            try {
              const storedChatPreferences = auxiliaryState.chatPreferences;
              if (storedChatPreferences) {
                if (generation !== hydrationGenerationRef.current) return;
                const parsed = JSON.parse(storedChatPreferences) as Partial<ChatPreferences>;
                setChatPreferences((current) => ({
                  ...defaultChatPreferences,
                  ...current,
                  ...parsed,
                }));
              }
            } catch {
              // Keep default chat preferences.
            }
          })(),
          (async () => {
            try {
              const storedActiveProjectPath = auxiliaryState.activeProject;
              if (generation !== hydrationGenerationRef.current) return;
              if (storedActiveProjectPath) setActiveProjectPath(storedActiveProjectPath);
            } catch {
              // Keep the default active project.
            }
          })(),
          (async () => {
            try {
              const storedLastSessionByProject =
                auxiliaryState.lastSessionByProject;
              if (storedLastSessionByProject) {
                if (generation !== hydrationGenerationRef.current) return;
                setLastSessionByProject(JSON.parse(storedLastSessionByProject) as Record<string, string>);
              }
            } catch {
              // Keep the default session map.
            }
          })(),
        ]);
      } finally {
        if (generation === hydrationGenerationRef.current) {
          setWritableAuxiliaryScopeKey(hydratedScope?.settingsKey ?? null);
          setWritableCredentialScopeKey(hydratedScope?.settingsKey ?? null);
          setIsHydrated(true);
        }
      }
    }

    void hydrateState();
    return () => {
      hydrationGenerationRef.current += 1;
    };
  }, [accountUserId, defaultChatPreferences, defaultSettings, setActiveProjectPath, setChatPreferences, setLastSessionByProject, setSettings]);

  useEffect(() => {
    if (!isConnectionPersistenceReady) {
      return;
    }

    if (
      accountUserId === null ||
      hydratedAccountUserId !== accountUserId
    ) return;
    const scope = createDirectMacConnectionScope(accountUserId, serverUrl);
    void directMacStateManager.writePublicSettings(
      scope,
      serializePublicConnectionSettings({ directory, serverUrl, username }),
    ).catch(() => console.error('Connection settings could not be saved.'));
    if (connectionScope?.settingsKey !== scope.settingsKey) {
      const generation = ++auxiliaryGenerationRef.current;
      setWritableAuxiliaryScopeKey(null);
      setWritableCredentialScopeKey(null);
      setConnectionScope(scope);
      setChatPreferences(defaultChatPreferences);
      setActiveProjectPath(undefined);
      setLastSessionByProject({});
      void directMacStateManager.selectActiveScope(scope).then(() =>
        Promise.allSettled([
          directMacStateManager.readAuxiliaryState(scope),
          connectionCredentialStore.getPassword(scope),
        ]),
      ).then(([storedResult, passwordResult]) => {
        if (generation !== auxiliaryGenerationRef.current) return;
        const stored =
          storedResult.status === 'fulfilled'
            ? storedResult.value
            : {
                chatPreferences: null,
                activeProject: null,
                lastSessionByProject: null,
              };
        if (passwordResult.status === 'fulfilled') {
          setSettings((current) => ({
            ...current,
            password: passwordResult.value ?? '',
          }));
          setWritableCredentialScopeKey(scope.settingsKey);
        } else {
          setSettings((current) => ({ ...current, password: '' }));
          console.error('Connection credential could not be read.');
        }
        if (stored.chatPreferences) {
          setChatPreferences({
            ...defaultChatPreferences,
            ...JSON.parse(stored.chatPreferences) as Partial<ChatPreferences>,
          });
        }
        if (stored.activeProject) setActiveProjectPath(stored.activeProject);
        if (stored.lastSessionByProject) {
          setLastSessionByProject(
            JSON.parse(stored.lastSessionByProject) as Record<string, string>,
          );
        }
        setWritableAuxiliaryScopeKey(scope.settingsKey);
      });
    }
  }, [accountUserId, connectionScope?.settingsKey, defaultChatPreferences, directory, hydratedAccountUserId, isConnectionPersistenceReady, serverUrl, setActiveProjectPath, setChatPreferences, setLastSessionByProject, setSettings, username]);

  useEffect(() => {
    if (!isConnectionPersistenceReady) {
      return;
    }

    if (
      accountUserId === null ||
      hydratedAccountUserId !== accountUserId
    ) return;
    const scope = createDirectMacConnectionScope(accountUserId, serverUrl);
    if (!canWriteDirectMacCredential(scope, writableCredentialScopeKey)) {
      return;
    }
    void connectionCredentialStore.setPassword(scope, password).catch(() =>
      console.error('Connection credential could not be saved.'),
    );
  }, [accountUserId, hydratedAccountUserId, isConnectionPersistenceReady, password, serverUrl, writableCredentialScopeKey]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (
      !connectionScope ||
      writableAuxiliaryScopeKey !== connectionScope.settingsKey
    ) return;
    void directMacStateManager.writeAuxiliaryValue(
      connectionScope,
      'chatPreferencesKey',
      JSON.stringify(chatPreferences),
    ).catch(() =>
      console.error('Chat preferences could not be saved.'),
    );
  }, [chatPreferences, connectionScope, isHydrated, writableAuxiliaryScopeKey]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (
      !connectionScope ||
      writableAuxiliaryScopeKey !== connectionScope.settingsKey
    ) return;
    if (activeProjectPath) {
      void directMacStateManager.writeAuxiliaryValue(
        connectionScope,
        'activeProjectKey',
        activeProjectPath,
      ).catch(() =>
        console.error('Active project could not be saved.'),
      );
      return;
    }

    void directMacStateManager.writeAuxiliaryValue(
      connectionScope,
      'activeProjectKey',
      null,
    ).catch(() =>
      console.error('Active project could not be saved.'),
    );
  }, [activeProjectPath, connectionScope, isHydrated, writableAuxiliaryScopeKey]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (
      !connectionScope ||
      writableAuxiliaryScopeKey !== connectionScope.settingsKey
    ) return;
    void directMacStateManager.writeAuxiliaryValue(
      connectionScope,
      'lastSessionByProjectKey',
      JSON.stringify(lastSessionByProject),
    ).catch(
      () => console.error('Session history could not be saved.'),
    );
  }, [connectionScope, isHydrated, lastSessionByProject, writableAuxiliaryScopeKey]);

  return { isHydrated };
}
