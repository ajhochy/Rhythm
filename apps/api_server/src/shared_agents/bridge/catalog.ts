import type { Request, RequestHandler, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { grantForUser } from '../bridge_grants';
import type { BridgeErrorResponse } from '../bridge_schema';
import {
  SHARED_AGENT_CATALOG_SCHEMA,
  type SharedAgentCatalogV1,
  type SharedAgentV1,
} from '../contract';
import { buildSharedAgent, catalogScope } from '../projection_service';
import {
  active,
  bridgeGrant,
  defaultBridgeDeps,
  inactiveRuntime,
  runtime,
  sendBridgeError,
  type BridgeDeps,
} from './common';

function validNoQuery(req: Request): boolean {
  return Object.keys(req.query).length === 0;
}

function sessionRevision(req: Request): number | undefined | null {
  if (Object.keys(req.query).some((key) => key !== 'sessionRevision')) return null;
  if (req.query.sessionRevision === undefined) return undefined;
  if (typeof req.query.sessionRevision !== 'string' || !/^\d+$/.test(req.query.sessionRevision)) return null;
  const value = Number(req.query.sessionRevision);
  return Number.isSafeInteger(value) ? value : null;
}

async function runtimeCatalogHandler(
  _req: Request,
  res: Response<SharedAgentCatalogV1>,
  deps: BridgeDeps,
): Promise<void> {
  if (!validNoQuery(_req)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const grant = bridgeGrant(res);
  const agents = await Promise.all(deps.agentConfigs().list().map((config) => (
    buildSharedAgent(config, {
      localUserId: grant.localUserId,
      runtime: active(grant),
      cwd: null,
    })
  )));
  res.json({
    schema: SHARED_AGENT_CATALOG_SCHEMA,
    generatedAt: deps.now().toISOString(),
    scope: catalogScope(grant.localUserId),
    agents,
  });
}

async function runtimeAgentHandler(
  req: Request<{ agentId: string }>,
  res: Response<SharedAgentV1 | BridgeErrorResponse>,
  deps: BridgeDeps,
): Promise<void> {
  const revision = sessionRevision(req);
  if (revision === null) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const grant = bridgeGrant(res);
  const config = deps.agentConfigs().getById(req.params.agentId);
  if (!config) {
    sendBridgeError(res, 404, 'agent_not_found');
    return;
  }

  res.json(await buildSharedAgent(config, {
    localUserId: grant.localUserId,
    runtime: active(grant),
    cwd: null,
    sessionRevision: revision,
  }));
}

async function rendererCatalogHandler(
  req: Request,
  res: Response<SharedAgentCatalogV1>,
  deps: BridgeDeps,
): Promise<void> {
  if (!validNoQuery(req)) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const user = req.auth!.user;
  const grant = grantForUser(user.id);
  const agents = await Promise.all(deps.agentConfigs().list().map((config) => (
    buildSharedAgent(config, {
      localUserId: user.id,
      runtime: grant ? active(grant) : inactiveRuntime(),
      cwd: null,
    })
  )));
  res.json({
    schema: SHARED_AGENT_CATALOG_SCHEMA,
    generatedAt: deps.now().toISOString(),
    scope: catalogScope(user.id),
    agents,
  });
}

async function rendererAgentHandler(
  req: Request<{ agentId: string }>,
  res: Response<SharedAgentV1 | BridgeErrorResponse>,
  deps: BridgeDeps,
): Promise<void> {
  const revision = sessionRevision(req);
  if (revision === null) {
    sendBridgeError(res, 400, 'bridge_invalid_request');
    return;
  }
  const user = req.auth!.user;
  const config = deps.agentConfigs().getById(req.params.agentId);
  if (!config) {
    sendBridgeError(res, 404, 'agent_not_found');
    return;
  }

  const grant = grantForUser(user.id);
  res.json(await buildSharedAgent(config, {
    localUserId: user.id,
    runtime: grant ? active(grant) : inactiveRuntime(),
    cwd: null,
    sessionRevision: revision,
  }));
}

function createRuntimeCatalogHandler(deps: BridgeDeps): RequestHandler {
  return function handleRuntimeCatalog(req, res) {
    return runtimeCatalogHandler(req, res, deps);
  };
}

function createRuntimeAgentHandler(
  deps: BridgeDeps,
): RequestHandler<{ agentId: string }, SharedAgentV1 | BridgeErrorResponse> {
  return function handleRuntimeAgent(req, res) {
    return runtimeAgentHandler(req, res, deps);
  };
}

function createRendererCatalogHandler(deps: BridgeDeps): RequestHandler {
  return function handleRendererCatalog(req, res) {
    return rendererCatalogHandler(req, res, deps);
  };
}

function createRendererAgentHandler(
  deps: BridgeDeps,
): RequestHandler<{ agentId: string }, SharedAgentV1 | BridgeErrorResponse> {
  return function handleRendererAgent(req, res) {
    return rendererAgentHandler(req, res, deps);
  };
}

function registerRendererRoutes(router: Router, deps: BridgeDeps): void {
  router.get('/catalog', createRendererCatalogHandler(deps));
  router.get('/catalog/:agentId', createRendererAgentHandler(deps));
}

export function register(router: Router, deps: BridgeDeps): void {
  router.get('/catalog', runtime('catalog.read'), createRuntimeCatalogHandler(deps));
  router.get('/catalog/:agentId', runtime('catalog.read'), createRuntimeAgentHandler(deps));
}

export const sharedAgentsCatalogRouter = createRouter();
registerRendererRoutes(sharedAgentsCatalogRouter, defaultBridgeDeps);
