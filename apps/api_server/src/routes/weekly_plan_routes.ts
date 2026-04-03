import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { WeeklyPlanController } from '../controllers/weekly_plan_controller';

const controller = new WeeklyPlanController();
export const weeklyPlanRouter = Router();

weeklyPlanRouter.use(requireAuth);
weeklyPlanRouter.get('/', controller.getPlan.bind(controller));
weeklyPlanRouter.patch('/tasks/:id', controller.scheduleTask.bind(controller));
