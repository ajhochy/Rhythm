import { Router } from 'express';

import { MediaArtifactsController } from '../controllers/media_artifacts_controller';
import { env } from '../config/env';
import { authenticateIfPresent, requireAuth } from '../middleware/auth_middleware';

const controller = new MediaArtifactsController();
export const mediaArtifactsRouter = Router();
// Same loopback trust as /agent-sessions: the local desktop sends no token (a stale cloud token
// would fail closed), and transcripts that reference these artifacts are already served there.
mediaArtifactsRouter.use(env.agentLocal ? authenticateIfPresent : requireAuth);
mediaArtifactsRouter.get('/:id', controller.serve.bind(controller));
mediaArtifactsRouter.patch('/:id/pin', controller.pin.bind(controller));
