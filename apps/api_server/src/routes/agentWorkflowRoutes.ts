import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentWorkflowController } from '../controllers/agentWorkflowController';

const router = Router();
const controller = new AgentWorkflowController();

// #1485 S3a-1 — Flutter start/get/cancel send no bearer for local-agent
// routes (mirrors agentCookbookRoutes.ts); do not add blanket bearer
// middleware ahead of these routes.
if (!env.agentLocal) router.use(requireAuth);

router.post('/', (req, res, next) => controller.start(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.post('/:id/cancel', (req, res, next) => controller.cancel(req, res, next));

export default router;
