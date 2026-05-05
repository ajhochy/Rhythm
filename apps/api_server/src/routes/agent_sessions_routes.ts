import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentSessionsController } from '../controllers/agent_sessions_controller';

const controller = new AgentSessionsController();
export const agentSessionsRouter = Router();

agentSessionsRouter.use(requireAuth);

agentSessionsRouter.get('/', controller.list.bind(controller));
agentSessionsRouter.get('/:id', controller.getOne.bind(controller));
agentSessionsRouter.post('/', controller.create.bind(controller));
agentSessionsRouter.delete('/:id', controller.remove.bind(controller));
agentSessionsRouter.get('/:id/messages', controller.listMessages.bind(controller));
