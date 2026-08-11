import { Router } from 'express';
import { GoalsController } from '../controllers/goals_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new GoalsController();
export const goalsRouter = Router();

goalsRouter.use(requireAuth);
goalsRouter.get('/', controller.list.bind(controller));
goalsRouter.post('/', controller.create.bind(controller));
goalsRouter.get('/:id', controller.get.bind(controller));
goalsRouter.patch('/:id', controller.update.bind(controller));
goalsRouter.delete('/:id', controller.remove.bind(controller));
