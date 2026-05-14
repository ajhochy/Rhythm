import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import type { GithubCopilotDeviceAuth as GithubCopilotDeviceAuthType } from '../services/github_copilot_device_auth';

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    setOAuthCredentials: vi.fn().mockResolvedValue(true),
  },
}));

let GithubCopilotDeviceAuth: typeof GithubCopilotDeviceAuthType;

beforeAll(async () => {
  const mod = await import('../services/github_copilot_device_auth');
  GithubCopilotDeviceAuth = mod.GithubCopilotDeviceAuth;
});

describe('GithubCopilotDeviceAuth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts a device flow and returns the user code', async () => {
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        verification_uri: 'https://github.com/login/device',
        user_code: 'ABCD-1234',
        device_code: 'devcode',
        interval: 5,
        expires_in: 900,
      }),
    } as Response);
    const auth = new GithubCopilotDeviceAuth();
    const out = await auth.start();
    expect(out).toEqual({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
    });
    expect(auth.status()?.status).toBe('pending');
    auth.cancel();
  });

  it('transitions to success when GitHub returns access_token', async () => {
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          verification_uri: 'u',
          user_code: 'u',
          device_code: 'devcode',
          interval: 1,
          expires_in: 900,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'ghp_test' }),
      } as Response);
    const auth = new GithubCopilotDeviceAuth();
    await auth.start();
    // Advance timer to fire the first poll, then run all pending microtasks
    // and macrotasks so the async poll() resolves fully.
    await vi.runAllTimersAsync();
    expect(auth.status()?.status).toBe('success');
    auth.cancel();
  });

  it('transitions to failed when GitHub returns an error', async () => {
    vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          verification_uri: 'u',
          user_code: 'u',
          device_code: 'devcode',
          interval: 1,
          expires_in: 900,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'access_denied' }),
      } as Response);
    const auth = new GithubCopilotDeviceAuth();
    await auth.start();
    await vi.runAllTimersAsync();
    expect(auth.status()?.status).toBe('failed');
    expect(auth.status()?.reason).toBe('access_denied');
    auth.cancel();
  });
});
