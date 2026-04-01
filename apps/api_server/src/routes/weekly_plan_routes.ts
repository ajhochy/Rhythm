import { Router } from 'express';
import { getPlan, scheduleTask } from '../controllers/weekly_plan_controller';
import { requireAuth } from '../middleware/auth_middleware';

export const weeklyPlanRouter = Router();

weeklyPlanRouter.use(requireAuth);
weeklyPlanRouter.get('/', getPlan);
weeklyPlanRouter.patch('/tasks/:id', scheduleTask);
