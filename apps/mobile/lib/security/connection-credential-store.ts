import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  createDirectMacStateManager,
  type DirectMacConnectionScope,
} from '@/lib/security/connection-account-scope';

const webPasswords = new Map<string, string>();

export const directMacStateManager = createDirectMacStateManager({
  publicStorage: AsyncStorage,
  secureStorage: {
    getItem: (key) => {
      if (Platform.OS === 'web') return Promise.resolve(webPasswords.get(key) ?? null);
      return SecureStore.getItemAsync(key);
    },
    setItem: async (key, value) => {
      if (Platform.OS === 'web') {
        webPasswords.set(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    removeItem: async (key) => {
      if (Platform.OS === 'web') {
        webPasswords.delete(key);
        return;
      }
      await SecureStore.deleteItemAsync(key);
    },
  },
  backgroundTasks: {
    unregister: async (name) => {
      if (
        Platform.OS !== 'web' &&
        await BackgroundTask.getStatusAsync() ===
          BackgroundTask.BackgroundTaskStatus.Available
      ) {
        await BackgroundTask.unregisterTaskAsync(name).catch(() => undefined);
      }
    },
  },
});

export async function purgeDirectMacStateForUser(accountUserId: number) {
  await directMacStateManager.purgeUser(accountUserId);
}

export const connectionCredentialStore = {
  async getPassword(scope: DirectMacConnectionScope) {
    return Platform.OS === 'web'
      ? webPasswords.get(scope.credentialKey)
      : directMacStateManager.readPassword(scope);
  },
  async setPassword(scope: DirectMacConnectionScope, password: string) {
    await directMacStateManager.writePassword(scope, password);
  },
  async clearPassword(scope: DirectMacConnectionScope) {
    await connectionCredentialStore.setPassword(scope, '');
  },
};
