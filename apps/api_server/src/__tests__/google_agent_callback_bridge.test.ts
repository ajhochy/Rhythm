/**
 * Verifies the agent step-up Google OAuth callback bridges the granted
 * cloud-platform token into opencode's `google` provider — best-effort:
 * the callback must still respond 200 even when the bridge fails.
 *
 *   AuthController.googleCallback (REAL)
 *     -> mocked GoogleOAuthService.handleCallback
 *     -> mocked googleAgentBridge.bridgeGoogle / startRefreshLoop
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/google_agent_callback_bridge.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

const { handleCallback, getUserForSessionToken, bridgeGoogle, startRefreshLoop } =
  vi.hoisted(() => ({
    handleCallback: vi.fn(),
    getUserForSessionToken: vi.fn(),
    bridgeGoogle: vi.fn(),
    startRefreshLoop: vi.fn(),
  }));

vi.mock('../services/google_oauth_service', async () => {
  const actual = await vi.importActual<
    typeof import('../services/google_oauth_service')
  >('../services/google_oauth_service');
  return {
    ...actual,
    GoogleOAuthService: class {
      handleCallback = handleCallback;
      // beginGoogleOAuth path is not exercised here.
      getAuthorizationUrl() {
        return 'https://accounts.google.com/o/oauth2/v2/auth';
      }
    },
  };
});

vi.mock('../services/auth_service', () => ({
  AuthService: class {
    getUserForSessionToken = getUserForSessionToken;
  },
}));

vi.mock('../services/google_agent_bridge', () => ({
  googleAgentBridge: {
    bridgeGoogle,
    startRefreshLoop,
  },
}));

import { AuthController } from '../controllers/auth_controller';
import { opencodeClient } from '../services/opencode_engine';

function mockRes() {
  const res = {} as Response & {
    statusCode?: number;
    body?: unknown;
    _type?: string;
  };
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.type = vi.fn().mockImplementation((t: string) => {
    res._type = t;
    return res;
  });
  res.send = vi.fn().mockImplementation((b: unknown) => {
    res.body = b;
    return res;
  });
  res.json = vi.fn().mockImplementation((b: unknown) => {
    res.body = b;
    return res;
  });
  res.redirect = vi.fn();
  return res;
}

describe('AuthController.googleCallback agent step-up bridges Gemini token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserForSessionToken.mockResolvedValue({
      id: 99,
      email: 'agent@example.com',
      name: 'Agent User',
    });
    handleCallback.mockResolvedValue(undefined);
  });

  it('invokes bridgeGoogle + startRefreshLoop for intent=agent on success', async () => {
    bridgeGoogle.mockResolvedValue({ success: true, provider: 'google' });
    const controller = new AuthController();
    const req = {
      query: { code: 'auth-code', state: 'tok', intent: 'agent' },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await controller.googleCallback(req, res, next);

    expect(handleCallback).toHaveBeenCalledWith('auth-code', 99);
    expect(bridgeGoogle).toHaveBeenCalledWith(99, opencodeClient);
    expect(startRefreshLoop).toHaveBeenCalledWith(99, opencodeClient);
    expect(res.statusCode).toBe(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('still responds 200 (does not call next with error) when the bridge FAILS', async () => {
    bridgeGoogle.mockResolvedValue({ success: false, reason: 'missing_gemini_scope' });
    const controller = new AuthController();
    const req = {
      query: { code: 'auth-code', state: 'tok', intent: 'agent' },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await controller.googleCallback(req, res, next);

    expect(bridgeGoogle).toHaveBeenCalledWith(99, opencodeClient);
    // bridge failed → no refresh loop started.
    expect(startRefreshLoop).not.toHaveBeenCalled();
    // callback still succeeds — failure is logged, never breaks the redirect.
    expect(res.statusCode).toBe(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('still responds 200 when bridgeGoogle THROWS (best-effort, swallowed)', async () => {
    bridgeGoogle.mockRejectedValue(new Error('boom'));
    const controller = new AuthController();
    const req = {
      query: { code: 'auth-code', state: 'tok', intent: 'agent' },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await controller.googleCallback(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('detects the agent step-up via the state prefix (production round-trip) and bridges', async () => {
    bridgeGoogle.mockResolvedValue({ success: true, provider: 'google' });
    const controller = new AuthController();
    // Production: Google echoes the prefixed state; no separate intent query.
    const req = {
      query: { code: 'auth-code', state: 'agent:tok' },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await controller.googleCallback(req, res, next);

    // session token resolved from the stripped state ('tok')
    expect(getUserForSessionToken).toHaveBeenCalledWith('tok');
    expect(handleCallback).toHaveBeenCalledWith('auth-code', 99);
    expect(bridgeGoogle).toHaveBeenCalledWith(99, opencodeClient);
    expect(startRefreshLoop).toHaveBeenCalledWith(99, opencodeClient);
    expect(res.statusCode).toBe(200);
  });

  it('does NOT bridge for a non-agent (login) callback', async () => {
    const controller = new AuthController();
    const req = {
      query: { code: 'auth-code', state: 'tok' },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await controller.googleCallback(req, res, next);

    expect(bridgeGoogle).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
