import { Router } from 'express';
import { ProjectGenerationController } from '../controllers/project_generation_controller';

const controller = new ProjectGenerationController();
export const projectInstancesRouter = Router();

projectInstancesRouter.get('/', controller.getAllInstances.bind(controller));
projectInstancesRouter.patch('/steps/:stepId', controller.updateInstanceStep.bind(controller));
projectInstancesRouter.delete('/:id', controller.deleteInstance.bind(controller));
