import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentDelegationController } from '../controllers/agent_delegation_controller';

const controller = new AgentDelegationController();
export const agentDelegationRouter = Router();

if (!env.agentLocal) agentDelegationRouter.use(requireAuth);

agentDelegationRouter.post('/delegate', controller.delegate.bind(controller));
agentDelegationRouter.post('/delegate-async', controller.delegateAsync.bind(controller));
