import { Router } from 'express';
import { RecurringRulesController } from '../controllers/recurring_rules_controller';
import { requireAuth } from '../middleware/auth_middleware';

const controller = new RecurringRulesController();
export const recurringRulesRouter = Router();

recurringRulesRouter.use(requireAuth);
recurringRulesRouter.get('/', controller.getAll.bind(controller));
recurringRulesRouter.get('/:id', controller.getById.bind(controller));
recurringRulesRouter.post('/', controller.create.bind(controller));
recurringRulesRouter.patch('/:id', controller.update.bind(controller));
recurringRulesRouter.delete('/:id', controller.remove.bind(controller));
recurringRulesRouter.get('/:id/collaborators', controller.getCollaborators.bind(controller));
recurringRulesRouter.post('/:id/collaborators', controller.addCollaborator.bind(controller));
recurringRulesRouter.delete('/:id/collaborators/:userId', controller.removeCollaborator.bind(controller));
