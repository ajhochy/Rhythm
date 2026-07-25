import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { OpencodeConnectionSettings } from '@/lib/opencode/client';
import {
  createCredentialWriteQueue,
  migrateLegacyConnectionPassword,
  parseStoredConnectionSettings,
  serializePublicConnectionSettings,
} from '@/lib/opencode/connection-persistence';
import { connectionCredentialStore } from '@/lib/security/connection-credential-store';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  CHAT_PREFERENCES_STORAGE_KEY,
  LAST_SESSION_BY_PROJECT_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from '@/lib/storage-keys';
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
}) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isConnectionPersistenceReady, setIsConnectionPersistenceReady] = useState(false);
  const credentialWriteQueueRef = useRef<ReturnType<typeof createCredentialWriteQueue> | null>(null);

  if (credentialWriteQueueRef.current === null) {
    credentialWriteQueueRef.current = createCredentialWriteQueue(
      (password) => connectionCredentialStore.setPassword(password),
      () => console.error('Connection credential could not be saved.'),
    );
  }
  const { directory, password, serverUrl, username } = settings;

  useEffect(() => {
    async function hydrateState() {
      try {
        await Promise.all([
          (async () => {
            try {
              const storedSettings = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
              const parsed = storedSettings
                ? parseStoredConnectionSettings(storedSettings)
                : { publicSettings: {} };
              const publicSettings = { ...defaultSettings, ...parsed.publicSettings };
              let securePassword: string | undefined;

              try {
                securePassword = await connectionCredentialStore.getPassword();
              } catch {
                setSettings(publicSettings);
                console.error('Connection credential could not be read.');
                return;
              }

              const password = securePassword ?? parsed.legacyPassword ?? '';
              if (parsed.legacyPassword) {
                try {
                  if (securePassword) {
                    await AsyncStorage.setItem(
                      SETTINGS_STORAGE_KEY,
                      serializePublicConnectionSettings(publicSettings),
                    );
                  } else {
                    await migrateLegacyConnectionPassword({
                      legacyPassword: parsed.legacyPassword,
                      writePassword: (legacyPassword) =>
                        connectionCredentialStore.setPassword(legacyPassword),
                      writePublicSettings: () =>
                        AsyncStorage.setItem(
                          SETTINGS_STORAGE_KEY,
                          serializePublicConnectionSettings(publicSettings),
                        ),
                    });
                  }
                } catch {
                  setSettings({ ...publicSettings, password });
                  console.error('Connection credential could not be migrated.');
                  return;
                }
              }

              setSettings({ ...publicSettings, password });
              setIsConnectionPersistenceReady(true);
            } catch {
              // Keep default connection settings when public storage is unavailable.
            }
          })(),
          (async () => {
            try {
              const storedChatPreferences = await AsyncStorage.getItem(CHAT_PREFERENCES_STORAGE_KEY);
              if (storedChatPreferences) {
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
              const storedActiveProjectPath = await AsyncStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
              if (storedActiveProjectPath) setActiveProjectPath(storedActiveProjectPath);
            } catch {
              // Keep the default active project.
            }
          })(),
          (async () => {
            try {
              const storedLastSessionByProject = await AsyncStorage.getItem(
                LAST_SESSION_BY_PROJECT_STORAGE_KEY,
              );
              if (storedLastSessionByProject) {
                setLastSessionByProject(JSON.parse(storedLastSessionByProject) as Record<string, string>);
              }
            } catch {
              // Keep the default session map.
            }
          })(),
        ]);
      } finally {
        setIsHydrated(true);
      }
    }

    void hydrateState();
  }, [defaultChatPreferences, defaultSettings, setActiveProjectPath, setChatPreferences, setLastSessionByProject, setSettings]);

  useEffect(() => {
    if (!isConnectionPersistenceReady) {
      return;
    }

    void AsyncStorage.setItem(
      SETTINGS_STORAGE_KEY,
      serializePublicConnectionSettings({ directory, serverUrl, username }),
    ).catch(() => console.error('Connection settings could not be saved.'));
  }, [directory, isConnectionPersistenceReady, serverUrl, username]);

  useEffect(() => {
    if (!isConnectionPersistenceReady) {
      return;
    }

    void credentialWriteQueueRef.current?.(password);
  }, [isConnectionPersistenceReady, password]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(CHAT_PREFERENCES_STORAGE_KEY, JSON.stringify(chatPreferences)).catch(() =>
      console.error('Chat preferences could not be saved.'),
    );
  }, [chatPreferences, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (activeProjectPath) {
      void AsyncStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectPath).catch(() =>
        console.error('Active project could not be saved.'),
      );
      return;
    }

    void AsyncStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY).catch(() =>
      console.error('Active project could not be saved.'),
    );
  }, [activeProjectPath, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void AsyncStorage.setItem(LAST_SESSION_BY_PROJECT_STORAGE_KEY, JSON.stringify(lastSessionByProject)).catch(
      () => console.error('Session history could not be saved.'),
    );
  }, [isHydrated, lastSessionByProject]);

  return { isHydrated };
}
