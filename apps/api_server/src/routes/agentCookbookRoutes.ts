import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentCookbookController } from '../controllers/agentCookbookController';

const router = Router();
const controller = new AgentCookbookController();

router.use(requireAuth);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.post('/', (req, res, next) => controller.create(req, res, next));
router.patch('/:id', (req, res, next) => controller.update(req, res, next));
router.delete('/:id', (req, res, next) => controller.remove(req, res, next));

export default router;
