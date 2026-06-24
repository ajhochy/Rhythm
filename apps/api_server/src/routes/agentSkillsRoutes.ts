import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentSkillsController } from '../controllers/agentSkillsController';

const controller = new AgentSkillsController();
export const agentSkillsRouter = Router();

if (!env.agentLocal) agentSkillsRouter.use(requireAuth);

agentSkillsRouter.get('/', controller.list.bind(controller));
agentSkillsRouter.post('/', controller.create.bind(controller));
agentSkillsRouter.get('/:id', controller.getOne.bind(controller));
agentSkillsRouter.patch('/:id', controller.patch.bind(controller));
agentSkillsRouter.delete('/:id', controller.remove.bind(controller));
