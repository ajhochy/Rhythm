import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentConfigsController } from '../controllers/agent_configs_controller';

const controller = new AgentConfigsController();
export const agentConfigsRouter = Router();

if (!env.agentLocal) agentConfigsRouter.use(requireAuth);

agentConfigsRouter.get('/', controller.list.bind(controller));
// Registered before '/:id' so "sync-opencode"/"export"/"import" are never
// treated as an id.
agentConfigsRouter.post('/sync-opencode', controller.syncOpencode.bind(controller));
agentConfigsRouter.get('/export', controller.export.bind(controller));
agentConfigsRouter.post('/import', controller.import.bind(controller));
agentConfigsRouter.get('/:id', controller.getOne.bind(controller));
agentConfigsRouter.post('/', controller.create.bind(controller));
agentConfigsRouter.patch('/:id', controller.patch.bind(controller));
agentConfigsRouter.delete('/:id', controller.remove.bind(controller));
