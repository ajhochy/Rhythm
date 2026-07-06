/**
 * #894 — GET /agent-capability-status
 *
 * Lets an agent session (or a human) query current integration health before
 * relying on it, instead of discovering a dead integration partway through a
 * long-running agent action. See capability_status_checker.ts for scope.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { checkCapabilities } from '../services/capability_status_checker';

export const agentCapabilityStatusRouter = Router();

if (!env.agentLocal) agentCapabilityStatusRouter.use(requireAuth);

agentCapabilityStatusRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await checkCapabilities();
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);
