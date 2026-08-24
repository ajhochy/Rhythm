import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { OrgProposalsController } from '../controllers/org_proposals_controller';

const router = Router();
const controller = new OrgProposalsController();

/**
 * Local agent-server auth posture — same as agent-webhooks/agent-cookbook:
 * the AGENT_LOCAL bypass is scoped to localhost-only traffic (the embedded
 * api_server process for the desktop app) and is never exposed externally.
 */
if (!env.agentLocal) router.use(requireAuth);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.post('/:id/approve', (req, res, next) => controller.approve(req, res, next));
router.post('/:id/reject', (req, res, next) => controller.reject(req, res, next));
router.post('/:id/revert', (req, res, next) => controller.revert(req, res, next));
// W6 — declare a controlled experiment over this proposal (operator-supplied
// evidence bundle). The only production path that opens an experiment.
router.post('/:id/experiment', (req, res, next) => controller.declareExperiment(req, res, next));

export default router;
