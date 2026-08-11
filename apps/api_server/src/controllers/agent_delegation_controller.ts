import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import {
  delegateToAgent,
  delegateToAgentAsync,
} from '../services/agent_delegation_service';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  cancelDelegation,
  getDelegationStatus,
} from '../services/async_delegation_status_service';
import { env } from '../config/env';

/**
 * The caller's Rhythm session id.
 *
 * Prefers `callerSdkSessionId` — the ENGINE session id, which the MCP layer reads
 * out of its trusted security context rather than from the model — and falls back
 * to an explicitly supplied `callerSessionId` for programmatic callers (the
 * scheduler and AgentFlow both pass it directly and never go through a model).
 */
export function resolveCallerSessionId(body: Record<string, unknown>): string {
  const sdkSessionId =
    typeof body.callerSdkSessionId === 'string' ? body.callerSdkSessionId.trim() : '';
  if (sdkSessionId) {
    const row = new AgentSessionsRepository().findBySdkSessionId(sdkSessionId);
    if (row) return row.id;
  }
  return typeof body.callerSessionId === 'string' ? body.callerSessionId : '';
}

/**
 * Owner of `sessionId`, but only when AGENT_LOCAL is set.
 *
 * This is the bearer-less identity path for the loopback agent server — see the
 * rationale on the router. Returns undefined off-loopback so a hosted deployment
 * keeps hard bearer enforcement.
 */
export function ownerOfSessionUnderAgentLocal(sessionId: string): number | undefined {
  if (!env.agentLocal || !sessionId) return undefined;
  const owner = new AgentSessionsRepository().findById(sessionId)?.ownerUserId;
  return typeof owner === 'number' ? owner : undefined;
}

export class AgentDelegationController {
  async delegate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const callerSessionId = resolveCallerSessionId(body);
      const authenticatedUserId =
        req.auth?.user.id ?? ownerOfSessionUnderAgentLocal(callerSessionId);
      if (!authenticatedUserId) {
        throw AppError.unauthorized('Authenticated user is required for delegation');
      }
      const result = await delegateToAgent({
        authenticatedUserId,
        callerAgentConfigId:
          typeof body.callerAgentConfigId === 'string' ? body.callerAgentConfigId : null,
        targetAgentConfigId:
          typeof body.targetAgentConfigId === 'string' ? body.targetAgentConfigId : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        callerSessionId,
        context: typeof body.context === 'string' ? body.context : null,
        model: body.model,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async delegateAsync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      // #1322 follow-up — the caller session is resolved from the ENGINE session id
      // the MCP layer takes out of its trusted security context, not from whatever
      // the model typed. A model has no way to learn its own Rhythm session id, and
      // when asked for one it invents a plausible UUID: observed 2026-08-05, an
      // agent passed a UUID scraped out of its own cwd path.
      const callerSessionId = resolveCallerSessionId(body);
      const authenticatedUserId =
        req.auth?.user.id ?? ownerOfSessionUnderAgentLocal(callerSessionId);
      if (!authenticatedUserId) {
        throw AppError.unauthorized('Authenticated user is required for delegation');
      }
      const result = await delegateToAgentAsync({
        authenticatedUserId,
        callerAgentConfigId:
          typeof body.callerAgentConfigId === 'string' ? body.callerAgentConfigId : null,
        targetAgentConfigId:
          typeof body.targetAgentConfigId === 'string' ? body.targetAgentConfigId : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        callerSessionId,
        context: typeof body.context === 'string' ? body.context : null,
        model: body.model,
      });
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /agent-delegation/status — state, elapsed time and the latest progress
   * event for every delegation this caller dispatched. No child transcript.
   */
  async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const callerSessionId = resolveCallerSessionId(
        req.query as Record<string, unknown>,
      );
      if (!callerSessionId) {
        throw AppError.badRequest('caller session could not be resolved');
      }
      const authenticatedUserId =
        req.auth?.user.id ?? ownerOfSessionUnderAgentLocal(callerSessionId);
      if (!authenticatedUserId) {
        throw AppError.unauthorized('Authenticated user is required');
      }
      res.json({ delegations: getDelegationStatus(callerSessionId) });
    } catch (err) {
      next(err);
    }
  }

  /** POST /agent-delegation/:id/cancel — abort the child and mark it cancelled. */
  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const callerSessionId = resolveCallerSessionId(body);
      if (!callerSessionId) {
        throw AppError.badRequest('caller session could not be resolved');
      }
      const authenticatedUserId =
        req.auth?.user.id ?? ownerOfSessionUnderAgentLocal(callerSessionId);
      if (!authenticatedUserId) {
        throw AppError.unauthorized('Authenticated user is required');
      }
      res.json(await cancelDelegation(callerSessionId, req.params.id));
    } catch (err) {
      next(err);
    }
  }
}
