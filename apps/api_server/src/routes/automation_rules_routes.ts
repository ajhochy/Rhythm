import { Router } from 'express';
import { AutomationRulesController } from '../controllers/automation_rules_controller';

const controller = new AutomationRulesController();
export const automationRulesRouter = Router();

automationRulesRouter.get('/', controller.getAll.bind(controller));
automationRulesRouter.get('/:id', controller.getById.bind(controller));
automationRulesRouter.post('/', controller.create.bind(controller));
automationRulesRouter.patch('/:id', controller.update.bind(controller));
automationRulesRouter.delete('/:id', controller.remove.bind(controller));
