import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { ProjectGenerationController } from '../controllers/project_generation_controller';

const controller = new ProjectGenerationController();
export const projectInstancesRouter = Router();

projectInstancesRouter.use(requireAuth);

projectInstancesRouter.get('/', controller.getAllInstances.bind(controller));
projectInstancesRouter.patch('/steps/:stepId', controller.updateInstanceStep.bind(controller));
projectInstancesRouter.delete('/:id', controller.deleteInstance.bind(controller));
