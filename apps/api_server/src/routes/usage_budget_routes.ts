import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { getUsageBudget } from '../services/usage_budget_service';

export const usageBudgetRouter = Router();

if (!env.agentLocal) usageBudgetRouter.use(requireAuth);

/**
 * GET /agents/usage-budget
 *
 * Real, time-accurate per-provider usage for the side-panel "Usage Budget"
 * tracker. Served from a short-lived server cache; pass `?force=true` for a
 * manual refresh. See usage_budget_service for the per-provider data sources.
 */
usageBudgetRouter.get('/', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';
    const snapshot = await getUsageBudget({ force });
    res.json(snapshot);
  } catch (err) {
    res
      .status(503)
      .json({ error: 'usage budget unavailable', detail: String(err) });
  }
});
