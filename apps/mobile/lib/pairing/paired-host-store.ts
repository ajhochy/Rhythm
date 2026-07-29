import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNetworkStateAsync } from 'expo-network';
import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

import { ApiError } from '@/lib/transport/api-error';
import { PairedMacClient } from '@/lib/transport/paired-mac-client';
import { PublicGatewayClient } from '@/lib/transport/public-gateway-client';

export const PAIRED_DEVICE_SECURE_KEY = 'rhythm.paired.device';
export const PAIRED_HOST_META_KEY = 'rhythm.paired.host.meta';
export const CURRENT_MOBILE_VERSION = '1.0.8';
export const EXPECTED_GATEWAY_VERSION = '1';
export const EXPECTED_OPENCODE_VERSION = '1.14.49';
export const EXPECTED_CONTRACT_FINGERPRINT =
  '42ef292d051e66edfa44d130a7b480d46d2d15dc514b7f69c017c3f01a62f1fe';

const REQUIRED_FEATURES = [
  'pairing',
  'device-revocation',
  'project-scope',
  'opencode-http-proxy',
] as const;

export type PairedHostState =
  | 'unpaired'
  | 'pairing'
  | 'connected'
  | 'offline'
  | 'tailscaleUnavailable'
  | 'accountMismatch'
  | 'revoked'
  | 'incompatible'
  | 'unhealthy';

export interface PairedHost {
  rhythmUserId: number;
  gatewayUrl: string;
  deviceId: string;
  hostId: string;
  deviceName: string;
  gatewayVersion: string;
  rhythmVersion: string;
  opencodeVersion: string;
  contractFingerprint: string;
  minimumMobileVersion: string;
  features: string[];
  pairedAt: string;
  recovery?: {
    revokeDevice: boolean;
    credential: 'none' | 'host' | 'previous';
  };
}

export interface PairedHostSnapshot {
  state: PairedHostState;
  host: PairedHost | null;
  message: string;
}

export interface PairingPayload {
  gatewayUrl: string;
  pairingCode: string;
}

export interface PairedHostStoreOptions {
  getCredential?: (key: string) => Promise<string | null>;
  setCredential?: (key: string, value: string) => Promise<void>;
  deleteCredential?: (key: string) => Promise<void>;
  resolveGatewayUrl?: (gatewayUrl: string) => string;
}

interface PairingResponse {
  deviceId: string;
  hostId: string;
  userId: number;
  deviceToken: string;
  gatewayVersion: string;
  rhythmVersion: string;
  opencodeVersion: string;
  contractFingerprint: string;
  minimumMobileVersion: string;
  features: string[];
}

type HealthResponse = Omit<PairingResponse, 'deviceId' | 'deviceToken'> & {
  status: 'ready';
};

export class PairedHostError extends Error {
  constructor(
    public readonly kind:
      | 'invalidPayload'
      | 'replacementRequired'
      | 'replacementFailed'
      | 'storageRollbackFailed'
      | 'notSignedIn'
      | 'accountMismatch'
      | 'storage'
      | 'incompatible'
      | 'request',
    message: string,
  ) {
    super(message);
    this.name = 'PairedHostError';
  }
}

function safeGatewayUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PairedHostError('invalidPayload', 'This pairing QR code is invalid.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PairedHostError('invalidPayload', 'This pairing QR code is invalid.');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !hostname.endsWith('.ts.net')
  ) {
    throw new PairedHostError(
      'invalidPayload',
      'Pairing requires a private Tailscale gateway.',
    );
  }
  return `https://${hostname}`;
}

export function parsePairingPayload(raw: string): PairingPayload {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PairedHostError('invalidPayload', 'This pairing QR code is invalid.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PairedHostError('invalidPayload', 'This pairing QR code is invalid.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== 'gatewayUrl' ||
    keys[1] !== 'pairingCode' ||
    typeof record.pairingCode !== 'string' ||
    record.pairingCode.length < 32 ||
    record.pairingCode.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(record.pairingCode)
  ) {
    throw new PairedHostError('invalidPayload', 'This pairing QR code is invalid.');
  }
  return {
    gatewayUrl: safeGatewayUrl(record.gatewayUrl),
    pairingCode: record.pairingCode,
  };
}

function versionParts(value: string): number[] | null {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) return null;
  return value.split(/[+-]/, 1)[0].split('.').map(Number);
}

