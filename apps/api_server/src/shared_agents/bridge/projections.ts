import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import type {
  BridgeErrorResponse,
  ProjectionCheckRequest,
  ProjectionCheckResponse,
  ProjectionIssueRequest,
  ProjectionIssueResponse,
} from '../bridge_schema';
import {
  issueProjection,
  ProjectionError,
} from '../projection_service';
import { secureDigestMatch } from '../bridge_grants';
import { AgentBridgeJobsRepository } from '../delegation_jobs_repository';
import { asyncDelegationCompletionService } from '../../services/async_delegation_completion_service';
import {
  active,
  BRIDGE_RATE_LIMITS,
  bridgeGrant,
  grantRateLimit,
  hasOnlyKeys,
  isJsonObject,
  runtime,
  sendBridgeError,
  type BridgeDeps,
} from './common';

const ISSUE_KEYS = new Set([
  'sessionKey', 'cwd', 'launchKind', 'acceptVersions', 'agentId',
  'expectedRevision', 'jobId', 'leaseToken',
]);
const CHECK_KEYS = new Set(['sessionKey', 'includeSnapshot']);
const interactiveProjectionRateLimit = grantRateLimit(
  'projection.interactive',
  BRIDGE_RATE_LIMITS.interactiveProjectionPerMinute,
);

function limitInteractiveProjection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isJsonObject(req.body) && req.body.launchKind === 'interactive') {
    interactiveProjectionRateLimit(req, res, next);
    return;
  }
  next();
}

interface ValidProjectionIssueRequest extends ProjectionIssueRequest {
  sessionKey: string;
  cwd: string | null;
  launchKind: 'interactive' | 'delegated';
  acceptVersions: number[];
  agentId?: string;
  expectedRevision?: number;
  jobId?: string;
  leaseToken?: string;
}

interface ValidProjectionCheckRequest extends ProjectionCheckRequest {
  sessionKey: string;
  includeSnapshot: boolean;
}

async function canonicalCwd(value: string | null): Promise<string | null | undefined> {
  if (value === null) return null;
  try {
    return await realpath(value);
  } catch {
    return undefined;
  }
}

function validIssueBody(body: unknown): body is ValidProjectionIssueRequest {
  if (!isJsonObject(body) || !hasOnlyKeys(body, ISSUE_KEYS)) return false;
  if (typeof body.sessionKey !== 'string' || body.sessionKey.length < 1 || body.sessionKey.length > 256) return false;
  if (body.cwd !== null && (typeof body.cwd !== 'string' || body.cwd.length > 1024 || !isAbsolute(body.cwd))) return false;
  if (body.launchKind !== 'interactive' && body.launchKind !== 'delegated') return false;
  if (!Array.isArray(body.acceptVersions) || body.acceptVersions.some((value) => !Number.isInteger(value))) return false;
  if (body.launchKind === 'interactive') {
    return typeof body.agentId === 'string'
      && Number.isSafeInteger(body.expectedRevision)
      && (body.expectedRevision as number) >= 0;
  }
  return typeof body.jobId === 'string' && typeof body.leaseToken === 'string';
}

function validCheckBody(body: unknown): body is ValidProjectionCheckRequest {
  return isJsonObject(body)
    && hasOnlyKeys(body, CHECK_KEYS)
    && typeof body.sessionKey === 'string'
    && body.sessionKey.length >= 1
    && body.sessionKey.length <= 256
    && typeof body.includeSnapshot === 'boolean';
}

