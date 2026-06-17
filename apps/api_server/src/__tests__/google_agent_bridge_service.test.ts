import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationAccount } from '../models/integration_account';
import { GEMINI_CLOUD_PLATFORM_SCOPE } from '../services/google_oauth_service';
import {
  GoogleAgentBridgeService,
} from '../services/google_agent_bridge_service';
import type { OpencodeClientService } from '../services/opencode_client_service';

const FUTURE_ISO = new Date(Date.now() + 30 * 60 * 1000).toISOString();

function makeAccount(overrides: Partial<IntegrationAccount> = {}): IntegrationAccount {
  return {
    id: 'acct-1',
    ownerId: 7,
    provider: 'google_calendar',
    externalAccountId: 'sub-123',
    email: 'user@example.com',
    displayName: 'User',
    status: 'connected',
    accessToken: 'ya29.access-token',
    refreshToken: '1//refresh-token',
    scope: `openid email ${GEMINI_CLOUD_PLATFORM_SCOPE}`,
    tokenType: 'Bearer',
    expiresAt: FUTURE_ISO,
    lastSyncedAt: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface Deps {
  ensureFreshGoogleAccount: (userId: number) => Promise<IntegrationAccount>;
}

function stubClient(setReturns: boolean): OpencodeClientService {
  return {
    isReady: true,
    setOAuthCredentials: vi.fn().mockResolvedValue(setReturns),
  } as unknown as OpencodeClientService;
}

describe('GoogleAgentBridgeService.bridgeGoogle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bridges to opencode google provider with ms-epoch expires when scope includes cloud-platform', async () => {
    const account = makeAccount();
    const deps: Deps = {
      ensureFreshGoogleAccount: vi.fn().mockResolvedValue(account),
    };
    const client = stubClient(true);
    const bridge = new GoogleAgentBridgeService(deps);

    const result = await bridge.bridgeGoogle(7, client);

    expect(result.success).toBe(true);
    const setSpy = client.setOAuthCredentials as unknown as ReturnType<typeof vi.fn>;
    expect(setSpy).toHaveBeenCalledTimes(1);
    const [providerId, creds] = setSpy.mock.calls[0];
    expect(providerId).toBe('google');
    expect(creds.access).toBe('ya29.access-token');
    expect(creds.refresh).toBe('1//refresh-token');
    // ms-epoch unit (matches the Anthropic bridge): the ISO expiresAt parsed.
    expect(creds.expires).toBe(Date.parse(FUTURE_ISO));
    expect(typeof creds.expires).toBe('number');
    expect(creds.expires).toBeGreaterThan(1e12);
  });

  it('does NOT bridge and returns reason "missing_gemini_scope" when scope lacks cloud-platform', async () => {
    const account = makeAccount({ scope: 'openid email profile' });
    const deps: Deps = {
      ensureFreshGoogleAccount: vi.fn().mockResolvedValue(account),
    };
    const client = stubClient(true);
    const bridge = new GoogleAgentBridgeService(deps);

    const result = await bridge.bridgeGoogle(7, client);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('missing_gemini_scope');
    expect(client.setOAuthCredentials).not.toHaveBeenCalled();
  });

  it('skips cleanly with reason "not_connected" when no Google account exists', async () => {
    const deps: Deps = {
      ensureFreshGoogleAccount: vi
        .fn()
        .mockRejectedValue(new Error('Google is not connected')),
    };
    const client = stubClient(true);
    const bridge = new GoogleAgentBridgeService(deps);

    const result = await bridge.bridgeGoogle(7, client);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('not_connected');
    expect(client.setOAuthCredentials).not.toHaveBeenCalled();
  });

  it('returns reason "sdk_not_ready" when the engine is not ready (no bridge)', async () => {
    const account = makeAccount();
    const deps: Deps = {
      ensureFreshGoogleAccount: vi.fn().mockResolvedValue(account),
    };
    const client = {
      isReady: false,
      setOAuthCredentials: vi.fn().mockResolvedValue(true),
    } as unknown as OpencodeClientService;
    const bridge = new GoogleAgentBridgeService(deps);

    const result = await bridge.bridgeGoogle(7, client);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('sdk_not_ready');
    expect(client.setOAuthCredentials).not.toHaveBeenCalled();
  });

  it('returns reason "missing_token" when the fresh account has no access token', async () => {
    const account = makeAccount({ accessToken: null });
    const deps: Deps = {
      ensureFreshGoogleAccount: vi.fn().mockResolvedValue(account),
    };
    const client = stubClient(true);
    const bridge = new GoogleAgentBridgeService(deps);

    const result = await bridge.bridgeGoogle(7, client);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('missing_token');
    expect(client.setOAuthCredentials).not.toHaveBeenCalled();
  });

  it('returns reason "auth_set_rejected" when opencode auth.set returns false', async () => {
    const account = makeAccount();
    const deps: Deps = {
      ensureFreshGoogleAccount: vi.fn().mockResolvedValue(account),
    };
    const client = stubClient(false);
    const bridge = new GoogleAgentBridgeService(deps);

    const result = await bridge.bridgeGoogle(7, client);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('auth_set_rejected');
  });
});

describe('GoogleAgentBridgeService.startRefreshLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks every 15 min and re-runs bridgeGoogle for the stored user; idempotent start', async () => {
    const account = makeAccount();
    const deps: Deps = {
      ensureFreshGoogleAccount: vi.fn().mockResolvedValue(account),
    };
    const bridge = new GoogleAgentBridgeService(deps);
    const spy = vi
      .spyOn(bridge, 'bridgeGoogle')
      .mockResolvedValue({ success: true, provider: 'google' });
    const client = { isReady: true } as unknown as OpencodeClientService;

    bridge.startRefreshLoop(7, client);
    // Idempotent: a second start must NOT create a second interval.
    bridge.startRefreshLoop(7, client);

    expect(GoogleAgentBridgeService.REFRESH_INTERVAL_MS).toBe(15 * 60 * 1000);

    vi.advanceTimersByTime(GoogleAgentBridgeService.REFRESH_INTERVAL_MS + 100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(7, client);

    vi.advanceTimersByTime(GoogleAgentBridgeService.REFRESH_INTERVAL_MS);
    expect(spy).toHaveBeenCalledTimes(2);

    bridge.stopRefreshLoop();
    vi.advanceTimersByTime(GoogleAgentBridgeService.REFRESH_INTERVAL_MS * 3);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
