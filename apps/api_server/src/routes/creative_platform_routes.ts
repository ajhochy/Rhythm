import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/app_error';
import { requireAuth } from '../middleware/auth_middleware';
import { AgentApprovalsRepository } from '../repositories/agent_approvals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { installCreativeDependency } from '../services/creative_installer';
import {
  listCreativeCapabilities,
  type CreativeCapabilityId,
} from '../services/creative_capabilities';
import { verifyTrustedMcpCall } from '../security/trusted_mcp_call';

export const creativePlatformRouter = Router();
const approvals = new AgentApprovalsRepository();
const sessions = new AgentSessionsRepository();
const installs = new Map<CreativeCapabilityId, AbortController>();
const ids = new Set<CreativeCapabilityId>([
  'blender',
  'comfyui',
  'comfyui-model-pack',
  'openmontage',
  'obsidian',
  'document-tools',
  'media-tools',
]);

if (!env.agentLocal) creativePlatformRouter.use(requireAuth);

function id(value: unknown): CreativeCapabilityId {
  if (typeof value !== 'string' || !ids.has(value as CreativeCapabilityId))
    throw AppError.badRequest('unknown creative capability');
  return value as CreativeCapabilityId;
}

async function capability(capabilityId: CreativeCapabilityId) {
  return (await listCreativeCapabilities()).find(({ id }) => id === capabilityId)!;
}

creativePlatformRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listCreativeCapabilities());
  } catch (error) {
    next(error);
  }
});

creativePlatformRouter.get('/:id/status', async (req, res, next) => {
  try {
    res.json(await capability(id(req.params.id)));
  } catch (error) {
    next(error);
  }
});

creativePlatformRouter.post(
  '/:id/request-or-start',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      let trustedCall;
      try {
        trustedCall = await verifyTrustedMcpCall(
          req.body?.trustedCall,
          'rhythm_install_creative_capability',
        );
      } catch {
        throw AppError.forbidden('trusted Rhythm MCP caller is required');
      }
      const capabilityId = id(req.params.id);
      if (trustedCall.arguments.id !== capabilityId) {
        throw AppError.forbidden('trusted Rhythm MCP call does not match the requested capability');
      }
      const session = sessions.findBySdkSessionId(
        trustedCall.context.sdkSessionId,
      );
      if (!session) throw AppError.forbidden('trusted SDK session is unknown');
      const sessionId = session.id;
      const agentConfigId = session.agentKind;
      const action = `install_creative_dependency:${capabilityId}`;
      const approved = approvals
        .list('approved')
        .find((approval) => approval.action === action && approval.sessionId === sessionId);
      if (!approved) {
        const approval = approvals.create({
          sessionId,
          agentConfigId,
          action,
          preview: `Install ${capabilityId} using Rhythm's pinned local recipe.`,
        });
        return res.status(202).json({ status: approval.status, approval });
      }
      if (installs.has(capabilityId))
        return res.status(202).json({ status: 'installing', id: capabilityId });
      const controller = new AbortController();
      installs.set(capabilityId, controller);
      try {
        const result = await installCreativeDependency(
          {
            id: capabilityId,
            sessionId,
            modelLicenseAccepted:
              trustedCall.arguments.modelLicenseAccepted === true,
            signal: controller.signal,
          },
          { approvals },
        );
        return res.json(result);
      } finally {
        installs.delete(capabilityId);
      }
    } catch (error) {
      next(error);
    }
  },
);

creativePlatformRouter.post('/:id/cancel', (req, res, next) => {
  try {
    const capabilityId = id(req.params.id);
    const install = installs.get(capabilityId);
    if (install) install.abort();
    res.json({ id: capabilityId, cancelled: Boolean(install) });
  } catch (error) {
    next(error);
  }
});

creativePlatformRouter.post('/:id/verify', async (req, res, next) => {
  try {
    res.json(await capability(id(req.params.id)));
  } catch (error) {
    next(error);
  }
});
