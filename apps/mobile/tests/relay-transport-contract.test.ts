/**
 * Track 3 acceptance contract — relay transport on the phone
 * (docs/ai/contracts/relay-t3-phone-transport.md, plan S1.10–S1.11).
 *
 * Pins: relay URL validation, pairing-payload relayUrl handling, relay-first
 * base selection and path-prefix-safe client URL building. The superseding
 * issue-1387-c23 contract owns PTY transport because Terminal must now use
 * the native Cloud Gateway end to end.
 */
import type { FetchFn } from '@/lib/transport/types';
import {
  effectiveGatewayBase,
  parsePairingPayload,
  safeRelayUrl,
} from '@/lib/pairing/paired-host-store';
import { PairedMacClient } from '@/lib/transport/paired-mac-client';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
});

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
  })),
}));

const RELAY_BASE = 'https://api.vcrcapps.com/relay';
const TSNET = 'https://rhythm-mac.tail1234.ts.net';
const CODE = 'a'.repeat(43);

describe('Track 3 contract — relay URL validation', () => {
  it('safeRelayUrl accepts exactly the configured relay base', async () => {
    expect(safeRelayUrl(RELAY_BASE)).toBe(RELAY_BASE);
    // normalizes a single trailing slash
    expect(safeRelayUrl(`${RELAY_BASE}/`)).toBe(RELAY_BASE);
  });

  it('safeRelayUrl rejects everything else', async () => {
    const bad = [
      'http://api.vcrcapps.com/relay',
      'https://api.vcrcapps.com/other',
      'https://evil.example.com/relay',
      `${RELAY_BASE}?q=1`,
      `${RELAY_BASE}#frag`,
      'https://user:pw@api.vcrcapps.com/relay',
      'https://api.vcrcapps.com:8443/relay',
      'https://api.vcrcapps.com/relay/extra',
      'not a url',
      42,
      null,
    ];
    for (const value of bad) {
      expect(() => safeRelayUrl(value as never)).toThrow();
    }
  });

  it('parsePairingPayload carries a valid relayUrl and rejects an invalid one', async () => {
    const withRelay = parsePairingPayload(
      JSON.stringify({
        gatewayUrl: TSNET,
        pairingCode: CODE,
        relayUrl: RELAY_BASE,
      }),
    ) as { relayUrl?: string | null };
    expect(withRelay.relayUrl).toBe(RELAY_BASE);

    const without = parsePairingPayload(
      JSON.stringify({ gatewayUrl: TSNET, pairingCode: CODE }),
    ) as { relayUrl?: string | null };
    expect(without.relayUrl ?? null).toBeNull();

    expect(() =>
      parsePairingPayload(
        JSON.stringify({
          gatewayUrl: TSNET,
          pairingCode: CODE,
          relayUrl: 'https://evil.example.com/relay',
        }),
      ),
    ).toThrow();
  });

  it('effectiveGatewayBase prefers the relay and falls back to the gateway', async () => {
    expect(
      effectiveGatewayBase({ gatewayUrl: TSNET, relayUrl: RELAY_BASE }),
    ).toBe(RELAY_BASE);
    expect(effectiveGatewayBase({ gatewayUrl: TSNET, relayUrl: null })).toBe(
      TSNET,
    );
    expect(effectiveGatewayBase({ gatewayUrl: TSNET })).toBe(TSNET);
  });
});

describe('Track 3 contract — PairedMacClient with a path-bearing base', () => {
  async function makeClient(overrides: Record<string, unknown> = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn: FetchFn = async (input, init) => {
      calls.push({ url: String(input), init: (init ?? {}) as RequestInit });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new PairedMacClient({
      baseUrl: RELAY_BASE,
      getDeviceToken: async () => 'device-token',
      ...overrides,
    } as never);
    return { client, calls, fetchFn };
  }

  it('request URLs preserve the /relay path prefix', async () => {
    const { client, calls, fetchFn } = await makeClient();
    await client.fetchResponse(
      '/mobile-gateway/health',
      { method: 'GET' },
      fetchFn,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${RELAY_BASE}/mobile-gateway/health`);
  });

  it('Gallery resource URLs stay on the relay even when a direct base exists', async () => {
    const { client } = await makeClient({ directBaseUrl: TSNET });
    const connection = await client.resourceConnection(
      '/mobile-gateway/tools/agent-designs/design-1/artifact',
      { headers: { 'X-Rhythm-Project-ID': 'project-rhythm' } },
    );
    expect(connection).toEqual({
      url: `${RELAY_BASE}/mobile-gateway/tools/agent-designs/design-1/artifact`,
      headers: {
        Authorization: 'Device device-token',
        'X-Rhythm-Project-ID': 'project-rhythm',
      },
    });
    expect(connection.url).not.toContain('tail1234.ts.net');
  });

});
