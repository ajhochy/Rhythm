import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { ProjectGenerationController } from '../controllers/project_generation_controller';
import { ProjectTemplatesController } from '../controllers/project_templates_controller';

const controller = new ProjectTemplatesController();
const genController = new ProjectGenerationController();
export const projectTemplatesRouter = Router();

projectTemplatesRouter.use(requireAuth);

projectTemplatesRouter.get('/', controller.getAll.bind(controller));
projectTemplatesRouter.get('/:id', controller.getById.bind(controller));
projectTemplatesRouter.post('/', controller.create.bind(controller));
projectTemplatesRouter.patch('/:id', controller.update.bind(controller));
projectTemplatesRouter.delete('/:id', controller.remove.bind(controller));
projectTemplatesRouter.post('/:id/steps', controller.addStep.bind(controller));
projectTemplatesRouter.patch('/:id/steps/:stepId', controller.updateStep.bind(controller));
projectTemplatesRouter.delete('/:id/steps/:stepId', controller.removeStep.bind(controller));
projectTemplatesRouter.post('/:id/generate', genController.generate.bind(genController));
