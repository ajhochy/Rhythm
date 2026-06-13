import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentSessionsController } from '../controllers/agent_sessions_controller';
import { env } from '../config/env';

const controller = new AgentSessionsController();
export const agentSessionsRouter = Router();

if (!env.agentLocal) agentSessionsRouter.use(requireAuth);

/**
 * OPC-M4-4 — GET /agent-sessions/agents
 *
 * Route choice: registered on the agent_sessions router (not a separate file)
 * to keep all agent-session affordances under one router. This is a static
 * path and must be declared BEFORE the `/:id` wildcard so Express routes
 * `/agent-sessions/agents` here rather than treating "agents" as a session id.
 */
agentSessionsRouter.get('/agents', controller.listAgents.bind(controller));

agentSessionsRouter.get('/', controller.list.bind(controller));
agentSessionsRouter.get('/:id', controller.getOne.bind(controller));
agentSessionsRouter.post('/', controller.create.bind(controller));
agentSessionsRouter.patch('/:id', controller.update.bind(controller));
agentSessionsRouter.post('/:id/cancel', controller.cancel.bind(controller));
agentSessionsRouter.get('/:id/diff', controller.getDiff.bind(controller));
agentSessionsRouter.post(
  '/:id/permission/:permissionId/:decision',
  controller.respondPermission.bind(controller),
);
agentSessionsRouter.delete('/:id', controller.remove.bind(controller));
agentSessionsRouter.delete('/:id/hard', controller.destroy.bind(controller));
agentSessionsRouter.get('/:id/messages', controller.listMessages.bind(controller));
agentSessionsRouter.post('/:id/resume', controller.resume.bind(controller));
agentSessionsRouter.post('/:id/revert', controller.revert.bind(controller));
agentSessionsRouter.post('/:id/unrevert', controller.unrevert.bind(controller));
agentSessionsRouter.post('/:id/summarize', controller.summarize.bind(controller));
agentSessionsRouter.get('/:id/todo', controller.getTodo.bind(controller));
agentSessionsRouter.get('/:id/children', controller.getChildren.bind(controller));
agentSessionsRouter.get('/:id/children/:childSdkId/messages', controller.getChildMessages.bind(controller));
agentSessionsRouter.post('/:id/fork', controller.fork.bind(controller));
// OPC-M1-6 / issue #709 — one-shot shell command runner.
agentSessionsRouter.post('/:id/shell', controller.shell.bind(controller));
