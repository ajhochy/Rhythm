import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentResearchController } from '../controllers/agentResearchController';

const router = Router();
const controller = new AgentResearchController();

if (!env.agentLocal) router.use(requireAuth);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.post('/', (req, res, next) => controller.create(req, res, next));
router.post('/:id/retry', (req, res, next) => controller.retry(req, res, next));
router.patch('/:id/status', (req, res, next) => controller.updateStatus(req, res, next));

export default router;
