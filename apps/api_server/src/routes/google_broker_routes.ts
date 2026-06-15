import { Router } from 'express';
import { GoogleBrokerController } from '../controllers/google_broker_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new GoogleBrokerController();
export const googleBrokerRouter = Router();

googleBrokerRouter.use(requireAuth);
googleBrokerRouter.get(
  '/calendar/events',
  controller.listEvents.bind(controller),
);
googleBrokerRouter.post(
  '/calendar/events',
  controller.createEvent.bind(controller),
);
googleBrokerRouter.patch(
  '/calendar/events/:id',
  controller.updateEvent.bind(controller),
);
googleBrokerRouter.delete(
  '/calendar/events/:id',
  controller.deleteEvent.bind(controller),
);
googleBrokerRouter.get('/gmail/search', controller.searchGmail.bind(controller));
googleBrokerRouter.get(
  '/gmail/messages/:id',
  controller.readEmail.bind(controller),
);
googleBrokerRouter.post('/gmail/send', controller.sendEmail.bind(controller));
