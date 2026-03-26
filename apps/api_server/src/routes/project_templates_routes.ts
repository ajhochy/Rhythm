import { Router } from 'express';
import { ProjectTemplatesController } from '../controllers/project_templates_controller';

const controller = new ProjectTemplatesController();
export const projectTemplatesRouter = Router();

projectTemplatesRouter.get('/', controller.getAll.bind(controller));
projectTemplatesRouter.get('/:id', controller.getById.bind(controller));
projectTemplatesRouter.post('/', controller.create.bind(controller));
projectTemplatesRouter.patch('/:id', controller.update.bind(controller));
projectTemplatesRouter.delete('/:id', controller.remove.bind(controller));
projectTemplatesRouter.post('/:id/steps', controller.addStep.bind(controller));
