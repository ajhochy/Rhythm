import { Router } from 'express';
import { NotificationsController } from '../controllers/notifications_controller';
import { requireAuth } from '../middleware/auth_middleware';

export const notificationsRouter = Router();
const controller = new NotificationsController();

notificationsRouter.use(requireAuth);

// /read-all must be registered before /:id/read to avoid Express treating "read-all" as an id
notificationsRouter.get('/', controller.getAll.bind(controller));
notificationsRouter.post('/read-all', controller.markAllRead.bind(controller));
notificationsRouter.post('/:id/read', controller.markRead.bind(controller));
