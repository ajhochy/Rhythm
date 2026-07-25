import Constants from 'expo-constants';

import {
  RHYTHM_SESSION_SECURE_KEY,
  type RhythmUser,
} from '@/lib/auth/rhythm-session-store';
import {
  PAIRED_DEVICE_SECURE_KEY,
  PairedHostStore,
} from '@/lib/pairing/paired-host-store';
import {
  RhythmToolsService,
  type ToolRequestInit,
  type ToolTransport,
} from '@/providers/services/rhythm-tools-service';
import type { ActivityTransport } from '@/providers/services/activity-service';

import type { MobileRuntimeVariant } from './mobile-runtime-types';

const configuredServerUrl =
  typeof Constants.expoConfig?.extra?.e2eServerUrl === 'string'
    ? Constants.expoConfig.extra.e2eServerUrl.replace(/\/$/, '')
    : null;

if (!configuredServerUrl) {
  throw new Error('The E2E runtime requires EXPO_PUBLIC_E2E_SERVER_URL.');
}

function serverUrl(): string {
  return configuredServerUrl!;
}

const credentials = new Map<string, string>([
  [RHYTHM_SESSION_SECURE_KEY, 'e2e-cloud-session'],
]);

const accountUser: RhythmUser = {
  id: 7,
  email: 'mobile-e2e@example.com',
  name: 'Mobile E2E',
  photoUrl: null,
};

function createPairedHostStore(): PairedHostStore {
  const storageFailures = async () => {
    const response = await fetch(
      `${serverUrl()}/__control/mobile-storage-failure`,
    );
    if (!response.ok) return { write: false, cleanup: false };
    const value = (await response.json()) as {
      enabled?: boolean;
      write?: boolean;
      cleanup?: boolean;
    };
    return {
      write: value.write ?? value.enabled === true,
      cleanup: value.cleanup ?? value.enabled === true,
    };
  };

  return new PairedHostStore({
    getCredential: async (key) => credentials.get(key) ?? null,
    setCredential: async (key, value) => {
      const failures = await storageFailures();
      if (
        key === PAIRED_DEVICE_SECURE_KEY &&
        (value ? failures.write : failures.cleanup)
      ) {
        throw new Error('E2E secure storage write failure');
      }
      credentials.set(key, value);
    },
    deleteCredential: async (key) => {
      const failures = await storageFailures();
      if (key === PAIRED_DEVICE_SECURE_KEY && failures.cleanup) {
        throw new Error('E2E secure storage delete failure');
      }
      credentials.delete(key);
    },
    resolveGatewayUrl: (gatewayUrl) =>
      `${serverUrl()}/__mobile/${new URL(gatewayUrl).hostname}`,
  });
}

function createActivityTransport(): ActivityTransport {
  return {
    async request<T>(
      path: string,
      init: Omit<RequestInit, 'headers'> & {
        headers?: Record<string, string>;
      },
    ): Promise<T> {
      const response = await fetch(`${serverUrl()}${path}`, init);
      if (!response.ok) {
        const error = new Error(
          `Activity request failed (${response.status})`,
        ) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      return (await response.json()) as T;
    },
  };
}

function createToolTransport(): ToolTransport {
  return {
    async request<T>(path: string, init: ToolRequestInit): Promise<T> {
      const response = await fetch(`${serverUrl()}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => undefined) as
          | { error?: string | { message?: string }; message?: string }
          | undefined;
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : payload?.error?.message ?? payload?.message;
        const error = new Error(
          message ?? `Request failed (${response.status})`,
        ) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
  };
}

export const mobileRuntimeVariant: MobileRuntimeVariant = {
  enabled: true,
  serverUrl: configuredServerUrl!,
  accountUser,
  cacheScope: 'e2e-user',
  simulatedPairingTestId: 'pair-simulate-qr',
  createPairedHostStore,
  createActivityTransport,
  createRhythmToolsService: () => {
    const transport = createToolTransport();
    return new RhythmToolsService({ cloud: transport, paired: transport });
  },
  simulatedPairingPayload: (hasExistingHost) =>
    JSON.stringify({
      gatewayUrl: hasExistingHost
        ? 'https://other-mac.tail1234.ts.net'
        : 'https://rhythm-mac.tail1234.ts.net',
      hostId: hasExistingHost ? 'host-2' : 'host-1',
      pairingCode: hasExistingHost ? 'b'.repeat(43) : 'a'.repeat(43),
    }),
};
