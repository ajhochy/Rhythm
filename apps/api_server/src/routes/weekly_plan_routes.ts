import { Router } from 'express';
import { getPlan, scheduleTask } from '../controllers/weekly_plan_controller';

export const weeklyPlanRouter = Router();

weeklyPlanRouter.get('/', getPlan);
weeklyPlanRouter.patch('/tasks/:id', scheduleTask);
