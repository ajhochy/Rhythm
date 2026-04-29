import { Router } from 'express';
import { DashboardController } from '../controllers/dashboard_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new DashboardController();
export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get('/summary', controller.getSummary.bind(controller));
