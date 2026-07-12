import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/app_error';
import { TasksController } from '../controllers/tasks_controller';

export const devRouter = Router();

// devRouter.use((_req: Request, _res: Response, next: NextFunction) => {
//   if (!env.agentLocal) {
//     return next(new AppError('Forbidden', 403));
//   }
//   next();
// });

const controller = new TasksController();

// devRouter.get('/tasks/:id', controller.getByIdUnsafe.bind(controller));
