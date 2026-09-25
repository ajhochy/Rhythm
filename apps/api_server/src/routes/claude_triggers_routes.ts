import { Router } from 'express';
import { env } from '../config/env';
import { authenticateIfPresent, requireAuth } from '../middleware/auth_middleware';
import { ClaudeTriggersController } from '../controllers/claude_triggers_controller';

const router = Router();
const controller = new ClaudeTriggersController();

router.use((req, res, next) => {
  void (env.agentLocal
    ? authenticateIfPresent(req, res, next)
    : requireAuth(req, res, next));
});

router.get('/', (req, res, next) => controller.list(req, res, next));
router.delete('/:id', (req, res, next) => controller.remove(req, res, next));

export default router;
