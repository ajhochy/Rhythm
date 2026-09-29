import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { listDecisions, summarizeDecisions } from '../services/decision/decision_log';

const router = Router();

if (!env.agentLocal) router.use(requireAuth);

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// GET /agent-decisions?feature=&limit=&since=<ISO> — recent rows + per-feature stats.
router.get('/', (req, res) => {
  const feature = queryString(req.query.feature);
  const sinceIso = queryString(req.query.since);
  const limit = Number(queryString(req.query.limit));
  res.json({
    recent: listDecisions({
      feature,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    }),
    summary: summarizeDecisions({ feature, sinceIso }),
  });
});

export default router;
