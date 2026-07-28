import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentDelegationController } from '../controllers/agent_delegation_controller';

const controller = new AgentDelegationController();
export const agentDelegationRouter = Router();

// Delegation is an owner-scoped action even on the loopback-only agent server.
// The MCP client already supplies its user session bearer token, so do not use
// the broader AGENT_LOCAL authentication bypass for this boundary.
agentDelegationRouter.use(requireAuth);

agentDelegationRouter.post('/delegate', controller.delegate.bind(controller));
agentDelegationRouter.post('/delegate-async', controller.delegateAsync.bind(controller));
