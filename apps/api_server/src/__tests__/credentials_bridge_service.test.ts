import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as cp from 'child_process';
import * as fs from 'fs';
import { OpencodeClientService } from '../services/opencode_client_service';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

import { CredentialsBridgeService } from '../services/credentials_bridge_service';

const FUTURE = Date.now() + 30 * 60 * 1000;
const PAST = Date.now() - 60 * 1000;

function keychainPayload(expiresAt: number) {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-access-XXXX',
      refreshToken: 'sk-ant-refresh-YYYY',
      expiresAt,
      scopes: ['org:create_api_key', 'user:profile'],
      subscriptionType: 'pro',
      rateLimitTier: 'normal',
    },
  });
}

describe('CredentialsBridgeService.readClaudeCreds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads from macOS Keychain when available', () => {
    vi.mocked(cp.execSync).mockReturnValueOnce(Buffer.from(keychainPayload(FUTURE)));
    const svc = new CredentialsBridgeService();
    const out = svc.readClaudeCreds();
    expect(out?.access).toBe('sk-ant-access-XXXX');
    expect(out?.refresh).toBe('sk-ant-refresh-YYYY');
    expect(out?.expires).toBe(FUTURE);
    expect(out?.subscriptionType).toBe('pro');
  });

  it('falls back to ~/.claude/.credentials.json when Keychain fails', () => {
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('keychain denied'); });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(keychainPayload(FUTURE));
    const svc = new CredentialsBridgeService();
    expect(svc.readClaudeCreds()?.access).toBe('sk-ant-access-XXXX');
  });

  it('returns null with reason="keychain_denied" when both sources fail', () => {
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('user clicked Deny'); });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const svc = new CredentialsBridgeService();
    expect(svc.readClaudeCreds()).toBeNull();
    expect(svc.lastReadReason()).toBe('keychain_denied');
  });

  it('caches in-process and avoids re-running security when fresh', () => {
    vi.mocked(cp.execSync).mockReturnValueOnce(Buffer.from(keychainPayload(FUTURE)));
    const svc = new CredentialsBridgeService();
    svc.readClaudeCreds();
    svc.readClaudeCreds();
    expect(cp.execSync).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache when explicitly told to', () => {
    vi.mocked(cp.execSync)
      .mockReturnValueOnce(Buffer.from(keychainPayload(FUTURE)))
      .mockReturnValueOnce(Buffer.from(keychainPayload(FUTURE)));
    const svc = new CredentialsBridgeService();
    svc.readClaudeCreds();
    svc.invalidateCache();
    svc.readClaudeCreds();
    expect(cp.execSync).toHaveBeenCalledTimes(2);
  });

  it('re-reads when cache is past its expiry window', () => {
    vi.mocked(cp.execSync)
      .mockReturnValueOnce(Buffer.from(keychainPayload(PAST)))
      .mockReturnValueOnce(Buffer.from(keychainPayload(FUTURE)));
    const svc = new CredentialsBridgeService();
    svc.readClaudeCreds();
    svc.readClaudeCreds();
    expect(cp.execSync).toHaveBeenCalledTimes(2);
  });
});

describe('CredentialsBridgeService.hasClaudeCode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true when Keychain has the entry', () => {
    vi.mocked(cp.execSync).mockReturnValueOnce(Buffer.from(keychainPayload(FUTURE)));
    expect(new CredentialsBridgeService().hasClaudeCode()).toBe(true);
  });

  it('returns true when file fallback exists', () => {
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('no keychain'); });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(keychainPayload(FUTURE));
    expect(new CredentialsBridgeService().hasClaudeCode()).toBe(true);
  });

  it('returns false when neither exists', () => {
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('no keychain'); });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(new CredentialsBridgeService().hasClaudeCode()).toBe(false);
  });
});

describe('CredentialsBridgeService.bridgeAnthropic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  function stubClient(setReturns: boolean) {
    const svc = new OpencodeClientService();
    (svc as unknown as { status: string }).status = 'ready';
    vi.spyOn(svc, 'setOAuthCredentials').mockResolvedValue(setReturns);
    return svc;
  }

  it('calls setOAuthCredentials with the parsed Keychain tokens when fresh', async () => {
    vi.mocked(cp.execSync).mockReturnValueOnce(Buffer.from(keychainPayload(FUTURE)));
    const bridge = new CredentialsBridgeService();
    const client = stubClient(true);
    const out = await bridge.bridgeAnthropic(client);
    expect(out.success).toBe(true);
    expect(client.setOAuthCredentials).toHaveBeenCalledWith('anthropic', {
      access: 'sk-ant-access-XXXX',
      refresh: 'sk-ant-refresh-YYYY',
      expires: FUTURE,
    });
  });

  it('refreshes against Anthropic when both in-memory and Keychain are stale', async () => {
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from(keychainPayload(PAST)));
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'sk-ant-new-access',
        refresh_token: 'sk-ant-new-refresh',
        expires_in: 3600,
      }),
    } as Response);
    const bridge = new CredentialsBridgeService();
    const client = stubClient(true);
    const out = await bridge.bridgeAnthropic(client);
    expect(out.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://claude.ai/v1/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    const setSpy = client.setOAuthCredentials as unknown as ReturnType<typeof vi.fn>;
    expect(setSpy.mock.calls[0][1].access).toBe('sk-ant-new-access');
  });

  it('returns reason="keychain_denied" when Keychain access fails', async () => {
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('denied'); });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const bridge = new CredentialsBridgeService();
    const out = await bridge.bridgeAnthropic(stubClient(true));
    expect(out.success).toBe(false);
    if (!out.success) expect(out.reason).toBe('keychain_denied');
  });

  it('returns reason="refresh_failed" when Anthropic refresh endpoint returns 401', async () => {
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from(keychainPayload(PAST)));
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_grant' }),
    } as Response);
    const bridge = new CredentialsBridgeService();
    const out = await bridge.bridgeAnthropic(stubClient(true));
    expect(out.success).toBe(false);
    if (!out.success) expect(out.reason).toBe('refresh_failed');
  });

  it('invalidates cache when auth.set returns false', async () => {
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from(keychainPayload(FUTURE)));
    const bridge = new CredentialsBridgeService();
    const out = await bridge.bridgeAnthropic(stubClient(false));
    expect(out.success).toBe(false);
    if (!out.success) expect(out.reason).toBe('auth_set_rejected');
    expect(bridge.lastReadReason()).toBe('not_attempted');
  });
});
