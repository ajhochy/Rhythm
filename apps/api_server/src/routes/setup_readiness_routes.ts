import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth_middleware';
import { getSetupReadiness } from '../services/setup_readiness_service';

export const setupReadinessRouter = Router();

if (!env.agentLocal) setupReadinessRouter.use(requireAuth);

setupReadinessRouter.get('/', (_req, res) => res.json(getSetupReadiness()));
