import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { ProjectGenerationController } from '../controllers/project_generation_controller';

const controller = new ProjectGenerationController();
export const projectInstancesRouter = Router();

projectInstancesRouter.use(requireAuth);

projectInstancesRouter.get('/', controller.getAllInstances.bind(controller));
projectInstancesRouter.post('/', controller.createInstance.bind(controller));
projectInstancesRouter.patch('/:id', controller.updateInstance.bind(controller));
projectInstancesRouter.patch('/steps/:stepId', controller.updateInstanceStep.bind(controller));
projectInstancesRouter.get('/:id/milestones', controller.getMilestones.bind(controller));
projectInstancesRouter.post('/:id/milestones', controller.createMilestone.bind(controller));
projectInstancesRouter.patch('/:id/milestones/:milestoneId', controller.updateMilestone.bind(controller));
projectInstancesRouter.delete('/:id/milestones/:milestoneId', controller.deleteMilestone.bind(controller));
projectInstancesRouter.delete('/:id', controller.deleteInstance.bind(controller));
projectInstancesRouter.get('/:id/collaborators', controller.getCollaborators.bind(controller));
projectInstancesRouter.post('/:id/collaborators', controller.addCollaborator.bind(controller));
projectInstancesRouter.delete('/:id/collaborators/:userId', controller.removeCollaborator.bind(controller));
