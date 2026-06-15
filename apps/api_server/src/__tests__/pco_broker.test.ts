import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanningCenterService } from '../integrations/planning_center/planning_center_service';
import type { IntegrationAccount } from '../models/integration_account';

function acct(): IntegrationAccount {
  return {
    id: 'p', ownerId: 1, provider: 'planning_center', externalAccountId: 's',
    email: null, displayName: null, status: 'connected',
    accessToken: 'at', refreshToken: 'rt', scope: 'openid services',
    tokenType: 'Bearer', expiresAt: null, lastSyncedAt: null,
    errorMessage: null, createdAt: '', updatedAt: '',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('PlanningCenterService.listServiceTypes', () => {
  it('GETs service_types with the account bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'st1', attributes: { name: 'Sunday' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const svc = new PlanningCenterService();
    const result = await svc.listServiceTypes(acct());
    expect(result).toEqual([{ id: 'st1', name: 'Sunday' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/services/v2/service_types');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at');
  });
});

describe('PlanningCenterService.listPlans', () => {
  it('GETs future plans for a service type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'p1', attributes: { title: 'Plan A', dates: 'Jan 5' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const svc = new PlanningCenterService();
    const result = await svc.listPlans(acct(), 'st1');
    expect(result).toEqual([{ id: 'p1', title: 'Plan A', dates: 'Jan 5' }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/services/v2/service_types/st1/plans?filter=future',
    );
  });
});
