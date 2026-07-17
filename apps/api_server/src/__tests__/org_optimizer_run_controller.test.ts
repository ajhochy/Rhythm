import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// #1115 — org_optimizer_run_controller holds this request open for the
// entire synchronous run (200-600s observed). Server-side, we defend
// against the socket being torn down mid-run (matching the raised
// client-side timeout in mcp_server/api_client.ts) rather than relying on
// Node's implicit http.Server default.
vi.mock('../services/org_optimizer_run_service', () => ({
  runOrgOptimizer: vi.fn(),
}));

import { runOrgOptimizer } from '../services/org_optimizer_run_service';
import { OrgOptimizerRunController } from '../controllers/org_optimizer_run_controller';

describe('OrgOptimizerRunController — #1115 server-side socket timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables the request socket timeout before starting the run', async () => {
    const fakeResult = { proposalsCreated: 0, capped: false, byKind: {}, byRisk: {}, byOutcome: {}, auditRunId: 'run-1' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(runOrgOptimizer).mockResolvedValue(fakeResult as any);

    const setTimeoutSpy = vi.fn();
    const req = { body: {}, socket: { setTimeout: setTimeoutSpy } } as unknown as Request;
    const json = vi.fn();
    const res = { json } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    const controller = new OrgOptimizerRunController();
    await controller.run(req, res, next);

    expect(setTimeoutSpy).toHaveBeenCalledWith(0);
    expect(json).toHaveBeenCalledWith(fakeResult);
    expect(next).not.toHaveBeenCalled();
  });

  it('still forwards a thrown error to next() (unchanged behavior)', async () => {
    vi.mocked(runOrgOptimizer).mockRejectedValue(new Error('boom'));

    const req = { body: {}, socket: { setTimeout: vi.fn() } } as unknown as Request;
    const json = vi.fn();
    const res = { json } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    const controller = new OrgOptimizerRunController();
    await controller.run(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
