import { Router, type RequestHandler } from 'express';

import { requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import type { DayflowProviderAdmissionService } from '../services/dayflow_receiving_history_guard';
import { DayflowQualifiedEvidenceService } from '../services/dayflow_qualified_evidence_service';

const unavailable = () => ({ schemaVersion: 1 as const, status: 'unavailable' as const, text: '', blocked: false });

/**
 * Mounted only by the shared server composition after it supplies an actual
 * authenticated receiving-context authority.  This router deliberately has
 * no loopback/local bypass and accepts only the signed call envelope.
 *
 * `POST /provider-admission` is the native per-attempt receiving decision. It
 * shares the same authentication, accepts only the strict versioned request
 * (no caller-supplied owner/project/source/mode) and answers 400 for anything
 * that is not exactly that DTO, which the native side treats as a hold.
 */
export function createDayflowReferencesRouter(options: {
  evidence?: Pick<DayflowQualifiedEvidenceService, 'search' | 'recentSummaries'> &
    Partial<Pick<DayflowQualifiedEvidenceService, 'finalizeResponse'>>;
  providerAdmission?: Pick<DayflowProviderAdmissionService, 'admit'>;
} = {}): Router {
  const router = Router();
  const handler = (method: 'search' | 'recentSummaries'): RequestHandler => async (req, res) => {
    try {
      const response = options.evidence && req.auth
        ? await options.evidence[method](req.auth, req.body)
        : unavailable();
      // Server-only synchronous re-proof after THIS await, immediately before
      // serialization (no await in between).
      res.json(options.evidence?.finalizeResponse ? options.evidence.finalizeResponse(response) : response);
    } catch {
      // The strict MCP consumer parses only the closed Dayflow response; no
      // upstream error, filesystem detail, or receipt metadata escapes here.
      res.json(unavailable());
    }
  };
  if (options.evidence) {
    router.post('/activity/search', requireLocalOrCloudAuth, handler('search'));
    router.post('/activity/recent-summaries', requireLocalOrCloudAuth, handler('recentSummaries'));
  }
  if (options.providerAdmission) {
    router.post('/provider-admission', requireLocalOrCloudAuth, async (req, res) => {
      try {
        const result = req.auth ? await options.providerAdmission!.admit(req.auth, req.body) : { ok: false as const };
        if (!result.ok) {
          res.status(400).json({ schemaVersion: 1, error: 'invalid_request' });
          return;
        }
        // Server-only synchronous re-proof of current facts after THIS await;
        // nothing awaits between it and the response.
        res.json(result.finalize());
      } catch {
        // No body-bearing detail ever leaves; native holds on any non-DTO reply.
        res.status(500).json({ schemaVersion: 1, error: 'unavailable' });
      }
    });
  }
  return router;
}
