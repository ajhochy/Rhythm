import { Router } from 'express';

import { requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { CoordinatorConversationModelStatusService } from '../services/coordinator_conversation_model_status_service';

const unavailable = () => ({ schemaVersion: 1 as const, status: 'unavailable' as const, text: '' as const });

/**
 * Signed, read-only model ingress for the dedicated coordinator. It is not a
 * browser API and it intentionally has no generic memory/history fallback.
 */
export function createCoordinatorAgentToolsRouter(options: {
  service?: Pick<CoordinatorConversationModelStatusService, 'status' | 'startGoal' | 'proposeWorkflow' | 'startWorkflow'>;
} = {}): Router {
  const router = Router();
  router.post('/status', requireLocalOrCloudAuth, async (req, res) => {
    try {
      const result = options.service && req.auth
        ? await options.service.status(req.auth, req.body)
        : unavailable();
      res.json(result);
    } catch {
      res.json(unavailable());
    }
  });
  router.post('/start-goal', requireLocalOrCloudAuth, async (req, res) => {
    try {
      const result = options.service && req.auth
        ? await options.service.startGoal(req.auth, req.body)
        : { schemaVersion: 1 as const, status: 'unavailable' as const, text: 'Coordinator goal action is unavailable.' };
      res.json(result);
    } catch {
      res.json({ schemaVersion: 1 as const, status: 'unavailable' as const, text: 'Coordinator goal action is unavailable.' });
    }
  });
  for (const [path, method] of [['/propose-workflow','proposeWorkflow'], ['/start-workflow','startWorkflow']] as const) {
    router.post(path, requireLocalOrCloudAuth, async (req, res) => {
      try {
        res.json(options.service && req.auth ? await options.service[method](req.auth, req.body)
          : { schemaVersion: 1, status: 'held', text: 'Bounded Coding Workflow is held.' });
      } catch { res.json({ schemaVersion: 1, status: 'held', text: 'Bounded Coding Workflow is held.' }); }
    });
  }
  return router;
}
