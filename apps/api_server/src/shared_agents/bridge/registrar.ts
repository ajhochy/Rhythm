import type { Request, RequestHandler, Response, Router } from 'express';

import {
  BRIDGE_SCOPES,
  BridgeGrantConflictError,
  grantForId,
  registerGrant,
  revokeAllGrants,
  revokeGrant,
  type BridgeScope,
} from '../bridge_grants';
import type {
  BridgeErrorResponse,
  RegisterGrantRequest,
  RegisterGrantResponse,
  RevokeScopesRequest,
  RevokeScopesResponse,
} from '../bridge_schema';
import {
  registrar,
  hasOnlyKeys,
  isJsonObject,
  sendBridgeError,
  type BridgeDeps,
} from './common';
import { computeMemoryVaultId } from '../memory_search_service';

const REGISTER_GRANT_KEYS = new Set([
  'grantId', 'capabilitySha256', 'sessionToken', 'hermesProfile',
  'runtimeGeneration', 'serverOrigin', 'authGeneration', 'scopes', 'memoryVaultId',
]);
const REVOKE_SCOPE_KEYS = new Set(['scopes']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;

function validServerOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const origin = new URL(value);
    if (origin.origin !== value || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return false;
    if (origin.protocol === 'https:') return true;
    return origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port !== '';
  } catch {
    return false;
  }
}

function validRegisterGrantBody(body: unknown): body is RegisterGrantRequest & {
  grantId: string;
  capabilitySha256: string;
  sessionToken: string;
  runtimeGeneration: string;
  serverOrigin: string;
  authGeneration: string;
  scopes: BridgeScope[];
} {
  return isJsonObject(body)
    && hasOnlyKeys(body, REGISTER_GRANT_KEYS)
    && typeof body.grantId === 'string' && UUID_RE.test(body.grantId)
    && typeof body.capabilitySha256 === 'string' && SHA256_RE.test(body.capabilitySha256)
    && typeof body.sessionToken === 'string' && body.sessionToken.length >= 1 && body.sessionToken.length <= 4096
    && body.hermesProfile === 'default'
    && typeof body.runtimeGeneration === 'string' && UUID_RE.test(body.runtimeGeneration)
    && validServerOrigin(body.serverOrigin)
    && typeof body.authGeneration === 'string' && body.authGeneration.length >= 1 && body.authGeneration.length <= 128
    && Array.isArray(body.scopes)
    && body.scopes.every((value) => typeof value === 'string' && (BRIDGE_SCOPES as readonly string[]).includes(value))
    && (body.memoryVaultId === undefined || (typeof body.memoryVaultId === 'string' && SHA256_RE.test(body.memoryVaultId)));
}

async function registerGrantHandler(
  req: Request<Record<string, never>, RegisterGrantResponse | BridgeErrorResponse, RegisterGrantRequest>,
  res: Response<RegisterGrantResponse | BridgeErrorResponse>,
  deps: BridgeDeps,
): Promise<void> {
  const body = req.body;
  if (!validRegisterGrantBody(body)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }

  const user = await deps.resolveBearer(body.sessionToken);
  if (!user) {
    sendBridgeError(res, 403, 'grant_identity_unresolved');
    return;
  }

  if (body.scopes.includes('memory.search')) {
    const currentVaultId = await computeMemoryVaultId();
    if (!currentVaultId || body.memoryVaultId !== currentVaultId) {
      sendBridgeError(res, 409, 'memory_vault_changed');
      return;
    }
  }

  let result;
  try {
    result = registerGrant({
      grantId: body.grantId,
      capabilitySha256: body.capabilitySha256,
      localUserId: user.id,
      hermesProfile: 'default',
      runtimeGeneration: body.runtimeGeneration,
      serverOrigin: body.serverOrigin,
      authGeneration: body.authGeneration,
      scopes: body.scopes,
      memoryVaultId: typeof body.memoryVaultId === 'string' ? body.memoryVaultId : null,
    });
  } catch (error) {
    if (error instanceof BridgeGrantConflictError) {
      sendBridgeError(res, 409, 'grant_id_conflict');
      return;
    }
    throw error;
  }
  res.status(201).json({
    grantId: result.grant.grantId,
    replacedGrantId: result.replacedGrantId,
  });
}

function createRegisterGrantHandler(
  deps: BridgeDeps,
): RequestHandler<Record<string, never>, RegisterGrantResponse | BridgeErrorResponse, RegisterGrantRequest> {
  return function handleRegisterGrant(req, res) {
    return registerGrantHandler(req, res, deps);
  };
}

function revokeGrantHandler(
  req: Request<{ grantId: string }>,
  res: Response,
): void {
  if (req.body !== undefined && (!isJsonObject(req.body) || Object.keys(req.body).length > 0)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  revokeGrant(req.params.grantId);
  res.sendStatus(204);
}

function revokeAllGrantsHandler(req: Request, res: Response): void {
  if (!isJsonObject(req.body) || Object.keys(req.body).length > 0) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  revokeAllGrants();
  res.sendStatus(204);
}

function revokeScopesHandler(
  req: Request<{ grantId: string }, RevokeScopesResponse | BridgeErrorResponse, RevokeScopesRequest>,
  res: Response<RevokeScopesResponse | BridgeErrorResponse>,
): void {
  const grant = grantForId(req.params.grantId);
  if (!grant) {
    sendBridgeError(res, 404, 'grant_not_found');
    return;
  }

  if (
    !isJsonObject(req.body)
    || !hasOnlyKeys(req.body, REVOKE_SCOPE_KEYS)
    || !Array.isArray(req.body.scopes)
    || req.body.scopes.some((scope) => typeof scope !== 'string' || !(BRIDGE_SCOPES as readonly string[]).includes(scope))
  ) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const scopes = req.body.scopes as BridgeScope[];
  for (const scope of scopes) {
    grant.scopes.delete(scope);
  }
  res.json({ scopes: [...grant.scopes] });
}

export function register(router: Router, deps: BridgeDeps): void {
  router.post('/registrar/grants', registrar, createRegisterGrantHandler(deps));
  router.delete('/registrar/grants/:grantId', registrar, revokeGrantHandler);
  router.post('/registrar/revoke-all', registrar, revokeAllGrantsHandler);
  router.post('/registrar/grants/:grantId/revoke-scopes', registrar, revokeScopesHandler);
}
