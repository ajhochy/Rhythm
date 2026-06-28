import { Router } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentMemoryController } from '../controllers/agentMemoryController';

const router = Router();
const controller = new AgentMemoryController();

if (!env.agentLocal) router.use(requireAuth);

router.get('/', (req, res, next) => controller.list(req, res, next));
router.get('/search', (req, res, next) => controller.search(req, res, next));
// Issue #770 WI6 — manual mirror-sync trigger (declared before '/:id' so the
// literal 'sync' segment is not captured as an id; POST anyway, so no clash).
router.post('/sync', (req, res, next) => controller.sync(req, res, next));
router.get('/:id', (req, res, next) => controller.get(req, res, next));
router.post('/', (req, res, next) => controller.create(req, res, next));
router.delete('/:id', (req, res, next) => controller.remove(req, res, next));

export default router;
