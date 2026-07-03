import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { getRunQualityRollup } from '../services/run_quality_service';

export const runQualityRouter = Router();

if (!env.agentLocal) runQualityRouter.use(requireAuth);

/**
 * GET /agents/run-quality
 *
 * Plain-language QUALITY scorecard for recent agent runs (#865), DISTINCT
 * from the per-provider SPEND view (GET /agents/usage-budget). Per agent
 * (agent_kind grouping): completion vs escalation, token waste (a subset of
 * spend — see run_quality_service.ts doc comment), user corrections, and
 * repeated mistakes. READ-ONLY — never wired into the org-optimizer auto-tune
 * loop (#816 is the separate, explicitly-scoped concern for that).
 *
 * Query params:
 *   windowDays  Lookback window in days (default 30).
 */
runQualityRouter.get('/', (req: Request, res: Response) => {
  try {
    const windowDaysRaw = req.query.windowDays;
    const windowDays =
      typeof windowDaysRaw === 'string' && Number.isFinite(Number(windowDaysRaw)) && Number(windowDaysRaw) > 0
        ? Number(windowDaysRaw)
        : undefined;
    const rollup = getRunQualityRollup({ windowDays });
    res.json(rollup);
  } catch (err) {
    res.status(503).json({ error: 'run quality rollup unavailable', detail: String(err) });
  }
});
