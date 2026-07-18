/**
 * #1096 WP1 — authenticated, loopback, READ-ONLY status/action endpoints for
 * the device-local Engraph backend manager.
 *
 * "Read-only" here describes what these endpoints let a caller DO to memory
 * content: nothing. Every route below only inspects or changes the MANAGER's
 * own lifecycle state (enabled/disabled, which binary, health) — none of them
 * read indexed memory content, accept a write payload for a note, or accept
 * an arbitrary index path. That control surface is intentionally separate
 * from (and never bypasses) the managed Engraph service's own read-only,
 * loopback, authenticated contract (see engraph_manager.ts).
 *
 * Auth follows the SAME convention as every other agent-local surface (e.g.
 * agent_capability_status_routes.ts, system_routes.ts): on the local agent
 * server (AGENT_LOCAL=true) the loopback boundary IS the trust boundary; on
 * hosted prod a real Bearer session token is required.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { AppError } from '../errors/app_error';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { engraphManager } from '../services/engraph_manager';

export const engraphManagerRouter = Router();

/**
 * Kick off a (potentially slow — indexing + spawn + up-to-45s health-gate)
 * lifecycle action WITHOUT awaiting it, so this HTTP response — and every
 * other concurrent request — is never blocked on it. The caller polls
 * GET /status (which reflects 'indexing'/'starting'/'ready'/'error' as the
 * action progresses) exactly the way the issue's "non-blocking setup state"
 * requirement describes. Errors are already persisted to status by the
 * manager itself; this only guards against an unhandled rejection.
 */
function fireAndForget(action: Promise<unknown>): void {
  action.catch((err) => {
    logger.warn(`[engraph-manager routes] background lifecycle action failed (non-fatal): ${String(err)}`);
  });
}

if (!env.agentLocal) engraphManagerRouter.use(requireAuth);

engraphManagerRouter.get('/status', (_req: Request, res: Response) => {
  res.json(engraphManager.getStatus());
});

engraphManagerRouter.get('/discover', (_req: Request, res: Response) => {
  res.json({ candidates: engraphManager.discover() });
});

engraphManagerRouter.post(
  '/choose-binary',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const candidatePath = req.body?.path;
      if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
        throw AppError.badRequest('path is required');
      }
      const result = await engraphManager.chooseBinary(candidatePath);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

engraphManagerRouter.post('/enable', (_req: Request, res: Response) => {
  fireAndForget(engraphManager.enable());
  res.json({ accepted: true, status: engraphManager.getStatus() });
});

engraphManagerRouter.post('/disable', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await engraphManager.disable();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

engraphManagerRouter.post('/check-health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await engraphManager.checkHealthNow());
  } catch (err) {
    next(err);
  }
});

engraphManagerRouter.post('/retry', (_req: Request, res: Response) => {
  fireAndForget(engraphManager.retry());
  res.json({ accepted: true, status: engraphManager.getStatus() });
});

engraphManagerRouter.post('/rebuild', (_req: Request, res: Response) => {
  fireAndForget(engraphManager.rebuild());
  res.json({ accepted: true, status: engraphManager.getStatus() });
});
