import { describe, expect, it } from 'vitest';
import { deriveAccountStatus } from '../controllers/integrations_status';
import type { IntegrationAccount } from '../models/integration_account';

function account(overrides: Partial<IntegrationAccount>): IntegrationAccount {
  return {
    id: 'acc-1',
    ownerId: 1,
    provider: 'google_calendar',
    externalAccountId: 'sub-1',
    email: 'a@example.com',
    displayName: 'A',
    status: 'connected',
    accessToken: 'at',
    refreshToken: 'rt',
    scope:
      'openid email profile https://www.googleapis.com/auth/calendar.readonly',
    tokenType: 'Bearer',
    expiresAt: null,
    lastSyncedAt: null,
    errorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveAccountStatus(google_calendar)', () => {
  it('connected when calendar scope + refresh token present', () => {
    expect(deriveAccountStatus('google_calendar', account({}))).toEqual({
      status: 'connected',
      needsReauth: false,
    });
  });

  it('connected when full calendar scope present', () => {
    const a = account({
      scope: 'openid https://www.googleapis.com/auth/calendar',
    });
    expect(deriveAccountStatus('google_calendar', a).status).toBe('connected');
  });

  it('needs_reauth when calendar scope missing (legacy account)', () => {
    const a = account({ scope: 'openid email profile' });
    expect(deriveAccountStatus('google_calendar', a)).toEqual({
      status: 'needs_reauth',
      needsReauth: true,
    });
  });

  it('needs_reauth when refresh token missing', () => {
    const a = account({ refreshToken: null });
    expect(deriveAccountStatus('google_calendar', a)).toEqual({
      status: 'needs_reauth',
      needsReauth: true,
    });
  });

  it('error when account row is in error state', () => {
    const a = account({ status: 'error' });
    expect(deriveAccountStatus('google_calendar', a)).toEqual({
      status: 'error',
      needsReauth: false,
    });
  });

  it('disconnected when no account', () => {
    expect(deriveAccountStatus('google_calendar', null)).toEqual({
      status: 'disconnected',
      needsReauth: false,
    });
  });
});

import { buildAccountDto } from '../controllers/integrations_controller';

describe('buildAccountDto', () => {
  it('uses derived status and exposes needsReauth', () => {
    const dto = buildAccountDto('google_calendar', null);
    expect(dto.status).toBe('disconnected');
    expect(dto.needsReauth).toBe(false);
  });
});
