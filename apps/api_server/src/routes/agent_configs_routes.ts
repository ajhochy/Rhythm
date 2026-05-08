import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentConfigsController } from '../controllers/agent_configs_controller';

const controller = new AgentConfigsController();
export const agentConfigsRouter = Router();

if (!env.agentLocal) agentConfigsRouter.use(requireAuth);

agentConfigsRouter.get('/', controller.list.bind(controller));
agentConfigsRouter.get('/:id', controller.getOne.bind(controller));
agentConfigsRouter.post('/', controller.create.bind(controller));
agentConfigsRouter.patch('/:id', controller.patch.bind(controller));
agentConfigsRouter.delete('/:id', controller.remove.bind(controller));