function meetsMinimumVersion(current: string, minimum: string): boolean {
  const currentParts = versionParts(current);
  const minimumParts = versionParts(minimum);
  if (!currentParts || !minimumParts) return false;
  for (let index = 0; index < 3; index += 1) {
    if (currentParts[index] > minimumParts[index]) return true;
    if (currentParts[index] < minimumParts[index]) return false;
  }
  return true;
}

function compatibilityError(value: {
  gatewayVersion: string;
  opencodeVersion: string;
  contractFingerprint: string;
  minimumMobileVersion: string;
  features: string[];
}): string | null {
  if (
    value.gatewayVersion !== EXPECTED_GATEWAY_VERSION ||
    value.opencodeVersion !== EXPECTED_OPENCODE_VERSION ||
    value.contractFingerprint !== EXPECTED_CONTRACT_FINGERPRINT
  ) {
    return 'This Mac and app use incompatible agent protocols. Update both and try again.';
  }
  if (!meetsMinimumVersion(CURRENT_MOBILE_VERSION, value.minimumMobileVersion)) {
    return `This Mac requires Rhythm Agents ${value.minimumMobileVersion} or newer.`;
  }
  const missingFeature = REQUIRED_FEATURES.find(
    (feature) => !value.features.includes(feature),
  );
  return missingFeature
    ? `This Mac is missing the required ${missingFeature} capability.`
    : null;
}

function hasCompatibilityFields(value: unknown): value is HealthResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<HealthResponse>;
  return (
    response.status === 'ready' &&
    typeof response.hostId === 'string' &&
    typeof response.gatewayVersion === 'string' &&
    typeof response.rhythmVersion === 'string' &&
    typeof response.opencodeVersion === 'string' &&
    typeof response.contractFingerprint === 'string' &&
    typeof response.minimumMobileVersion === 'string' &&
    Array.isArray(response.features) &&
    response.features.every((feature) => typeof feature === 'string')
  );
}

function isPairedHost(value: unknown): value is PairedHost {
  if (!value || typeof value !== 'object') return false;
  const host = value as Partial<PairedHost>;
  return (
    typeof host.rhythmUserId === 'number' &&
    Number.isSafeInteger(host.rhythmUserId) &&
    host.rhythmUserId > 0 &&
    typeof host.gatewayUrl === 'string' &&
    typeof host.deviceId === 'string' &&
    typeof host.hostId === 'string' &&
    typeof host.deviceName === 'string' &&
    typeof host.gatewayVersion === 'string' &&
    typeof host.rhythmVersion === 'string' &&
    typeof host.opencodeVersion === 'string' &&
    typeof host.contractFingerprint === 'string' &&
    typeof host.minimumMobileVersion === 'string' &&
    Array.isArray(host.features) &&
    host.features.every((feature) => typeof feature === 'string') &&
    typeof host.pairedAt === 'string' &&
    (
      host.recovery === undefined ||
      (
        typeof host.recovery === 'object' &&
        typeof host.recovery.revokeDevice === 'boolean' &&
        ['none', 'host', 'previous'].includes(host.recovery.credential ?? '')
      )
    )
  );
}

function recoveryMessage(host: PairedHost): string | null {
  const recovery = host.recovery;
  if (!recovery) return null;
  if (recovery.revokeDevice && recovery.credential === 'previous') {
    return 'The new Mac still lists this iPhone, and the previous Mac credential remains in Keychain. Revoke this iPhone from the new Mac, then retry Forget.';
  }
  if (recovery.revokeDevice && recovery.credential === 'host') {
    return 'The new Mac still lists this iPhone and its credential remains in Keychain. Revoke it from the new Mac, then retry Forget.';
  }
  if (recovery.revokeDevice) {
    return 'The new Mac still lists this iPhone because pairing cleanup failed. Revoke this iPhone from the new Mac, then pair again.';
  }
  return recovery.credential === 'previous'
    ? 'The new pairing was revoked, but the previous Mac credential remains in Keychain. Unlock this iPhone and retry Forget.'
    : 'The new pairing was revoked, but its credential remains in Keychain. Unlock this iPhone and retry Forget.';
}

