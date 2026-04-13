import { Router } from 'express';
import { TasksController } from '../controllers/tasks_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new TasksController();
export const tasksRouter = Router();

tasksRouter.use(requireAuth);
tasksRouter.get('/', controller.getAll.bind(controller));
tasksRouter.get('/:id', controller.getById.bind(controller));
tasksRouter.post('/', controller.create.bind(controller));
tasksRouter.patch('/:id', controller.update.bind(controller));
tasksRouter.delete('/:id', controller.remove.bind(controller));
tasksRouter.get('/:id/collaborators', controller.getCollaborators.bind(controller));
tasksRouter.post('/:id/collaborators', controller.addCollaborator.bind(controller));
tasksRouter.delete('/:id/collaborators/:userId', controller.removeCollaborator.bind(controller));
