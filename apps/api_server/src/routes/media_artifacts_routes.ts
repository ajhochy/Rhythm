import { Router } from 'express';

import { MediaArtifactsController } from '../controllers/media_artifacts_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new MediaArtifactsController();
export const mediaArtifactsRouter = Router();
mediaArtifactsRouter.use(requireAuth);
mediaArtifactsRouter.get('/:id', controller.serve.bind(controller));
mediaArtifactsRouter.patch('/:id/pin', controller.pin.bind(controller));
