import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { NotificationsAgentController } from '../controllers/notifications_agent_controller';
import { env } from '../config/env';

export const notificationsAgentRouter = Router();
const controller = new NotificationsAgentController();

if (!env.agentLocal) notificationsAgentRouter.use(requireAuth);

notificationsAgentRouter.post('/', controller.post.bind(controller));
