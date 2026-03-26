import { Router } from 'express';
import { IntegrationsController } from '../controllers/integrations_controller';

const controller = new IntegrationsController();
export const integrationsRouter = Router();

integrationsRouter.get('/accounts', controller.getAccounts.bind(controller));
integrationsRouter.post(
  '/google-calendar/sync',
  controller.syncGoogleCalendar.bind(controller),
);
integrationsRouter.post('/gmail/sync', controller.syncGmail.bind(controller));
integrationsRouter.get('/gmail/signals', controller.getGmailSignals.bind(controller));
integrationsRouter.post(
  '/planning-center/sync',
  controller.syncPlanningCenter.bind(controller),
);
integrationsRouter.get(
  '/planning-center/task-preferences',
  controller.getPlanningCenterTaskPreferences.bind(controller),
);
integrationsRouter.put(
  '/planning-center/task-preferences',
  controller.savePlanningCenterTaskPreferences.bind(controller),
);
integrationsRouter.get(
  '/planning-center/task-options',
  controller.getPlanningCenterTaskOptions.bind(controller),
);
