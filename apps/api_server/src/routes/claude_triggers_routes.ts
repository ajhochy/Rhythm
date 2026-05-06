import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { ClaudeTriggersController } from '../controllers/claude_triggers_controller';

const router = Router();
const controller = new ClaudeTriggersController();

router.use(requireAuth);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.delete('/:id', (req, res, next) => controller.remove(req, res, next));

export default router;
