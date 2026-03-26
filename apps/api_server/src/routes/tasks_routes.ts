import { Router } from 'express';
import { TasksController } from '../controllers/tasks_controller';

const controller = new TasksController();
export const tasksRouter = Router();

tasksRouter.get('/', controller.getAll.bind(controller));
tasksRouter.get('/:id', controller.getById.bind(controller));
tasksRouter.post('/', controller.create.bind(controller));
tasksRouter.patch('/:id', controller.update.bind(controller));
tasksRouter.delete('/:id', controller.remove.bind(controller));
