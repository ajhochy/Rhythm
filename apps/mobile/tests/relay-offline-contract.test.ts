/**
 * Track 6 acceptance contract — phone offline UX
 * (docs/ai/contracts/relay-t6-phone-offline.md, plan S2.5).
 *
 * Desktop-asleep is a MODE, not an error: 503 mac_offline maps to a typed
 * MacOfflineError, health bodies derive presence, and presence maps the
 * connection status to 'desktop-offline' without masking real errors.
 */
import type { FetchFn } from '@/lib/transport/types';
import { MacOfflineError } from '@/lib/transport/api-error';
import {
  connectionStatusForPresence,
  deriveMacPresence,
  type GatewayConnectionStatus,
} from '@/lib/transport/presence';
import { PairedMacClient } from '@/lib/transport/paired-mac-client';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}),
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
  })),
}));

function stubFetch(status: number, body: unknown): FetchFn {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

function makeClient() {
  return new PairedMacClient({
    baseUrl: 'https://api.vcrcapps.com/relay',
    getDeviceToken: async () => 'device-token',
  } as never);
}

describe('Track 6 contract — MacOfflineError mapping', () => {
  it('issue-1446: pre-warm consumes a transient MacOfflineError', async () => {
    const client = makeClient();
    await expect(
      client.prewarm(
        stubFetch(503, { error: 'mac_offline' }),
      ),
    ).resolves.toBe(false);
  });

  it('maps 503 mac_offline to MacOfflineError', async () => {
    const client = makeClient();
    await expect(
      client.request(
        '/mobile-gateway/projects',
        { method: 'GET' },
        stubFetch(503, { error: 'mac_offline' }),
      ),
    ).rejects.toBeInstanceOf(MacOfflineError);
  });

  it('maps 503 mac_offline_and_mirror_incomplete to MacOfflineError', async () => {
    const client = makeClient();
    await expect(
      client.request(
        '/mobile-gateway/opencode/session/x/message',
        { method: 'GET' },
        stubFetch(503, { error: 'mac_offline_and_mirror_incomplete' }),
      ),
    ).rejects.toBeInstanceOf(MacOfflineError);
  });

  it('does NOT map an unrelated 503 to MacOfflineError', async () => {
    const client = makeClient();
    const failure = client.request(
      '/mobile-gateway/projects',
      { method: 'GET' },
      stubFetch(503, { error: 'upstream_unavailable' }),
    );
    await expect(failure).rejects.toBeTruthy();
    await failure.catch((error) => {
      expect(error).not.toBeInstanceOf(MacOfflineError);
    });
  });
});

describe('Track 6 contract — presence derivation', () => {
  it('derives offline/online/unknown from health bodies', () => {
    expect(deriveMacPresence({ status: 'ok', macOnline: false })).toBe(
      'offline',
    );
    expect(deriveMacPresence({ status: 'ok', macOnline: true })).toBe('online');
    // Direct .ts.net health has no macOnline field: reachable = online.
    expect(deriveMacPresence({ status: 'ready', gatewayVersion: '1' })).toBe(
      'online',
    );
    expect(deriveMacPresence(null)).toBe('unknown');
    expect(deriveMacPresence('nope')).toBe('unknown');
  });

  it('maps presence into the connection status without masking errors', () => {
    expect(connectionStatusForPresence('connected', 'offline')).toBe(
      'desktop-offline',
    );
    expect(connectionStatusForPresence('connected', 'online')).toBe(
      'connected',
    );
    expect(connectionStatusForPresence('connected', 'unknown')).toBe(
      'connected',
    );
    expect(connectionStatusForPresence('error', 'offline')).toBe('error');
    expect(connectionStatusForPresence('connecting', 'offline')).toBe(
      'connecting',
    );
    expect(connectionStatusForPresence('idle', 'online')).toBe('idle');
  });

  it("compile-level: 'desktop-offline' is a valid GatewayConnectionStatus", () => {
    const status: GatewayConnectionStatus = 'desktop-offline';
    expect(status).toBe('desktop-offline');
  });
});
