import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentWebhookController } from '../controllers/agentWebhookController';

const router = Router();
const controller = new AgentWebhookController();

/**
 * Receive endpoint is intentionally unauthenticated —
 * security is provided by HMAC-SHA256 signature verification.
 * MUST come before the requireAuth middleware mount.
 */
router.post('/:id/receive', (req, res, next) => controller.receive(req, res, next));

if (!env.agentLocal) router.use(requireAuth);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.post('/', (req, res, next) => controller.create(req, res, next));
router.post('/:id/rotate-secret', (req, res, next) => controller.rotateSecret(req, res, next));
router.delete('/:id', (req, res, next) => controller.remove(req, res, next));

export default router;
