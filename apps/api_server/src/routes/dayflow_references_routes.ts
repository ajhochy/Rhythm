import { Router, type RequestHandler } from 'express';

import { requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { DayflowQualifiedEvidenceService } from '../services/dayflow_qualified_evidence_service';

const unavailable = () => ({ schemaVersion: 1 as const, status: 'unavailable' as const, text: '', blocked: false });

/**
 * Mounted only by the shared server composition after it supplies an actual
 * authenticated receiving-context authority.  This router deliberately has
 * no loopback/local bypass and accepts only the signed call envelope.
 */
export function createDayflowReferencesRouter(options: {
  evidence?: Pick<DayflowQualifiedEvidenceService, 'search' | 'recentSummaries'>;
} = {}): Router {
  const router = Router();
  const handler = (method: 'search' | 'recentSummaries'): RequestHandler => async (req, res) => {
    try {
      const response = options.evidence && req.auth
        ? await options.evidence[method](req.auth, req.body)
        : unavailable();
      res.json(response);
    } catch {
      // The strict MCP consumer parses only the closed Dayflow response; no
      // upstream error, filesystem detail, or receipt metadata escapes here.
      res.json(unavailable());
    }
  };
  router.post('/activity/search', requireLocalOrCloudAuth, handler('search'));
  router.post('/activity/recent-summaries', requireLocalOrCloudAuth, handler('recentSummaries'));
  return router;
}
