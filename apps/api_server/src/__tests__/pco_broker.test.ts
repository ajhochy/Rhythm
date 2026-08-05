import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanningCenterService, PcoPermissionError } from '../integrations/planning_center/planning_center_service';
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
    expect(String(url)).toContain('per_page=100');
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
    expect(String(fetchMock.mock.calls[0][0])).toContain('per_page=100');
  });

  /**
   * The filter used to be hard-coded to `future`, so pco-song-usage-sync — a
   * job whose entire input is which songs were played on PAST service dates —
   * had no reachable data through Rhythm and reported "could not complete" on
   * every run.
   */
  it('GETs past plans newest-first when asked for them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'p9', attributes: { title: 'Last Sunday', dates: 'Aug 2' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const svc = new PlanningCenterService();
    const result = await svc.listPlans(acct(), 'st1', 'past');
    expect(result).toEqual([{ id: 'p9', title: 'Last Sunday', dates: 'Aug 2' }]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('filter=past');
    expect(url).not.toContain('filter=future');
    // Without this, PCO's default ascending sort_date returns the OLDEST plans
    // in the service type's history instead of the recent ones.
    expect(url).toContain('order=-sort_date');
  });

  it('leaves future listings unordered so existing callers are unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new PlanningCenterService().listPlans(acct(), 'st1', 'future');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('order=');
  });
});

describe('PlanningCenterService.updatePlanItem', () => {
  it('PATCHes the item and returns its id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: 'i1', attributes: { title: 'New' } } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const svc = new PlanningCenterService();
    const res = await svc.updatePlanItem(acct(), 'st1', 'p1', 'i1', { title: 'New' });
    expect(res.id).toBe('i1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      '/services/v2/service_types/st1/plans/p1/items/i1',
    );
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    const body = JSON.parse(init.body as string);
    expect(body.data.attributes.title).toBe('New');
  });

  it('maps a PCO 403 to PcoPermissionError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })),
    );
    const svc = new PlanningCenterService();
    await expect(
      svc.updatePlanItem(acct(), 'st1', 'p1', 'i1', { title: 'X' }),
    ).rejects.toBeInstanceOf(PcoPermissionError);
  });
});
