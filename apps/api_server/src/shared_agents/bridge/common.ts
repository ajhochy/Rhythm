import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router,
} from 'express';
import { randomUUID } from 'node:crypto';

import { env } from '../../config/env';
import { resolveLocalOrCloudBearer } from '../../middleware/auth_middleware';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { logger } from '../../utils/logger';
import {
  grantForCapability,
  secureDigestMatch,
  type BridgeGrant,
  type BridgeScope,
} from '../bridge_grants';
import type { BridgeErrorResponse } from '../bridge_schema';
import type { HermesRuntimeState } from '../projection_service';
import { AgentBridgeProjectionsRepository } from '../projections_repository';

export const BRIDGE_LIMITS = {
  requestBodyBytes: 65_536,
  catalogResponseBytes: 1024 * 1024,
  responseBytes: 256 * 1024,
  promptCharacters: 32_768,
  contextCharacters: 16_384,
  queryCharacters: 256,
  resultTextBytes: 65_536,
  storedResultCharacters: 16_384,
} as const;

export const BRIDGE_RATE_LIMITS = {
  globalPerSecond: 30,
  dispatchPerMinute: 10,
  interactiveProjectionPerMinute: 30,
  memorySearchPerMinute: 30,
  agentPatchPerMinute: 30,
  runtimeReportPerMinute: 12,
  claimConcurrent: 1,
  registrarPerMinute: 60,
} as const;

interface RateWindow {
  startedAt: number;
  count: number;
}

const rateWindows = new Map<string, RateWindow>();
const activeClaimGrants = new Set<string>();

function registrarConfigured(): boolean {
  return /^[a-f0-9]{64}$/.test(env.agentBridgeRegistrarSha256);
}

function consumeRateLimit(
  key: string,
  maximum: number,
  windowMs: number,
  nowMs: number,
): number | null {
  const current = rateWindows.get(key);
  const window = !current || nowMs - current.startedAt >= windowMs
    ? { startedAt: nowMs, count: 0 }
    : current;
  window.count += 1;
  rateWindows.set(key, window);
  if (window.count <= maximum) return null;
  return Math.max(1, Math.ceil((window.startedAt + windowMs - nowMs) / 1000));
}

function rejectRateLimit(res: Response, retryAfter: number): void {
  res.setHeader('Retry-After', String(retryAfter));
  sendBridgeError(res, 429, 'bridge_rate_limited');
}

export interface BridgeDeps {
  agentConfigs(): AgentConfigsRepository;
  projections(): AgentBridgeProjectionsRepository;
  resolveBearer: typeof resolveLocalOrCloudBearer;
  createProjectionId(): string;
  now(): Date;
  logError(message: string, metadata: Record<string, unknown>): void;
}

export const defaultBridgeDeps: BridgeDeps = {
  agentConfigs: () => new AgentConfigsRepository(),
  projections: () => new AgentBridgeProjectionsRepository(),
  resolveBearer: resolveLocalOrCloudBearer,
  createProjectionId: randomUUID,
  now: () => new Date(),
  logError: (message, metadata) => logger.error(message, metadata),
};

export function sendBridgeError(
  res: Response,
  status: number,
  code: string,
  message = code.replaceAll('_', ' '),
  details: Record<string, unknown> = {},
): void {
  const body: BridgeErrorResponse = { error: { code, message, ...details } };
  res.status(status).json(body);
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function registrar(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.header('Origin')) {
    sendBridgeError(res, 403, 'bridge_origin_forbidden');
    return;
  }
  const secret = req.header('X-Rhythm-Bridge-Registrar') ?? '';
  if (!registrarConfigured()) {
    sendBridgeError(res, 503, 'bridge_unavailable');
    return;
  }
  if (!secret || !secureDigestMatch(secret, env.agentBridgeRegistrarSha256)) {
    sendBridgeError(res, 403, 'bridge_registrar_denied');
    return;
  }
  const retryAfter = consumeRateLimit(
    'registrar',
    BRIDGE_RATE_LIMITS.registrarPerMinute,
    60_000,
    Date.now(),
  );
  if (retryAfter !== null) {
    rejectRateLimit(res, retryAfter);
    return;
  }
  next();
}

