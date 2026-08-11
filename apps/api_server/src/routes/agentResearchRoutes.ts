import { Router } from 'express';
import { authenticateIfPresent, requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentResearchController } from '../controllers/agentResearchController';

const router = Router();
const controller = new AgentResearchController();

router.use(env.agentLocal ? authenticateIfPresent : requireAuth);

router.get('/projects', (req, res, next) => controller.listProjects(req, res, next));
router.post('/projects', (req, res, next) => controller.createProject(req, res, next));
router.get('/projects/:projectId', (req, res, next) => controller.getProject(req, res, next));
router.patch('/projects/:projectId', (req, res, next) => controller.updateProject(req, res, next));
router.post('/projects/:projectId/archive', (req, res, next) => controller.archiveProject(req, res, next));
router.get('/projects/:projectId/runs', (req, res, next) => controller.listProjectRuns(req, res, next));
router.post('/projects/:projectId/runs', (req, res, next) => controller.createProjectRun(req, res, next));
router.get('/projects/:projectId/runs/:runId/magazine', (req, res, next) => controller.getProjectMagazine(req, res, next));
router.get('/projects/:projectId/runs/:runId/export', (req, res, next) => controller.exportProjectMagazine(req, res, next));
router.post('/projects/:projectId/runs/:runId/discussions', (req, res, next) => controller.createProjectDiscussion(req, res, next));
router.get('/projects/:projectId/runs/:runId', (req, res, next) => controller.getProjectRun(req, res, next));
router.post('/projects/:projectId/runs/:runId/cancel', (req, res, next) => controller.cancelProjectRun(req, res, next));
router.post('/projects/:projectId/runs/:runId/resume', (req, res, next) => controller.resumeProjectRun(req, res, next));
router.post('/projects/:projectId/runs/:runId/passes/:passId/cancel', (req, res, next) => controller.cancelProjectPass(req, res, next));
router.post('/projects/:projectId/runs/:runId/passes/:passId/retry', (req, res, next) => controller.retryProjectPass(req, res, next));
router.get('/projects/:projectId/artifacts/:artifactId', (req, res, next) => controller.getProjectArtifact(req, res, next));

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.post('/', (req, res, next) => controller.create(req, res, next));
router.post('/:id/retry', (req, res, next) => controller.retry(req, res, next));
router.delete('/:id', (req, res, next) => controller.remove(req, res, next));
router.patch('/:id/status', (req, res, next) => controller.updateStatus(req, res, next));

export default router;
