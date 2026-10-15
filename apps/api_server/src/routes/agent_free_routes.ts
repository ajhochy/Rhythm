import { Router, json, type NextFunction, type Request, type Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/app_error';
import { authenticateIfPresent, requireAuth } from '../middleware/auth_middleware';
import { loadRouterGridConfig } from '../services/decision/router_grid_config';
import { FreeOptInRepository, loadFreeExtractionOperatorConfig, runFreeExtractionRequest, runPublicFreeTaskRequest } from '../services/decision/router_free_extraction_api';

/** Free structured extraction. Owner identity comes only from the authenticated session. */
const router = Router();
router.use(env.agentLocal ? authenticateIfPresent : requireAuth);
router.use(json({ limit: '64kb' }));
function owner(req: Request): number {
  const id = req.auth?.user?.id;
  if (typeof id !== 'number') throw AppError.unauthorized();
  return id;
}
const handle = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

router.get('/extraction/opt-in', handle(async (req, res) => { res.json({ enabled: await new FreeOptInRepository().get(owner(req)) }); }));
router.put('/extraction/opt-in', handle(async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') throw AppError.badRequest('Body must be { enabled: boolean }');
  await new FreeOptInRepository().set(owner(req), body.enabled);
  res.json({ enabled: body.enabled });
}));
router.get('/extraction/sources', handle(async (req, res) => {
  owner(req);
  const operator = loadFreeExtractionOperatorConfig(loadRouterGridConfig());
  res.json({ sources: operator.kind === 'ok' ? operator.value.publicSources.map(s => ({ id: s.id, label: s.label })) : [] });
}));
router.post('/tasks', handle(async (req, res) => {
  const result = await runPublicFreeTaskRequest(owner(req), req.body);
  if (result.kind === 'invalid_request') throw AppError.badRequest(result.reason);
  res.json(result);
}));
router.post('/extractions', handle(async (req, res) => {
  const result = await runFreeExtractionRequest(owner(req), req.body);
  if (result.kind === 'invalid_request') throw AppError.badRequest(result.reason);
  res.json(result);
}));
export default router;
