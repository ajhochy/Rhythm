import { Router } from 'express';

import { env } from '../config/env';
import { AgentActivityController } from '../controllers/agent_activity_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new AgentActivityController();

export const agentActivityRouter = Router();

if (!env.agentLocal) agentActivityRouter.use(requireAuth);

agentActivityRouter.get('/', (req, res, next) =>
  controller.list(req, res, next));
