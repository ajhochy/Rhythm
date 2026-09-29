import { Router, json } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import {
  DecisionConfigError,
  buildConfigViewWithCatalog,
  testConfig,
  updateConfigWithCatalog,
} from '../services/decision/decision_config_service';
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

// Router backend settings (local / Jev / custom). API keys are write-only.
router.get('/config', async (_req, res) => {
  try {
    res.json(await buildConfigViewWithCatalog());
  } catch (err) {
    sendConfigError(err, res);
  }
});

function sendConfigError(err: unknown, res: import('express').Response): void {
  if (err instanceof DecisionConfigError) {
    res.status(400).json({ error: err.code, message: err.message });
    return;
  }
  res.status(500).json({ error: 'internal_error', message: 'Could not process router settings.' });
}

router.put('/config', json({ limit: '256kb' }), async (req, res) => {
  try {
    res.json(await updateConfigWithCatalog(req.body));
  } catch (err) {
    sendConfigError(err, res);
  }
});

router.post('/config/test', json({ limit: '32kb' }), async (req, res) => {
  try {
    res.json(await testConfig(req.body && Object.keys(req.body).length ? req.body : {}));
  } catch (err) {
    sendConfigError(err, res);
  }
});

export default router;
