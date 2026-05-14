import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as cp from 'child_process';
import * as fs from 'fs';

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
