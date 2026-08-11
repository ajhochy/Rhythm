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

describe('PlanningCenterService broker reads', () => {
  it('maps upstream 403 to PcoPermissionError for every brokered read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })));
    const service = new PlanningCenterService();
    await expect(service.listServiceTypes(acct())).rejects.toBeInstanceOf(PcoPermissionError);
    await expect(service.listPlans(acct(), 'st1')).rejects.toBeInstanceOf(PcoPermissionError);
    await expect(service.listPlanItems(acct(), 'st1', 'p1')).rejects.toBeInstanceOf(PcoPermissionError);
    await expect(service.listNeededPositions(acct(), 'st1', 'p1')).rejects.toBeInstanceOf(PcoPermissionError);
  });
});

const OFFICIAL = 'https://api.planningcenteronline.com';

describe('PlanningCenterService read base URL safety', () => {
  const original = { live: process.env.RHYTHM_LIVE_E2E, base: process.env.RHYTHM_PCO_LIVE_BASE_URL };
  function setEnv(live: string | undefined, base: string | undefined) {
    if (live === undefined) delete process.env.RHYTHM_LIVE_E2E; else process.env.RHYTHM_LIVE_E2E = live;
    if (base === undefined) delete process.env.RHYTHM_PCO_LIVE_BASE_URL; else process.env.RHYTHM_PCO_LIVE_BASE_URL = base;
  }
  afterEach(() => setEnv(original.live, original.base));

  async function readUrl(live: string | undefined, base: string | undefined): Promise<string> {
    setEnv(live, base);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new PlanningCenterService().listServiceTypes(acct());
    return String(fetchMock.mock.calls[0][0]);
  }

  // Only a live-flagged loopback override may redirect reads. Everything else must reach production PCO,
  // so a stray/hostile env value can never silently point brokered reads at an attacker-controlled host.
  const cases: Array<[string, string | undefined, string | undefined, string]> = [
    ['no override at all', undefined, undefined, OFFICIAL],
    ['override without the live flag', undefined, 'http://127.0.0.1:4199', OFFICIAL],
    ['live flag with a non-loopback host', '1', 'https://attacker.test', OFFICIAL],
    ['live flag with a loopback-looking hostile host', '1', 'https://127.0.0.1.attacker.test', OFFICIAL],
    ['live flag with embedded credentials', '1', 'http://user:pass@127.0.0.1:4199', OFFICIAL],
    ['live flag with a non-http scheme', '1', 'file:///etc/passwd', OFFICIAL],
    ['live flag with an unparseable value', '1', 'not a url', OFFICIAL],
    // Deliberate fail-closed seam: URL.hostname normalizes IPv6 loopback to `[::1]`, while the
    // explicit allowlist is `::1`; retain rejection until a live fixture needs IPv6 support.
    ['live flag with IPv6 loopback (deliberate fail-closed seam)', '1', 'http://[::1]:4199', OFFICIAL],
    ['live flag off by value', '0', 'http://127.0.0.1:4199', OFFICIAL],
    ['live flag with loopback ip', '1', 'http://127.0.0.1:4199', 'http://127.0.0.1:4199'],
    ['live flag with localhost', '1', 'http://localhost:4199/ignored/path', 'http://localhost:4199'],
  ];
  it.each(cases)('resolves %s to the expected origin', async (_label, live, base, expected) => {
    expect(await readUrl(live, base)).toBe(`${expected}/services/v2/service_types?per_page=100`);
  });

  it('never redirects writes, even under a live loopback override', async () => {
    setEnv('1', 'http://127.0.0.1:4199');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'i1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new PlanningCenterService().updatePlanItem(acct(), 'st1', 'p1', 'i1', { title: 'X' });
    expect(String(fetchMock.mock.calls[0][0]).startsWith(OFFICIAL)).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('127.0.0.1');
  });
});
