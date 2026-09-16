import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../services/org_optimizer_run_service', () => ({
  runOrgOptimizer: vi.fn(),
}));
vi.mock('../services/gap_discovery_scheduler', () => ({
  runGapDrivenDiscoveryPass: vi.fn(),
}));

import { runOrgOptimizer } from '../services/org_optimizer_run_service';
import { runGapDrivenDiscoveryPass } from '../services/gap_discovery_scheduler';
import { OrgOptimizerRunController } from '../controllers/org_optimizer_run_controller';

describe('OrgOptimizerRunController — retired execution seams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['run'],
    ['runExternalDiscovery'],
  ] as const)('returns 410 from %s without running a generator or mutating caller state', async (method) => {
    const body = { target: { revision: 7 }, queue: ['existing-proposal'] };
    const snapshot = structuredClone(body);
    const req = { body, socket: { setTimeout: vi.fn() } } as unknown as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    const controller = new OrgOptimizerRunController();
    await controller[method](req, res, next);

    expect(status).toHaveBeenCalledWith(410);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'org_optimizer_retired',
        message: expect.stringContaining('weekly Org Reviewer'),
      },
    });
    expect(runOrgOptimizer).not.toHaveBeenCalled();
    expect(runGapDrivenDiscoveryPass).not.toHaveBeenCalled();
    expect(body).toEqual(snapshot);
    expect(next).not.toHaveBeenCalled();
  });
});
