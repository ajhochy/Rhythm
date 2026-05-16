import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { ProjectsController } from '../controllers/projects_controller';

const controller = new ProjectsController();
export const projectsRouter = Router();

if (!env.agentLocal) projectsRouter.use(requireAuth);

projectsRouter.get('/', controller.list.bind(controller));
projectsRouter.get('/:id', controller.getOne.bind(controller));
projectsRouter.post('/', controller.create.bind(controller));
projectsRouter.patch('/:id', controller.update.bind(controller));
projectsRouter.delete('/:id', controller.remove.bind(controller));
projectsRouter.post('/:id/refresh-vcs', controller.refreshVcs.bind(controller));
