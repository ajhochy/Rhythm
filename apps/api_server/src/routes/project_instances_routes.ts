import { Router } from 'express';
import { ProjectGenerationController } from '../controllers/project_generation_controller';

const controller = new ProjectGenerationController();
export const projectInstancesRouter = Router();

projectInstancesRouter.get('/', controller.getAllInstances.bind(controller));
