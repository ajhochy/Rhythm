import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { triggerSyncNow } from '../controllers/sync_controller';

export const syncRouter = Router();

// Auth: same AGENT_LOCAL bypass used by all agent-local endpoints.
if (!env.agentLocal) syncRouter.use(requireAuth);

// POST /sync/now — trigger an immediate sync cycle.
syncRouter.post('/now', triggerSyncNow);
