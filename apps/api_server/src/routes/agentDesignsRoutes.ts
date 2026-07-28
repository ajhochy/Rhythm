import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentDesignsController } from '../controllers/agentDesignsController';

const router = Router();
const controller = new AgentDesignsController();

if (!env.agentLocal) router.use(requireAuth);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.get('/:id/artifact', (req, res, next) => controller.artifact(req, res, next));
router.get('/:id/thumbnail', (req, res, next) => controller.thumbnail(req, res, next));
router.post('/', (req, res, next) => controller.create(req, res, next));
router.delete('/:id', (req, res, next) => controller.remove(req, res, next));

export default router;
