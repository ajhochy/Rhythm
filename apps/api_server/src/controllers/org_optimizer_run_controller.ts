/** Compatibility routes for the retired Org Self-Optimizer execution seam. */

import type { NextFunction, Request, Response } from 'express';

const RETIRED_RESPONSE = {
  error: {
    code: 'org_optimizer_retired',
    message: 'Org Self-Optimizer execution is retired. Use the weekly Org Reviewer and the human proposal queue.',
  },
} as const;

export class OrgOptimizerRunController {
  async run(_req: Request, res: Response, _next: NextFunction) {
    res.status(410).json(RETIRED_RESPONSE);
  }

  async runExternalDiscovery(_req: Request, res: Response, _next: NextFunction) {
    res.status(410).json(RETIRED_RESPONSE);
  }
}
