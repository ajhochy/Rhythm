import { Router } from 'express';
import { AutomationCatalogController } from '../controllers/automation_catalog_controller';
import { requireAuth } from '../middleware/require_auth';

const controller = new AutomationCatalogController();
export const automationCatalogRouter = Router();

automationCatalogRouter.use(requireAuth);
automationCatalogRouter.get('/triggers', controller.getTriggers.bind(controller));
automationCatalogRouter.get('/actions', controller.getActions.bind(controller));
automationCatalogRouter.get('/providers', controller.getProviders.bind(controller));
