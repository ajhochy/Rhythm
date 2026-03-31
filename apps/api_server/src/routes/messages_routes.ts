import { Router } from 'express';
import { MessagesController } from '../controllers/messages_controller';

const controller = new MessagesController();
export const messagesRouter = Router();

messagesRouter.get('/', controller.getAllThreads.bind(controller));
messagesRouter.post('/', controller.createThread.bind(controller));
messagesRouter.get('/:id/messages', controller.getMessages.bind(controller));
messagesRouter.post('/:id/messages', controller.createMessage.bind(controller));
