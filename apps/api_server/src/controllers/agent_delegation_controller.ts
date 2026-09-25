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
import {
  BridgeDelegationError,
  DelegationCoordinator,
} from '../shared_agents/delegation_coordinator';
import { BridgeJobError } from '../shared_agents/delegation_jobs_repository';
import { BRIDGE_LIMITS } from '../shared_agents/bridge/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bridgeAppError(error: unknown): never {
  if (error instanceof BridgeDelegationError) {
    throw new AppError(error.statusCode, error.code, error.code);
  }
  if (error instanceof BridgeJobError) {
    throw new AppError(error.statusCode, error.code, error.code);
  }
  throw error;
}

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
  private bridge(): DelegationCoordinator {
    return new DelegationCoordinator();
  }

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
      const targetRuntime = body.targetRuntime === undefined
        ? 'opencode'
        : body.targetRuntime;
      if (targetRuntime !== 'opencode' && targetRuntime !== 'hermes') {
        throw AppError.badRequest('targetRuntime must be opencode or hermes');
      }
      if (targetRuntime === 'hermes') {
        if (!env.bridgeEnabled) {
          throw new AppError(400, 'hermes_runtime_not_available_here', 'hermes_runtime_not_available_here');
        }
        if (body.callerSessionId !== undefined) {
          throw new AppError(400, 'caller_session_id_not_accepted', 'caller_session_id_not_accepted');
        }
        if (body.isolateWorktree !== undefined || body.worktreeName !== undefined || body.model !== undefined) {
          throw new AppError(400, 'option_not_supported_for_hermes', 'option_not_supported_for_hermes');
        }
        if (typeof body.prompt !== 'string' || !body.prompt.trim() ||
            body.prompt.length > BRIDGE_LIMITS.promptCharacters) {
          throw AppError.badRequest(`prompt must be 1..${BRIDGE_LIMITS.promptCharacters} characters`);
        }
        if (body.context !== undefined && body.context !== null &&
            (typeof body.context !== 'string' || body.context.length > BRIDGE_LIMITS.contextCharacters)) {
          throw AppError.badRequest(`context must be at most ${BRIDGE_LIMITS.contextCharacters} characters`);
        }
        const callerSdkSessionId = typeof body.callerSdkSessionId === 'string'
          ? body.callerSdkSessionId.trim()
          : '';
        const caller = callerSdkSessionId
          ? new AgentSessionsRepository().findBySdkSessionId(callerSdkSessionId)
          : null;
        if (!caller) {
          throw new AppError(400, 'caller_session_unresolved', 'caller_session_unresolved');
        }
        const authenticatedUserId = req.auth?.user.id ?? ownerOfSessionUnderAgentLocal(caller.id);
        if (!authenticatedUserId || caller.ownerUserId !== authenticatedUserId) {
          throw AppError.unauthorized('Authenticated user is required for delegation');
        }
        const idempotencyKey = typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : '';
        if (!UUID.test(idempotencyKey)) throw AppError.badRequest('idempotencyKey must be a uuid');
        try {
          const job = await this.bridge().dispatchToHermes({
            localUserId: authenticatedUserId,
            parent: caller,
            targetAgentId: typeof body.targetAgentConfigId === 'string' ? body.targetAgentConfigId : '',
            prompt: typeof body.prompt === 'string' ? body.prompt : '',
            context: typeof body.context === 'string' ? body.context : null,
            idempotencyKey,
          });
          res.status(202).json({
            jobId: job.jobId,
            status: 'queued',
            targetAgentConfigId: job.targetAgentId,
            targetRuntime: 'hermes',
            message: `Dispatched to ${job.targetAgentId}; you'll be notified when it's done.`,
          });
          return;
        } catch (error) { bridgeAppError(error); }
      }
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
      if (
        body.worktreeName !== undefined &&
        body.worktreeName !== null &&
        typeof body.worktreeName !== 'string'
      ) {
        throw AppError.badRequest('worktreeName must be a string');
      }
      if (
        body.isolateWorktree !== undefined &&
        typeof body.isolateWorktree !== 'boolean'
      ) {
        throw AppError.badRequest('isolateWorktree must be a boolean');
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
        isolateWorktree: body.isolateWorktree === true,
        worktreeName: typeof body.worktreeName === 'string' ? body.worktreeName : undefined,
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
      const callerWasResolvedFromSdk = typeof req.query.callerSdkSessionId === 'string' &&
        new AgentSessionsRepository().findBySdkSessionId(req.query.callerSdkSessionId)?.id === callerSessionId;
      res.json({
        delegations: getDelegationStatus(callerSessionId),
        ...(env.bridgeEnabled && callerWasResolvedFromSdk
          ? { crossRuntime: this.bridge().statusForOpenCode(authenticatedUserId, callerSessionId) }
          : {}),
      });
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
      try {
        res.json(await cancelDelegation(callerSessionId, req.params.id));
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404 && env.bridgeEnabled) {
          try {
            res.json(this.bridge().cancelForOpenCode(authenticatedUserId, callerSessionId, req.params.id));
            return;
          } catch (bridgeError) { bridgeAppError(bridgeError); }
        }
        throw error;
      }
    } catch (err) {
      next(err);
    }
  }
}
