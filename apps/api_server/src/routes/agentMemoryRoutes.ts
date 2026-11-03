import { Router, type RequestHandler } from 'express';
import { requireAuth, requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentMemoryController } from '../controllers/agentMemoryController';
import { AppError } from '../errors/app_error';
import type { ManagedMemorySearchService } from '../services/managed_workstream_evidence_capture';

export function createAgentMemoryRouter(
  options: { managedMemorySearch?: ManagedMemorySearchService } = {},
) {
  const router = Router();
  const controller = new AgentMemoryController(options.managedMemorySearch);
  // The signed desktop uses its Cloud bearer on the loopback agent API.
  // Keep authentication mandatory, then let the existing signed-call service
  // qualify the exact dispatch. Hosted routes retain their local session auth.
  const requireSearchAuth = env.agentLocal ? requireLocalOrCloudAuth : requireAuth;

  // Hide the fixture-only surface when absent, then require real bearer auth
  // even in AGENT_LOCAL mode before the injected service sees a request.
  router.post(
    '/search-managed',
    (_req, _res, next) => options.managedMemorySearch
      ? next()
      : next(AppError.notFound('Managed memory search')),
    requireSearchAuth,
    (req, res, next) => controller.searchManaged(req, res, next),
  );
  // This endpoint is safe to leave registered while the coordinator is off:
  // it reports ordinary routing without exposing any model/source content.
  // Once an enrollment exists, the injected selector refuses stale or unsafe
  // managed calls instead of allowing a legacy fallback.
  router.post(
    '/search-select',
    requireSearchAuth,
    (req, res, next) => controller.selectManagedOrOrdinary(req, res, next),
  );

  if (!env.agentLocal) router.use(requireAuth);
// Human verification is trust-elevating. In AGENT_LOCAL mode the router-wide
// auth middleware is intentionally skipped, so these two routes must parse and
// validate a bearer token explicitly. The MCP lifecycle route below remains
// local/auth-bypassed but can stamp only the fixed machine actor.
  const requireHumanLifecycleAuth: RequestHandler = env.agentLocal
    ? requireAuth
    : (_req, _res, next) => next();

  router.get('/', (req, res, next) => controller.list(req, res, next));
  router.get('/search', (req, res, next) => controller.search(req, res, next));
// Issue #770 WI6 — manual mirror-sync trigger (declared before '/:id' so the
// literal 'sync' segment is not captured as an id; POST anyway, so no clash).
  router.post('/sync', (req, res, next) => controller.sync(req, res, next));
  router.get('/:id', (req, res, next) => controller.get(req, res, next));
  router.post('/', (req, res, next) => controller.create(req, res, next));
  router.post(
    '/:id/verify',
    requireHumanLifecycleAuth,
    (req, res, next) => controller.verify(req, res, next),
  );
  router.post(
    '/:id/deprecate',
    requireHumanLifecycleAuth,
    (req, res, next) => controller.deprecate(req, res, next),
  );
  router.post('/:id/agent-lifecycle', (req, res, next) =>
    controller.agentLifecycle(req, res, next));
// Issue #862 — edit-in-place.
  router.patch('/:id', (req, res, next) => controller.update(req, res, next));
  router.delete('/:id', (req, res, next) => controller.remove(req, res, next));

  return router;
}

export default createAgentMemoryRouter();
