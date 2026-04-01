import { Router } from 'express';
import { MessagesController } from '../controllers/messages_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new MessagesController();
export const messagesRouter = Router();

messagesRouter.use(requireAuth);
messagesRouter.get('/', controller.getAllThreads.bind(controller));
messagesRouter.post('/', controller.createThread.bind(controller));
messagesRouter.get('/:id/messages', controller.getMessages.bind(controller));
messagesRouter.post('/:id/messages', controller.createMessage.bind(controller));
messagesRouter.post('/:id/read', controller.markRead.bind(controller));
