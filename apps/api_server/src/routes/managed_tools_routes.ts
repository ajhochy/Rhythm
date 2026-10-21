import { Router } from 'express';
import { requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { AppError } from '../errors/app_error';
import { verifyTrustedMcpCall } from '../security/trusted_mcp_call';
import { MANAGED_TOOLS_LIST, MANAGED_TOOLS_RUN, ManagedToolsService } from '../services/managed_tools_service';

export function createManagedToolsRouter(service = new ManagedToolsService()) {
  const router = Router();
  router.use(requireLocalOrCloudAuth);
  for (const [path, name] of [['/list', MANAGED_TOOLS_LIST], ['/run', MANAGED_TOOLS_RUN]] as const) {
    router.post(path, async (request, response, next) => {
      try {
        if (!request.auth || !request.body || Object.keys(request.body).length !== 1 || !Object.hasOwn(request.body, 'trustedCall'))
          throw AppError.forbidden('A current signed agent tool call is required');
        const call = await verifyTrustedMcpCall(request.body.trustedCall, name);
        response.json(name === MANAGED_TOOLS_LIST
          ? await service.listForCallAsync(call, request.auth.user.id)
          : await service.runForCallAsync(call, request.auth.user.id));
      } catch (error) { next(error); }
    });
  }
  return router;
}
