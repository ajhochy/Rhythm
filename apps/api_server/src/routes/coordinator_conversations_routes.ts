import { Router } from 'express';

import { CoordinatorConversationsController } from '../controllers/coordinator_conversations_controller';
import { requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';

export interface CoordinatorConversationsRouterOptions {
  /** Required explicit runtime gate. Omitted means 404/default-off. */
  enabled?: () => boolean;
  /** C3 injects the composed service after it owns actual adapters/ingress. */
  service: CoordinatorConversationService;
}

/**
 * The app mounts this only when it composes a capability-qualified service
 * behind the existing explicit local coordinator gate. Importing the router
 * never installs it or creates a background ingress by itself.
 */
export function createCoordinatorConversationsRouter(
  options: CoordinatorConversationsRouterOptions,
): Router {
  const router = Router();
  const controller = new CoordinatorConversationsController(options.service);
  const enabled = options.enabled ?? (() => false);
  router.use((_req, res, next) => enabled() ? next() : res.sendStatus(404));
  router.use(requireLocalOrCloudAuth);
  router.post('/setup', (req, res, next) => void controller.setup(req, res, next));
  router.post('/resolve', (req, res, next) => controller.resolve(req, res, next));
  router.post('/open', (req, res, next) => controller.open(req, res, next));
  router.post('/status', (req, res, next) => void controller.status(req, res, next));
  router.post('/message', (req, res, next) => void controller.message(req, res, next));
  router.post('/history', (req, res, next) => controller.history(req, res, next));
  router.post('/goals', (req, res, next) => controller.addGoal(req, res, next));
  router.post('/prepare-plan', (req, res, next) => void controller.preparePlan(req, res, next));
  router.post('/continue-plan', (req, res, next) => void controller.continuePlan(req, res, next));
  return router;
}