async function neutralizeDeviceToken(options: PairedHostStoreOptions): Promise<void> {
  const deleteCredential = options.deleteCredential ?? deleteItemAsync;
  const setCredential = options.setCredential ?? setItemAsync;
  try {
    await deleteCredential(PAIRED_DEVICE_SECURE_KEY);
  } catch (deleteError) {
    try {
      await setCredential(PAIRED_DEVICE_SECURE_KEY, '');
    } catch {
      throw deleteError;
    }
  }
}

async function internetAvailable(): Promise<boolean> {
  try {
    const state = await getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

export class PairedHostStore {
  private state: PairedHostState = 'unpaired';
  private host: PairedHost | null = null;
  private message = 'Pair this iPhone with your Mac to use Rhythm Agents.';
  private operation = 0;
  private accountUserId: number | null = null;

  constructor(private readonly options: PairedHostStoreOptions = {}) {}

  snapshot(): PairedHostSnapshot {
    return { state: this.state, host: this.host, message: this.message };
  }

  cancelPending(): void {
    this.operation += 1;
  }

  setAccountUserId(userId: number | null): void {
    if (this.accountUserId === userId) return;
    this.accountUserId = userId;
    this.cancelPending();
  }

  supports(feature: string): boolean {
    return (
      this.state === 'connected' &&
      this.host?.rhythmUserId === this.accountUserId &&
      this.host.features.includes(feature)
    );
  }

  /**
   * Build a token-bearing transport for the current account/host scope.
   * Credentials are resolved from SecureStore per request by PairedMacClient;
   * this method never reads, returns, or caches the device token.
   */
  client(): PairedMacClient | null {
    const host = this.host;
    if (
      !host ||
      this.accountUserId === null ||
      host.rhythmUserId !== this.accountUserId
    ) {
      return null;
    }
    return new PairedMacClient({
      baseUrl: this.resolvedGatewayUrl(host.gatewayUrl),
      getDeviceToken: async () => {
        const token = await this.getCredential(PAIRED_DEVICE_SECURE_KEY);
        if (!token) throw new Error('Paired-device credential unavailable');
        return token;
      },
    });
  }

  private apply(
    state: PairedHostState,
    message: string,
    host: PairedHost | null = this.host,
  ): PairedHostSnapshot {
    this.state = state;
    this.message = message;
    this.host = host;
    return this.snapshot();
  }

  private async loadHost(): Promise<PairedHost | null> {
    const serialized = await AsyncStorage.getItem(PAIRED_HOST_META_KEY);
    if (!serialized) return null;
    try {
      const parsed: unknown = JSON.parse(serialized);
      return isPairedHost(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private getCredential(key: string): Promise<string | null> {
    return (this.options.getCredential ?? getItemAsync)(key);
  }

  private setCredential(key: string, value: string): Promise<void> {
    return (this.options.setCredential ?? setItemAsync)(key, value);
  }

  private resolvedGatewayUrl(gatewayUrl: string): string {
    return this.options.resolveGatewayUrl?.(gatewayUrl) ?? gatewayUrl;
  }

  private neutralizeDeviceToken(): Promise<void> {
    return neutralizeDeviceToken(this.options);
  }

  async restore(signal?: AbortSignal): Promise<PairedHostSnapshot> {
    const operation = ++this.operation;
    let token: string | null;
    let host: PairedHost | null;
    try {
      [token, host] = await Promise.all([
        this.getCredential(PAIRED_DEVICE_SECURE_KEY),
        this.loadHost(),
      ]);
    } catch {
      if (operation !== this.operation) return this.snapshot();
      return this.apply(
        'unhealthy',
        'Secure pairing storage is unavailable. Unlock this iPhone and try again.',
        null,
      );
    }
    if (operation !== this.operation) return this.snapshot();
    if (!host) {
      if (token) await this.neutralizeDeviceToken().catch(() => undefined);
      return this.apply(
        'unpaired',
        'Pair this iPhone with your Mac to use Rhythm Agents.',
        null,
      );
    }
    this.host = host;
    if (
      this.accountUserId === null ||
      host.rhythmUserId !== this.accountUserId
    ) {
      return this.apply(
        'accountMismatch',
        this.accountUserId === null
          ? 'Sign in to the Rhythm account that paired this Mac.'
          : 'This Mac belongs to a different Rhythm account. Switch accounts or forget it before pairing again.',
      );
    }
    if (!token) {
      const recovery = recoveryMessage(host);
      if (recovery) return this.apply('unhealthy', recovery);
      return this.apply(
        'revoked',
        'This iPhone no longer has a valid Mac credential. Pair it again.',
      );
    }
    return this.refresh(signal);
  }

  async refresh(signal?: AbortSignal): Promise<PairedHostSnapshot> {
    const operation = ++this.operation;
    let host = this.host;
    try {
      host ??= await this.loadHost();
      if (!host) {
        return this.apply(
          'unpaired',
          'Pair this iPhone with your Mac to use Rhythm Agents.',
          null,
        );
      }
      this.host = host;
      if (
        this.accountUserId === null ||
        host.rhythmUserId !== this.accountUserId
      ) {
        return this.apply(
          'accountMismatch',
          this.accountUserId === null
            ? 'Sign in to the Rhythm account that paired this Mac.'
          : 'This Mac belongs to a different Rhythm account. Switch accounts or forget it before pairing again.',
        );
      }
      const recovery = recoveryMessage(host);
      if (recovery) return this.apply('unhealthy', recovery);
      const token = await this.getCredential(PAIRED_DEVICE_SECURE_KEY);
      if (!token) {
        return this.apply(
          'revoked',
          'This iPhone no longer has a valid Mac credential. Pair it again.',
        );
      }
      if (!(await internetAvailable())) {
        return this.apply(
          'offline',
          'This iPhone is offline. Your paired Mac is still saved.',
        );
      }
      const client = new PairedMacClient({
        baseUrl: this.resolvedGatewayUrl(host.gatewayUrl),
        getDeviceToken: async () => token,
      });
      const health = await client.request<HealthResponse>(
        '/mobile-gateway/health',
        { method: 'GET', signal },
      );
      if (operation !== this.operation) return this.snapshot();
      if (health.status !== 'ready') {
        return this.apply(
          'unhealthy',
          'The paired Mac responded but its mobile gateway is unhealthy.',
        );
      }
      const incompatibility = compatibilityError(health);
      if (incompatibility) return this.apply('incompatible', incompatibility);
      const refreshedHost: PairedHost = {
        ...host,
        gatewayVersion: health.gatewayVersion,
        rhythmVersion: health.rhythmVersion,
        opencodeVersion: health.opencodeVersion,
        contractFingerprint: health.contractFingerprint,
        minimumMobileVersion: health.minimumMobileVersion,
        features: [...health.features],
      };
      await AsyncStorage.setItem(
        PAIRED_HOST_META_KEY,
        JSON.stringify(refreshedHost),
      );
      return this.apply(
        'connected',
        'Connected securely to your Mac over Tailscale.',
        refreshedHost,
      );
    } catch (error) {
      if (operation !== this.operation) return this.snapshot();
      if (error instanceof ApiError && error.status === 401) {
        try {
          await this.neutralizeDeviceToken();
        } catch {
          return this.apply(
            'unhealthy',
            'The Mac revoked this iPhone, but Keychain cleanup failed. Unlock this iPhone and retry.',
          );
        }
        return this.apply(
          'revoked',
          'This iPhone was revoked by the paired Mac. Pair it again.',
        );
      }
      if (
        error instanceof ApiError &&
        (error.code === 'NETWORK_ERROR' || error.status >= 500)
      ) {
        if (!(await internetAvailable())) {
          return this.apply(
            'offline',
            'This iPhone is offline. Your paired Mac is still saved.',
          );
        }
        return this.apply(
          'tailscaleUnavailable',
          'Tailscale cannot reach the paired Mac. Open Tailscale and check the Mac is online.',
        );
      }
      return this.apply(
        'unhealthy',
        'The paired Mac returned an unhealthy response. Check Rhythm on the Mac and retry.',
      );
    }
  }

  async pair(
    rawPayload: string,
    input: { userId: number; deviceName: string; replaceExisting?: boolean },
  ): Promise<PairedHostSnapshot> {
    const previous = this.snapshot();
    const operation = ++this.operation;
    this.apply('pairing', 'Pairing securely with your Mac…');
    let payload: PairingPayload = {
      gatewayUrl: '',
      pairingCode: '',
    };
    let newDeviceToken = '';
    let existingDeviceToken: string | null = null;
    try {
      payload = parsePairingPayload(rawPayload);
      if (this.accountUserId !== input.userId) {
        throw new PairedHostError(
          'notSignedIn',
          'Sign in to your Rhythm account before pairing a Mac.',
        );
      }
      const existing = this.host ?? (await this.loadHost());
      if (existing) {
        existingDeviceToken = await this.getCredential(
          PAIRED_DEVICE_SECURE_KEY,
        );
        if (!existingDeviceToken) {
          throw new PairedHostError(
            'storage',
            'The previous Mac credential is unavailable. Forget it before pairing another Mac.',
          );
        }
      }
      const publicClient = new PublicGatewayClient({
        baseUrl: this.resolvedGatewayUrl(payload.gatewayUrl),
      });
      const health = await publicClient.requestPublic<HealthResponse>(
        '/mobile-gateway/health',
        { method: 'GET' },
      );
      if (operation !== this.operation) return this.snapshot();
      if (!hasCompatibilityFields(health)) {
        throw new PairedHostError(
          'request',
          'The Mac returned an invalid compatibility response.',
        );
      }
      const recycledEndpoint =
        existing !== null &&
        existing.gatewayUrl === payload.gatewayUrl &&
        existing.hostId !== health.hostId;
      if (
        existing &&
        (existing.gatewayUrl !== payload.gatewayUrl ||
          existing.hostId !== health.hostId ||
          existing.rhythmUserId !== input.userId) &&
        !input.replaceExisting
      ) {
        throw new PairedHostError(
          'replacementRequired',
          `Replace ${existing.gatewayUrl.replace('https://', '')} with this Mac?`,
        );
      }
      const preflightIncompatibility = compatibilityError(health);
      if (preflightIncompatibility) {
        throw new PairedHostError('incompatible', preflightIncompatibility);
      }
      const response = await publicClient.requestPublic<PairingResponse>(
        '/mobile-gateway/pair',
        {
          method: 'POST',
          body: JSON.stringify({
            pairingCode: payload.pairingCode,
            hostId: health.hostId,
            deviceName: input.deviceName,
          }),
        },
      );
      newDeviceToken =
        response && typeof response.deviceToken === 'string'
          ? response.deviceToken
          : '';
      const newClient = new PairedMacClient({
        baseUrl: this.resolvedGatewayUrl(payload.gatewayUrl),
        getDeviceToken: async () => newDeviceToken,
      });
      const revokeNewDevice = async (): Promise<boolean> => {
        if (
          !newDeviceToken ||
          !response ||
          typeof response.deviceId !== 'string'
        ) {
          return false;
        }
        try {
          await newClient.request(
            `/mobile-gateway/devices/${encodeURIComponent(response.deviceId)}`,
            { method: 'DELETE' },
          );
          return true;
        } catch {
          return false;
        }
      };
      if (operation !== this.operation) {
        await revokeNewDevice();
        return this.snapshot();
      }
      if (
        !response ||
        typeof response !== 'object' ||
        !newDeviceToken ||
        !response.deviceId ||
        !response.hostId ||
        !Number.isSafeInteger(response.userId) ||
        response.userId <= 0 ||
        typeof response.gatewayVersion !== 'string' ||
        typeof response.rhythmVersion !== 'string' ||
        typeof response.opencodeVersion !== 'string' ||
        typeof response.contractFingerprint !== 'string' ||
        typeof response.minimumMobileVersion !== 'string' ||
        !Array.isArray(response.features) ||
        response.features.some((feature) => typeof feature !== 'string')
      ) {
        await revokeNewDevice();
        throw new PairedHostError(
          'request',
          'The Mac returned an invalid pairing response.',
        );
      }
      if (response.hostId !== health.hostId) {
        await revokeNewDevice();
        throw new PairedHostError(
          'invalidPayload',
          'This pairing response came from a different Mac.',
        );
      }
      if (response.userId !== input.userId) {
        await revokeNewDevice();
        throw new PairedHostError(
          'accountMismatch',
          'This pairing code belongs to a different Rhythm account.',
        );
      }
      const incompatibility = compatibilityError(response);
      if (incompatibility) {
        await revokeNewDevice();
        throw new PairedHostError('incompatible', incompatibility);
      }
      const host: PairedHost = {
        rhythmUserId: response.userId,
        gatewayUrl: payload.gatewayUrl,
        deviceId: response.deviceId,
        hostId: response.hostId,
        deviceName: input.deviceName,
        gatewayVersion: response.gatewayVersion,
        rhythmVersion: response.rhythmVersion,
        opencodeVersion: response.opencodeVersion,
        contractFingerprint: response.contractFingerprint,
        minimumMobileVersion: response.minimumMobileVersion,
        features: [...response.features],
        pairedAt: new Date().toISOString(),
      };
      let tokenWritten = false;
      try {
        await this.setCredential(PAIRED_DEVICE_SECURE_KEY, newDeviceToken);
        tokenWritten = true;
        await AsyncStorage.setItem(PAIRED_HOST_META_KEY, JSON.stringify(host));
      } catch {
        let previousRestored = true;
        try {
          if (existing && existingDeviceToken) {
            if (tokenWritten) {
              await this.setCredential(
                PAIRED_DEVICE_SECURE_KEY,
                existingDeviceToken,
              );
            }
          } else if (tokenWritten) {
            await this.neutralizeDeviceToken();
          }
        } catch {
          previousRestored = false;
        }
        const newDeviceRevoked = await revokeNewDevice();
        const rollbackComplete = newDeviceRevoked && previousRestored;
        const recycledRollback = recycledEndpoint && rollbackComplete;
        const message = recycledRollback
          ? 'Secure pairing storage is unavailable. This endpoint now belongs to a different Mac; the new pairing was revoked. Unlock this iPhone and pair again.'
          : rollbackComplete
            ? 'Secure pairing storage is unavailable. The new pairing was rolled back and the previous pairing is unchanged.'
          : newDeviceRevoked
            ? 'The new pairing was revoked, but its Device credential remains in Keychain. Unlock this iPhone and retry Forget.'
            : 'Secure pairing storage failed and the new Mac still lists this iPhone. Revoke it from the Mac before trying again.';
        const recoveryHost: PairedHost =
          existing && previousRestored
            ? {
                ...existing,
                recovery: {
                  revokeDevice: !newDeviceRevoked,
                  credential: 'previous',
                },
              }
            : {
                ...host,
                recovery: {
                  revokeDevice: !newDeviceRevoked,
                  credential: previousRestored
                    ? existing
                      ? 'previous'
                      : 'none'
                    : 'host',
                },
              };
        if (!rollbackComplete) {
          await AsyncStorage.setItem(
            PAIRED_HOST_META_KEY,
            JSON.stringify(recoveryHost),
          ).catch(() => undefined);
        }
        this.apply(
          rollbackComplete && !recycledEndpoint
            ? previous.state
            : 'unhealthy',
          message,
          rollbackComplete ? previous.host : recoveryHost,
        );
        throw new PairedHostError(
          rollbackComplete ? 'storage' : 'storageRollbackFailed',
          message,
        );
      }
      if (existing && existingDeviceToken && !recycledEndpoint) {
        const oldClient = new PairedMacClient({
          baseUrl: this.resolvedGatewayUrl(existing.gatewayUrl),
          getDeviceToken: async () => existingDeviceToken!,
        });
        try {
          await oldClient.request(
            `/mobile-gateway/devices/${encodeURIComponent(existing.deviceId)}`,
            { method: 'DELETE' },
          );
        } catch {
          let previousCredentialRestored = false;
          let previousMetadataRestored = false;
          try {
            await this.setCredential(
              PAIRED_DEVICE_SECURE_KEY,
              existingDeviceToken,
            );
            previousCredentialRestored = true;
          } catch {
            // Recovery below must describe the credential actually in Keychain.
          }
          try {
            await AsyncStorage.setItem(
              PAIRED_HOST_META_KEY,
              JSON.stringify(existing),
            );
            previousMetadataRestored = true;
          } catch {
            // Persist a truthful recovery tuple below when this was transient.
          }
          const newDeviceRevoked = await revokeNewDevice();
          if (
            previousCredentialRestored &&
            previousMetadataRestored &&
            newDeviceRevoked
          ) {
            const message =
              'The previous Mac could not be revoked, so this iPhone kept its existing pairing.';
            this.apply(previous.state, message, existing);
            throw new PairedHostError('replacementFailed', message);
          }
          const message =
            'Pairing replacement could not be rolled back completely. Revoke this iPhone from both Macs before trying again.';
          const recoveryHost: PairedHost = {
            ...(previousCredentialRestored ? existing : host),
            recovery: {
              revokeDevice: !newDeviceRevoked,
              credential: previousCredentialRestored ? 'previous' : 'host',
            },
          };
          await AsyncStorage.setItem(
            PAIRED_HOST_META_KEY,
            JSON.stringify(recoveryHost),
          ).catch(() => undefined);
          this.apply('unhealthy', message, recoveryHost);
          throw new PairedHostError('storageRollbackFailed', message);
        }
      }
      return this.apply(
        'connected',
        'Connected securely to your Mac over Tailscale.',
        host,
      );
    } catch (error) {
      if (error instanceof PairedHostError) {
        if (error.kind === 'incompatible') {
          this.apply('incompatible', error.message, this.host);
        } else if (error.kind === 'accountMismatch') {
          this.apply('accountMismatch', error.message, this.host);
        } else if (
          error.kind === 'invalidPayload' ||
          error.kind === 'replacementRequired' ||
          error.kind === 'replacementFailed'
        ) {
          this.apply(previous.state, error.message, previous.host);
        } else if (
          (error.kind === 'storage' && this.state !== 'pairing') ||
          error.kind === 'storageRollbackFailed'
        ) {
          // Storage rollback already selected a truthful, actionable state.
        } else {
          this.apply(this.host ? 'offline' : 'unpaired', error.message, this.host);
        }
        throw error;
      }
      const safe = new PairedHostError(
        'request',
        error instanceof ApiError && error.status === 403
          ? 'This pairing code belongs to a different Rhythm account.'
          : 'Could not pair with this Mac. Generate a new code and try again.',
      );
      this.apply(this.host ? 'offline' : 'unpaired', safe.message, this.host);
      throw safe;
    } finally {
      payload = { gatewayUrl: '', pairingCode: '' };
      newDeviceToken = '';
      existingDeviceToken = null;
    }
  }

  async revoke(): Promise<PairedHostSnapshot> {
    const operation = ++this.operation;
    const host = this.host ?? (await this.loadHost());
    if (!host) return this.forget();
    const deviceToken = await this.getCredential(PAIRED_DEVICE_SECURE_KEY);
    if (!deviceToken) {
      const message =
        'The paired-device credential is unavailable. Revoke this iPhone from Rhythm on the Mac.';
      this.apply('unhealthy', message, host);
      throw new PairedHostError(
        'storage',
        message,
      );
    }
    const client = new PairedMacClient({
      baseUrl: this.resolvedGatewayUrl(host.gatewayUrl),
      getDeviceToken: async () => deviceToken,
    });
    try {
      await client.request(
        `/mobile-gateway/devices/${encodeURIComponent(host.deviceId)}`,
        { method: 'DELETE' },
      );
    } catch (error) {
      const tailnetUnavailable =
        error instanceof ApiError &&
        (
          error.code === 'NETWORK_ERROR' ||
          error.retryable ||
          error.status >= 500
        );
      const message = tailnetUnavailable
        ? 'This iPhone was not revoked and access is still active. Bring the paired Mac online in Tailscale and retry.'
        : 'This iPhone was not revoked and access is still active. Retry, or revoke it from Rhythm on the Mac.';
      this.apply(
        tailnetUnavailable ? 'tailscaleUnavailable' : 'unhealthy',
        message,
        host,
      );
      throw new PairedHostError('request', message);
    }
    if (operation !== this.operation) return this.snapshot();
    return this.forget();
  }

  async forget(): Promise<PairedHostSnapshot> {
    ++this.operation;
    let credentialCleared = false;
    try {
      await this.neutralizeDeviceToken();
      credentialCleared = true;
      await AsyncStorage.removeItem(PAIRED_HOST_META_KEY);
    } catch {
      const message = credentialCleared
        ? 'The Mac credential was removed, but paired-Mac details could not be cleared. Retry Forget.'
        : 'The paired Mac credential remains in Keychain. Unlock this iPhone and retry Forget.';
      this.apply('unhealthy', message, this.host);
      throw new PairedHostError(
        'storage',
        message,
      );
    }
    return this.apply(
      'unpaired',
      'Pair this iPhone with your Mac to use Rhythm Agents.',
      null,
    );
  }
}
