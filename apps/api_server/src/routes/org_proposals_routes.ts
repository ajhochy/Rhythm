import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { OrgProposalsController } from '../controllers/org_proposals_controller';
import { OrgReviewerController } from '../controllers/org_reviewer_controller';

const router = Router();
const controller = new OrgProposalsController();
const reviewerController = new OrgReviewerController();

/**
 * Local agent-server auth posture — same as agent-webhooks/agent-cookbook:
 * the AGENT_LOCAL bypass is scoped to localhost-only traffic (the embedded
 * api_server process for the desktop app) and is never exposed externally.
 */
if (!env.agentLocal) router.use(requireAuth);

router.get('/', (req, res, next) => controller.list(req, res, next));
// Signed reviewer endpoints authenticate independently of the local operator
// bypass above. They accept only the engine-signed trustedCall envelope.
router.post('/reviewer/context', (req, res, next) => reviewerController.context(req, res, next));
router.post('/reviewer', (req, res, next) => reviewerController.submit(req, res, next));
router.post('/tool-install', (req, res, next) => controller.createToolInstall(req, res, next));
router.post('/:id/approve', (req, res, next) => controller.approve(req, res, next));
router.post('/:id/reject', (req, res, next) => controller.reject(req, res, next));
router.post('/:id/revert', (req, res, next) => controller.revert(req, res, next));
// W6 — declare a controlled experiment over this proposal (operator-supplied
// evidence bundle). The only production path that opens an experiment.
router.post('/:id/experiment', (req, res, next) => controller.declareExperiment(req, res, next));

export default router;
