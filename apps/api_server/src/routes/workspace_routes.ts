import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { WorkspaceController } from '../controllers/workspace_controller';

const controller = new WorkspaceController();
export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);
workspaceRouter.post('/', controller.create.bind(controller));
workspaceRouter.post('/join', controller.join.bind(controller));
workspaceRouter.get('/me', controller.getMe.bind(controller));
workspaceRouter.get('/me/members', controller.listMembers.bind(controller));
workspaceRouter.patch('/me/members/:userId', controller.updateMemberRole.bind(controller));
workspaceRouter.delete('/me/members/:userId', controller.removeMember.bind(controller));
workspaceRouter.post('/me/join-code/regenerate', controller.regenerateJoinCode.bind(controller));