export function runtime(scope: BridgeScope): RequestHandler {
  return function requireRuntimeScope(req, res, next): void {
    if (!registrarConfigured()) {
      sendBridgeError(res, 503, 'bridge_unavailable');
      return;
    }
    const origin = req.header('Origin');
    if (origin) {
      sendBridgeError(res, 403, 'bridge_origin_forbidden');
      return;
    }

    const grant = grantForCapability(req.header('X-Rhythm-Bridge-Capability') ?? '');
    if (!grant) {
      sendBridgeError(res, 401, 'bridge_capability_unknown');
      return;
    }
    if (!grant.scopes.has(scope)) {
      sendBridgeError(res, 403, 'bridge_scope_denied');
      return;
    }

    const retryAfter = consumeRateLimit(
      `grant:${grant.grantId}:global`,
      BRIDGE_RATE_LIMITS.globalPerSecond,
      1_000,
      Date.now(),
    );
    if (retryAfter !== null) {
      rejectRateLimit(res, retryAfter);
      return;
    }

    res.locals.bridgeGrant = grant;
    next();
  };
}

export function grantRateLimit(
  bucket: string,
  maximum: number,
  windowMs = 60_000,
): RequestHandler {
  return function enforceGrantRateLimit(_req, res, next): void {
    const grant = bridgeGrant(res);
    const retryAfter = consumeRateLimit(
      `grant:${grant.grantId}:${bucket}`,
      maximum,
      windowMs,
      Date.now(),
    );
    if (retryAfter !== null) {
      rejectRateLimit(res, retryAfter);
      return;
    }
    next();
  };
}

export function claimConcurrencyLimit(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const grantId = bridgeGrant(res).grantId;
  if (activeClaimGrants.has(grantId)) {
    rejectRateLimit(res, 1);
    return;
  }
  activeClaimGrants.add(grantId);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    activeClaimGrants.delete(grantId);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}

export function resetBridgeRateLimitsForTest(): void {
  rateWindows.clear();
  activeClaimGrants.clear();
}

export function active(grant: BridgeGrant): HermesRuntimeState {
  const owned = registrarConfigured();
  return {
    owned,
    bridgeAvailable: owned,
    connected: true,
    reported: grant.report !== null,
    executorFresh: grant.lastClaimAt !== null && Date.now() - grant.lastClaimAt < 45_000,
    providers: grant.report?.providers,
    reasoningEfforts: grant.report?.reasoningEfforts,
    terminalBackend: grant.report?.terminalBackend,
  };
}

export function inactiveRuntime(): HermesRuntimeState {
  const owned = registrarConfigured();
  return {
    owned,
    bridgeAvailable: owned,
    connected: false,
  };
}

export function bridgeGrant(res: Response): BridgeGrant {
  return res.locals.bridgeGrant as BridgeGrant;
}

export function registerBodyParser(router: Router): void {
  router.use(express.json({
    limit: BRIDGE_LIMITS.requestBodyBytes,
    strict: true,
    type: 'application/json',
  }));
}

export function registerTerminalHandlers(router: Router, deps: BridgeDeps): void {
  router.use(function bridgeNotFoundHandler(_req, res): void {
    sendBridgeError(res, 404, 'bridge_not_found');
  });

  router.use(function bridgeErrorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const errorType = typeof err === 'object' && err !== null && 'type' in err
      ? (err as { type?: unknown }).type
      : undefined;
    const tooLarge = errorType === 'entity.too.large';
    const parseFailure = errorType === 'entity.parse.failed';
    const code = tooLarge
      ? 'bridge_body_too_large'
      : parseFailure
        ? 'bridge_invalid_request'
        : 'bridge_internal';

    deps.logError(`Agent bridge request failed (${code})`, {
      code,
      route: 'agent-bridge',
    });
    sendBridgeError(res, tooLarge ? 413 : parseFailure ? 400 : 500, code);
  });
}
