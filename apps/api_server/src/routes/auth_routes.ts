import { Router } from 'express';

import { AuthController } from '../controllers/auth_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new AuthController();
export const authRouter = Router();

authRouter.post('/google/login', controller.googleLogin.bind(controller));
authRouter.post(
  '/google/desktop-exchange',
  controller.googleDesktopExchange.bind(controller),
);
authRouter.get('/me', requireAuth, controller.me.bind(controller));
authRouter.post('/logout', requireAuth, controller.logout.bind(controller));
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
