import { Router } from 'express';

import { env } from '../config/env';
import { requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { AgentWorkstreamsController } from '../controllers/agent_workstreams_controller';
import type { PersistentWorkstreamCoordinator } from '../services/persistent_workstream_coordinator';

export function createAgentWorkstreamsRouter(
  coordinator?: PersistentWorkstreamCoordinator,
): Router {
  const router = Router();
  const controller = new AgentWorkstreamsController(coordinator);
  router.use((_req, res, next) => env.workstreamsEnabled ? next() : res.sendStatus(404));
  router.use(requireLocalOrCloudAuth);
  router.post('/', (req, res, next) => controller.create(req, res, next));
  router.get('/', (req, res, next) => void controller.list(req, res, next));
  router.get('/:id/automation', (req, res, next) => void controller.automationStatus(req, res, next));
  router.get('/:id/evidence', (req, res, next) => void controller.inspectEvidence(req, res, next));
  router.get('/:id', (req, res, next) => void controller.get(req, res, next));
  router.patch('/:id', (req, res, next) => controller.revise(req, res, next));
  router.post('/:id/run-next', (req, res, next) => void controller.runNext(req, res, next));
  router.put('/:id/automation', (req, res, next) => void controller.configureAutomation(req, res, next));
  router.post('/:id/automation/disable', (req, res, next) => void controller.disableAutomation(req, res, next));
  router.post('/:id/pause', (req, res, next) => void controller.pause(req, res, next));
  router.post('/:id/resume', (req, res, next) => void controller.resume(req, res, next));
  router.post('/:id/cancel', (req, res, next) => void controller.cancel(req, res, next));
  router.post('/:id/usage-acknowledgement', (req, res, next) =>
    void controller.acknowledgeUsage(req, res, next));
  router.post('/:id/reconcile-unknown', (req, res, next) =>
    void controller.reconcileUnknownFromEngine(req, res, next));
  router.post('/:id/criteria/waive', (req, res, next) =>
    void controller.waiveCriterion(req, res, next));
  router.post('/:id/criteria/waive-batch', (req, res, next) =>
    void controller.waiveCriteria(req, res, next));
  router.post('/:id/criteria/verify', (req, res, next) =>
    void controller.verifyCriteria(req, res, next));
  return router;
}

export const agentWorkstreamsRouter = createAgentWorkstreamsRouter();
