import { Router } from 'express';

import { HealthController } from '../controllers/health_controller';

const controller = new HealthController();
export const healthRouter = Router();

healthRouter.get('/', (req, res) => controller.getHealth(req, res));
