import { Router } from 'express';

import { AuthController } from '../controllers/auth_controller';

const controller = new AuthController();
export const authRouter = Router();

authRouter.get('/google/begin', controller.beginGoogleOAuth.bind(controller));
authRouter.get('/google/callback', controller.googleCallback.bind(controller));
authRouter.get(
  '/planning-center/begin',
  controller.beginPlanningCenterOAuth.bind(controller),
);
authRouter.get(
  '/planning-center/callback',
  controller.planningCenterCallback.bind(controller),
);
