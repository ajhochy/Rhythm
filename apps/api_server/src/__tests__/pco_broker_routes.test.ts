/**
 * ROUTE-LEVEL tests for the PCO broker routes — driven through the REAL Express
 * router, controller, and error handler. The service layer (IntegrationsService
 * + PlanningCenterService) is mocked so no real PCO/network/DB is hit.
 *
 *   fetch -> express(pcoBrokerRouter) -> PcoBrokerController (REAL)
 *         -> IntegrationsService (MOCKED) + PlanningCenterService (MOCKED)
 *
 * requireAuth strictly requires a real Bearer token (AGENT_LOCAL does not bypass
 * /integrations). Rather than skip it, the REAL pcoBrokerRouter (which mounts
 * requireAuth itself) is mounted on a tiny express app; AuthService is stubbed
 * so any Bearer token resolves to user id 1. This exercises the full
 * router+requireAuth+controller+error-handler stack with a known identity.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/pco_broker_routes.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';

// --- Mock the service layer the controller depends on. ----------------------
// Stubs declared via vi.hoisted so they exist before the hoisted vi.mock
// factories run.
const stubs = vi.hoisted(() => ({
  freshAccount: { id: 7, provider: 'planning_center', accessToken: 'tok' },
  ensureFreshPlanningCenterAccount: vi.fn(),
  listServiceTypes: vi.fn(),
  listPlans: vi.fn(),
  listPlanItems: vi.fn(),
  listNeededPositions: vi.fn(),
  updatePlanItem: vi.fn(),
  assignPersonToPlan: vi.fn(),
  updateScheduledPerson: vi.fn(),
}));
const {
  freshAccount,
  ensureFreshPlanningCenterAccount,
  listServiceTypes,
  listPlans,
  listPlanItems,
  listNeededPositions,
  updatePlanItem,
  assignPersonToPlan,
  updateScheduledPerson,
} = stubs;

// requireAuth (mounted inside pcoBrokerRouter) strictly demands a Bearer token
// and resolves it via AuthService — AGENT_LOCAL does NOT bypass /integrations.
// Stub AuthService so any token maps to user id 1; the test sends a token.
vi.mock('../services/auth_service', () => ({
  AuthService: class {
    getUserForSessionToken = vi.fn().mockResolvedValue({ id: 1 });
  },
}));

vi.mock('../services/integrations_service', () => ({
  IntegrationsService: class {
    ensureFreshPlanningCenterAccount = stubs.ensureFreshPlanningCenterAccount;
  },
}));

vi.mock('../integrations/planning_center/planning_center_service', async () => {
  // Keep the REAL PcoPermissionError so `instanceof` checks in the controller
  // match what the (mocked) service methods throw.
  const actual = await vi.importActual<
    typeof import('../integrations/planning_center/planning_center_service')
  >('../integrations/planning_center/planning_center_service');
  return {
    PcoPermissionError: actual.PcoPermissionError,
    PlanningCenterService: class {
      listServiceTypes = stubs.listServiceTypes;
      listPlans = stubs.listPlans;
      listPlanItems = stubs.listPlanItems;
      listNeededPositions = stubs.listNeededPositions;
      updatePlanItem = stubs.updatePlanItem;
      assignPersonToPlan = stubs.assignPersonToPlan;
      updateScheduledPerson = stubs.updateScheduledPerson;
    },
  };
});

import express from 'express';
import { pcoBrokerRouter } from '../routes/pco_broker_routes';
import { errorHandler } from '../middleware/error_handler';
import { PcoPermissionError } from '../integrations/planning_center/planning_center_service';

let server: http.Server;
let base: string;

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: 'Bearer test-token',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/integrations/planning-center/api', pcoBrokerRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  ensureFreshPlanningCenterAccount.mockResolvedValue(freshAccount);
});

describe('GET /integrations/planning-center/api/service-types', () => {
  it('returns 200 with the service data and passes the fresh account', async () => {
    const known = [{ id: 'st1', name: 'Sunday' }];
    listServiceTypes.mockResolvedValue(known);

    const { status, body } = await req('GET', '/integrations/planning-center/api/service-types');

    expect(status).toBe(200);
    expect(body).toEqual(known);
    expect(ensureFreshPlanningCenterAccount).toHaveBeenCalledWith(1);
    expect(listServiceTypes).toHaveBeenCalledWith(freshAccount);
  });
});

describe('GET /integrations/planning-center/api/service-types/:id/plans', () => {
  it('threads ?filter=past through to the service', async () => {
    listPlans.mockResolvedValue([]);

    const { status } = await req(
      'GET',
      '/integrations/planning-center/api/service-types/st1/plans?filter=past',
    );

    expect(status).toBe(200);
    expect(listPlans).toHaveBeenCalledWith(freshAccount, 'st1', 'past');
  });

  it('defaults to future and never forwards an unrecognized filter upstream', async () => {
    listPlans.mockResolvedValue([]);

    for (const query of ['', '?filter=future', '?filter=all', '?filter=past%26order%3Dbogus']) {
      await req('GET', `/integrations/planning-center/api/service-types/st1/plans${query}`);
    }

    expect(listPlans.mock.calls.map((call) => call[2])).toEqual([
      'future',
      'future',
      'future',
      'future',
    ]);
  });
});

describe('PCO permission denial signaling', () => {
  it('maps PcoPermissionError to HTTP 403 with code pco_permission_denied (not 500)', async () => {
    listServiceTypes.mockRejectedValue(new PcoPermissionError('nope'));

    const { status, body } = await req('GET', '/integrations/planning-center/api/service-types');

    expect(status).toBe(403);
    expect(body.code).toBe('pco_permission_denied');
    expect(body.message).toBe('nope');
  });
});

describe('write routes', () => {
  it('PATCH item with attributes forwards the attributes object', async () => {
    updatePlanItem.mockResolvedValue({ id: 'i1' });
    const { status, body } = await req(
      'PATCH',
      '/integrations/planning-center/api/service-types/st1/plans/p1/items/i1',
      { attributes: { length: 300 } },
    );
    expect(status).toBe(200);
    expect(body).toEqual({ id: 'i1' });
    expect(updatePlanItem).toHaveBeenCalledWith(freshAccount, 'st1', 'p1', 'i1', {
      length: 300,
    });
  });

  it('PATCH item without attributes builds { title } from req.body.title', async () => {
    updatePlanItem.mockResolvedValue({ id: 'i1' });
    await req(
      'PATCH',
      '/integrations/planning-center/api/service-types/st1/plans/p1/items/i1',
      { title: 'New title' },
    );
    expect(updatePlanItem).toHaveBeenCalledWith(freshAccount, 'st1', 'p1', 'i1', {
      title: 'New title',
    });
  });

  it('POST team-members forwards personId, teamId, positionName', async () => {
    assignPersonToPlan.mockResolvedValue({ id: 'm1' });
    const { status } = await req(
      'POST',
      '/integrations/planning-center/api/plans/p1/team-members',
      { personId: 'pe1', teamId: 't1', positionName: 'Guitar' },
    );
    expect(status).toBe(200);
    expect(assignPersonToPlan).toHaveBeenCalledWith(freshAccount, 'p1', 'pe1', 't1', 'Guitar');
  });

  it('PATCH team-members forwards status', async () => {
    updateScheduledPerson.mockResolvedValue({ id: 'm1' });
    const { status } = await req(
      'PATCH',
      '/integrations/planning-center/api/plans/p1/team-members/m1',
      { status: 'C' },
    );
    expect(status).toBe(200);
    expect(updateScheduledPerson).toHaveBeenCalledWith(freshAccount, 'p1', 'm1', 'C');
  });
});
