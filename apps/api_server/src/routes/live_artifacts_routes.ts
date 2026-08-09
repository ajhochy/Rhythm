import { Router } from 'express';
import { LiveArtifactsController } from '../controllers/live_artifacts_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new LiveArtifactsController();
export const liveArtifactsRouter = Router();
liveArtifactsRouter.use(requireAuth);
liveArtifactsRouter.get('/', controller.list.bind(controller));
liveArtifactsRouter.post('/', controller.create.bind(controller));
liveArtifactsRouter.get('/:id/render', controller.render.bind(controller));
liveArtifactsRouter.get('/:id/collaborators', controller.getCollaborators.bind(controller));
liveArtifactsRouter.post('/:id/collaborators', controller.addCollaborator.bind(controller));
liveArtifactsRouter.delete('/:id/collaborators/:userId', controller.deleteCollaborator.bind(controller));
liveArtifactsRouter.put('/:id/bundle', controller.updateBundle.bind(controller));
liveArtifactsRouter.put('/:id/state', controller.updateState.bind(controller));
liveArtifactsRouter.patch('/:id', controller.patch.bind(controller));
liveArtifactsRouter.delete('/:id', controller.remove.bind(controller));
liveArtifactsRouter.get('/:id', controller.get.bind(controller));
