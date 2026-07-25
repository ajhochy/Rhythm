import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { CONNECTION_PASSWORD_KEY } from '@/lib/storage-keys';

let webPassword: string | undefined;

export const connectionCredentialStore = {
  async getPassword() {
    return Platform.OS === 'web'
      ? webPassword
      : (await SecureStore.getItemAsync(CONNECTION_PASSWORD_KEY)) ?? undefined;
  },
  async setPassword(password: string) {
    if (Platform.OS === 'web') {
      webPassword = password || undefined;
      return;
    }
    if (password) {
      await SecureStore.setItemAsync(CONNECTION_PASSWORD_KEY, password, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } else {
      await SecureStore.deleteItemAsync(CONNECTION_PASSWORD_KEY);
    }
  },
  async clearPassword() {
    await connectionCredentialStore.setPassword('');
  },
};
