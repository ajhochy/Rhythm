import { Router } from 'express';
import { SharedTranscriptsController } from '../controllers/shared_transcripts_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new SharedTranscriptsController();
export const sharedTranscriptsRouter = Router();
export const transcriptShareCreationRouter = Router();

sharedTranscriptsRouter.use(requireAuth);
sharedTranscriptsRouter.get('/', controller.list.bind(controller));
sharedTranscriptsRouter.get('/:id', controller.getOne.bind(controller));
sharedTranscriptsRouter.delete('/:id', controller.revoke.bind(controller));

transcriptShareCreationRouter.post(
  '/agent-sessions/:id/shares',
  requireAuth,
  controller.create.bind(controller),
);
