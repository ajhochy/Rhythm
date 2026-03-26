import { Router } from 'express';
import { RecurringRulesController } from '../controllers/recurring_rules_controller';

const controller = new RecurringRulesController();
export const recurringRulesRouter = Router();

recurringRulesRouter.get('/', controller.getAll.bind(controller));
recurringRulesRouter.get('/:id', controller.getById.bind(controller));
recurringRulesRouter.post('/', controller.create.bind(controller));
recurringRulesRouter.patch('/:id', controller.update.bind(controller));
recurringRulesRouter.delete('/:id', controller.remove.bind(controller));
