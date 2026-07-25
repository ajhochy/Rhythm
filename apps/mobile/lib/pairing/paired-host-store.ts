import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNetworkStateAsync } from 'expo-network';
import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

import { RHYTHM_SESSION_SECURE_KEY } from '@/lib/auth/rhythm-session-store';
import { ApiError } from '@/lib/transport/api-error';
import { PairedMacClient } from '@/lib/transport/paired-mac-client';
import { RhythmCloudClient } from '@/lib/transport/rhythm-cloud-client';

export const PAIRED_DEVICE_SECURE_KEY = 'rhythm.paired.device';
export const PAIRED_HOST_META_KEY = 'rhythm.paired.host.meta';
export const CURRENT_MOBILE_VERSION = '1.0.8';
export const EXPECTED_GATEWAY_VERSION = '1';
export const EXPECTED_OPENCODE_VERSION = '1.14.49';
export const EXPECTED_CONTRACT_FINGERPRINT =
  '4d4e279ce858a0bdb33399b004ef1268e415b7fcbe5029eee93bee94e5759636';

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
    typeof host.pairedAt === 'string'
  );
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

  async restore(): Promise<PairedHostSnapshot> {
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
      return this.apply(
        'revoked',
        'This iPhone no longer has a valid Mac credential. Pair it again.',
      );
    }
    return this.refresh();
  }

  async refresh(): Promise<PairedHostSnapshot> {
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
        { method: 'GET' },
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
      if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
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
    const operation = ++this.operation;
    this.apply('pairing', 'Pairing securely with your Mac…');
    let payload = parsePairingPayload(rawPayload);
    try {
      if (this.accountUserId !== input.userId) {
        throw new PairedHostError(
          'notSignedIn',
          'Sign in to your Rhythm account before pairing a Mac.',
        );
      }
      const existing = this.host ?? (await this.loadHost());
      if (
        existing &&
        (existing.gatewayUrl !== payload.gatewayUrl ||
          existing.rhythmUserId !== input.userId) &&
        !input.replaceExisting
      ) {
        throw new PairedHostError(
          'replacementRequired',
          `Replace ${existing.gatewayUrl.replace('https://', '')} with this Mac?`,
        );
      }
      const cloudToken = await this.getCredential(RHYTHM_SESSION_SECURE_KEY);
      if (!cloudToken) {
        throw new PairedHostError(
          'notSignedIn',
          'Sign in to your Rhythm account before pairing a Mac.',
        );
      }
      const client = new RhythmCloudClient({
        baseUrl: this.resolvedGatewayUrl(payload.gatewayUrl),
        getToken: async () => cloudToken,
      });
      const health = await client.request<HealthResponse>(
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
      const preflightIncompatibility = compatibilityError(health);
      if (preflightIncompatibility) {
        throw new PairedHostError('incompatible', preflightIncompatibility);
      }
      const response = await client.request<PairingResponse>(
        '/mobile-gateway/pair',
        {
          method: 'POST',
          body: JSON.stringify({
            pairingCode: payload.pairingCode,
            userId: input.userId,
            deviceName: input.deviceName,
          }),
        },
      );
      if (operation !== this.operation) return this.snapshot();
      if (
        !response ||
        typeof response !== 'object' ||
        !response.deviceToken ||
        !response.deviceId ||
        !response.hostId ||
        typeof response.gatewayVersion !== 'string' ||
        typeof response.rhythmVersion !== 'string' ||
        typeof response.opencodeVersion !== 'string' ||
        typeof response.contractFingerprint !== 'string' ||
        typeof response.minimumMobileVersion !== 'string' ||
        !Array.isArray(response.features) ||
        response.features.some((feature) => typeof feature !== 'string')
      ) {
        if (response && typeof response.deviceId === 'string') {
          await client
            .request(
              `/mobile-gateway/devices/${encodeURIComponent(response.deviceId)}`,
              { method: 'DELETE' },
            )
            .catch(() => undefined);
        }
        throw new PairedHostError(
          'request',
          'The Mac returned an invalid pairing response.',
        );
      }
      const incompatibility = compatibilityError(response);
      if (incompatibility) {
        await client
          .request(
            `/mobile-gateway/devices/${encodeURIComponent(response.deviceId)}`,
            { method: 'DELETE' },
          )
          .catch(() => undefined);
        throw new PairedHostError('incompatible', incompatibility);
      }
      const host: PairedHost = {
        rhythmUserId: input.userId,
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
      let existingRevoked = false;
      if (
        existing &&
        existing.gatewayUrl !== payload.gatewayUrl &&
        input.replaceExisting
      ) {
        const oldClient = new RhythmCloudClient({
          baseUrl: this.resolvedGatewayUrl(existing.gatewayUrl),
          getToken: async () => cloudToken,
        });
        try {
          await oldClient.request(
            `/mobile-gateway/devices/${encodeURIComponent(existing.deviceId)}`,
            { method: 'DELETE' },
          );
          existingRevoked = true;
        } catch {
          await client
            .request(
              `/mobile-gateway/devices/${encodeURIComponent(response.deviceId)}`,
              { method: 'DELETE' },
            )
            .catch(() => undefined);
          throw new PairedHostError(
            'replacementFailed',
            'The previous Mac could not be revoked, so this iPhone kept its existing pairing. Bring the previous Mac online and try again.',
          );
        }
      }
      let tokenWritten = false;
      try {
        await this.setCredential(PAIRED_DEVICE_SECURE_KEY, response.deviceToken);
        tokenWritten = true;
        await AsyncStorage.setItem(PAIRED_HOST_META_KEY, JSON.stringify(host));
      } catch {
        let newDeviceRevoked = false;
        try {
          await client.request(
            `/mobile-gateway/devices/${encodeURIComponent(response.deviceId)}`,
            { method: 'DELETE' },
          );
          newDeviceRevoked = true;
        } catch {
          newDeviceRevoked = false;
        }
        let credentialCleared = true;
        if (tokenWritten || existingRevoked) {
          try {
            await this.neutralizeDeviceToken();
          } catch {
            credentialCleared = false;
          }
        }
        if (existingRevoked) {
          if (newDeviceRevoked && credentialCleared) {
            const message =
              'The previous Mac was revoked, but the new pairing could not be saved and was rolled back. Generate a new code and pair again.';
            this.apply('revoked', message, existing);
            throw new PairedHostError('storage', message);
          }
          const message = credentialCleared
            ? 'The new Mac still lists this iPhone because pairing cleanup failed. Revoke this iPhone from the new Mac, then pair again.'
            : 'The new Mac still lists this iPhone and its credential may remain in Keychain. Unlock this iPhone, revoke it from the new Mac, and retry.';
          this.apply('unhealthy', message, host);
          throw new PairedHostError('storageRollbackFailed', message);
        }
        await AsyncStorage.removeItem(PAIRED_HOST_META_KEY).catch(() => undefined);
        const rollbackComplete = newDeviceRevoked && credentialCleared;
        const message = rollbackComplete
          ? 'Secure pairing storage is unavailable. The new Mac pairing was rolled back; unlock this iPhone and try again.'
          : newDeviceRevoked
            ? 'Secure pairing storage failed. The new pairing was revoked, but its credential remains in Keychain. Unlock this iPhone and retry Forget.'
            : credentialCleared
              ? 'Secure pairing storage failed and the new Mac still lists this iPhone. Revoke it from the Mac before trying again.'
              : 'Secure pairing storage failed, the new Mac still lists this iPhone, and its credential remains in Keychain. Unlock this iPhone, revoke it from the Mac, and retry Forget.';
        this.apply(
          rollbackComplete ? 'unpaired' : 'unhealthy',
          message,
          rollbackComplete ? null : host,
        );
        throw new PairedHostError(
          rollbackComplete ? 'storage' : 'storageRollbackFailed',
          message,
        );
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
        } else if (
          (error.kind === 'storage' && this.state === 'revoked') ||
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
    }
  }

  async revoke(): Promise<PairedHostSnapshot> {
    const operation = ++this.operation;
    const host = this.host ?? (await this.loadHost());
    if (!host) return this.forget();
    const cloudToken = await this.getCredential(RHYTHM_SESSION_SECURE_KEY);
    if (!cloudToken) {
      const message =
        'Sign in to Rhythm to revoke this iPhone. Access remains active on the paired Mac.';
      this.apply('unhealthy', message, host);
      throw new PairedHostError(
        'notSignedIn',
        message,
      );
    }
    const client = new RhythmCloudClient({
      baseUrl: this.resolvedGatewayUrl(host.gatewayUrl),
      getToken: async () => cloudToken,
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
