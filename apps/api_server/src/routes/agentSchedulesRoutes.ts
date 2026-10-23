import { Router } from 'express';
import { authenticateIfPresent, requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentSchedulesController } from '../controllers/agentSchedulesController';

const router = Router();
const controller = new AgentSchedulesController();

if (env.agentLocal) {
  router.use((req, res, next) => {
    // The paired mobile gateway has already verified Device identity and set
    // both fields. requireAuth validates that server-created context without
    // interpreting a Device token as a desktop Bearer token.
    if (req.mobileDevice) return requireAuth(req, res, next);
    return authenticateIfPresent(req, res, next);
  });
} else {
  router.use(requireAuth);
}

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.get('/:id/runs', (req, res, next) => controller.listRuns(req, res, next));
router.post('/', (req, res, next) => controller.create(req, res, next));
router.patch('/:id', (req, res, next) => controller.update(req, res, next));
router.delete('/:id', (req, res, next) => controller.remove(req, res, next));
router.post('/:id/trigger-now', (req, res, next) => controller.triggerNow(req, res, next));

export default router;
