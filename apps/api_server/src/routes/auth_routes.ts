import { Router } from 'express';

import { AuthController } from '../controllers/auth_controller';

const controller = new AuthController();
export const authRouter = Router();

authRouter.get('/begin', (req, res) => controller.beginOAuth(req, res));