async function issueProjectionHandler(
  req: Request<Record<string, never>, ProjectionIssueResponse | BridgeErrorResponse, ProjectionIssueRequest>,
  res: Response<ProjectionIssueResponse | BridgeErrorResponse>,
  deps: BridgeDeps,
): Promise<void> {
  const grant = bridgeGrant(res);
  const body = req.body;
  if (!validIssueBody(body)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  if (!body.acceptVersions.includes(2)) {
    sendBridgeError(res, 409, 'projection_version_unsupported');
    return;
  }
  const configs = deps.agentConfigs();
  const repository = deps.projections();
  const delegatedJob = body.launchKind === 'delegated'
    ? repository.getDelegatedJob(body.jobId!)
    : null;
  if (body.launchKind === 'delegated') {
    if (!delegatedJob
      || !['claimed', 'running'].includes(delegatedJob.state)
      || delegatedJob.local_user_id !== grant.localUserId
      || delegatedJob.hermes_profile !== grant.hermesProfile
      || delegatedJob.child_runtime_instance !== grant.runtimeGeneration
      || repository.getByJobId(body.jobId!)) {
      sendBridgeError(res, 409, 'job_not_claimed');
      return;
    }
    if (!delegatedJob.lease_token_sha256
      || !secureDigestMatch(body.leaseToken!, delegatedJob.lease_token_sha256)) {
      sendBridgeError(res, 409, 'lease_invalid');
      return;
    }
    const requestedCwd = await canonicalCwd(body.cwd);
    const jobCwd = await canonicalCwd(delegatedJob.cwd);
    if (requestedCwd === undefined || jobCwd === undefined) {
      sendBridgeError(res, 409, 'cwd_invalid');
      return;
    }
    if (requestedCwd !== jobCwd) {
      sendBridgeError(res, 409, 'cwd_mismatch');
      return;
    }
  }
  const config = configs.getById(
    body.launchKind === 'delegated' ? delegatedJob!.target_agent_id : body.agentId!,
  );
  if (!config) {
    sendBridgeError(res, 404, 'agent_not_found');
    return;
  }
  if (delegatedJob && delegatedJob.target_revision !== (config.revision ?? 0)) {
    repository.failDelegatedJobForRevision(delegatedJob.id, deps.now().toISOString());
    const terminal = new AgentBridgeJobsRepository().get(delegatedJob.id);
    if (terminal?.parent_runtime === 'opencode') {
      void asyncDelegationCompletionService.onBridgeJobTerminal(terminal.parent_session_id)
        .catch((error) => deps.logError('Failed to wake parent for projection revision failure', {
          code: 'target_revision_changed',
          route: 'agent-bridge',
          error: String(error),
        }));
    }
    sendBridgeError(res, 409, 'target_revision_changed');
    return;
  }

  try {
    const launchKind = body.launchKind;
    const projectionId = deps.createProjectionId();
    const projection = await issueProjection(config, {
      localUserId: grant.localUserId,
      runtime: active(grant),
      cwd: typeof body.cwd === 'string' ? body.cwd : null,
      launchKind,
      roster: configs.list(),
      expectedRevision: typeof body.expectedRevision === 'number'
        ? body.expectedRevision
        : undefined,
      leaseToken: typeof body.leaseToken === 'string' ? body.leaseToken : undefined,
      reference: projectionId,
    });
    repository.insert({
      projectionId,
      localUserId: grant.localUserId,
      hermesProfile: 'default',
      agentId: config.id,
      revision: config.revision as number,
      launchKind,
      sessionKey: String(body.sessionKey),
      jobId: (body.jobId ?? null) as string | null,
      depth: delegatedJob?.depth ?? 0,
      chainId: delegatedJob?.chain_id ?? String(body.sessionKey),
      cwd: projection.snapshot.launch.cwd,
      snapshotJson: JSON.stringify(projection.snapshot),
      issuedGeneration: grant.runtimeGeneration,
      issuedAt: deps.now().toISOString(),
    });
    res.json({
      schema: 'rhythm.hermes-projection.v1',
      projectionId,
      agentId: config.id,
      revision: config.revision as number,
      ownerId: String(grant.localUserId),
      snapshot: projection.snapshot,
      reasons: projection.reasons,
    });
  } catch (error) {
    if (error instanceof ProjectionError) {
      sendBridgeError(res, 409, error.code, undefined, error.details);
      return;
    }
    if (error instanceof Error && error.message.includes('agent_bridge_projections.hermes_profile, agent_bridge_projections.session_key')) {
      sendBridgeError(res, 409, 'session_key_reused');
      return;
    }
    if (error instanceof Error && error.message.includes('agent_bridge_projections.job_id')) {
      sendBridgeError(res, 409, 'job_not_claimed');
      return;
    }
    if (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code))) {
      sendBridgeError(res, 409, 'cwd_invalid');
      return;
    }
    throw error;
  }
}

function checkProjectionHandler(
  req: Request<{ projectionId: string }, ProjectionCheckResponse | BridgeErrorResponse, ProjectionCheckRequest>,
  res: Response<ProjectionCheckResponse | BridgeErrorResponse>,
  deps: BridgeDeps,
): void {
  if (!validCheckBody(req.body)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const grant = bridgeGrant(res);
  const row = deps.projections().getForProfile(
    req.params.projectionId,
    req.body.sessionKey,
    grant.hermesProfile,
  );
  if (!row) {
    sendBridgeError(res, 404, 'projection_not_found');
    return;
  }
  if (row.local_user_id !== grant.localUserId) {
    res.status(403).json({ error: { code: 'projection_owner_mismatch' } });
    return;
  }

  const config = deps.agentConfigs().getById(row.agent_id);
  if (!config || config.locked || !config.enabled || !config.isAgent) {
    const reason = config?.locked
      ? 'agent_locked'
      : config && !config.enabled
        ? 'agent_disabled'
        : 'agent_not_runnable';
    sendBridgeError(res, 409, 'projection_revoked', undefined, { reason });
    return;
  }

  res.json({
    ok: true,
    ownerId: String(row.local_user_id),
    ...(req.body.includeSnapshot
      ? { snapshot: JSON.parse(row.snapshot_json) }
      : {}),
  });
}

function createIssueProjectionHandler(
  deps: BridgeDeps,
): RequestHandler<Record<string, never>, ProjectionIssueResponse | BridgeErrorResponse, ProjectionIssueRequest> {
  return function handleIssueProjection(req, res) {
    return issueProjectionHandler(req, res, deps);
  };
}

function createCheckProjectionHandler(
  deps: BridgeDeps,
): RequestHandler<{ projectionId: string }, ProjectionCheckResponse | BridgeErrorResponse, ProjectionCheckRequest> {
  return function handleCheckProjection(req, res) {
    return checkProjectionHandler(req, res, deps);
  };
}

export function register(router: Router, deps: BridgeDeps): void {
  router.post(
    '/projections',
    runtime('projection.issue'),
    limitInteractiveProjection,
    createIssueProjectionHandler(deps),
  );
  router.post(
    '/projections/:projectionId/check',
    runtime('projection.issue'),
    createCheckProjectionHandler(deps),
  );
}
