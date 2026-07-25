import { describe, expect, it, vi } from 'vitest';

import type { User } from '../../models/user';
import { MobileCloudIdentityService } from '../mobile_cloud_identity_service';

const user: User = {
  id: 42,
  name: 'AJ',
  email: 'aj@example.com',
  googleSub: 'google-aj',
  photoUrl: null,
  role: 'member',
  isFacilitiesManager: false,
  emailNotificationsEnabled: true,
  timezone: 'America/Los_Angeles',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
};

describe('MobileCloudIdentityService', () => {
  it('accepts an authenticated local session without calling Cloud', async () => {
    const fetchFn = vi.fn();
    const service = new MobileCloudIdentityService({
      localSessions: {
        getUserForSessionToken: vi.fn().mockResolvedValue(user),
      },
      fetchFn,
    });

    await expect(service.authenticateBearerToken('local-token')).resolves.toBe(
      user,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('validates a production bearer token against Rhythm Cloud /auth/me', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user, workspace: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const service = new MobileCloudIdentityService({
      localSessions: {
        getUserForSessionToken: vi.fn().mockResolvedValue(null),
      },
      cloudBaseUrl: 'https://rhythm-cloud.example/',
      fetchFn,
    });

    await expect(service.authenticateBearerToken('cloud-token')).resolves.toEqual(
      user,
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://rhythm-cloud.example/auth/me',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: 'Bearer cloud-token',
        }),
      }),
    );
  });

  it('fails closed for rejected, malformed, and unavailable Cloud identity', async () => {
    const localSessions = {
      getUserForSessionToken: vi.fn().mockResolvedValue(null),
    };
    const rejected = new MobileCloudIdentityService({
      localSessions,
      fetchFn: vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    });
    const malformed = new MobileCloudIdentityService({
      localSessions,
      fetchFn: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { id: 'not-a-user' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });
    const unavailable = new MobileCloudIdentityService({
      localSessions,
      fetchFn: vi.fn().mockRejectedValue(new Error('secret upstream detail')),
    });

    await expect(rejected.authenticateBearerToken('rejected')).resolves.toBeNull();
    await expect(malformed.authenticateBearerToken('malformed')).resolves.toBeNull();
    await expect(unavailable.authenticateBearerToken('unavailable')).rejects.toMatchObject({
      statusCode: 503,
      code: 'AUTH_UNAVAILABLE',
      message: 'Rhythm Cloud authentication is unavailable',
    });
  });
});
