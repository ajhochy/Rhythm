import { Router } from 'express';
import { UsersController } from '../controllers/users_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new UsersController();
export const usersRouter = Router();

usersRouter.use(requireAuth);
usersRouter.get('/', controller.getAll.bind(controller));
usersRouter.get('/:id', controller.getById.bind(controller));
usersRouter.post('/', controller.create.bind(controller));
usersRouter.patch('/:id', controller.update.bind(controller));
