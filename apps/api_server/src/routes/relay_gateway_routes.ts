import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import { requireMobileDevice } from '../middleware/mobile_device_auth';
import type {
  MobileOpenCodeOwnershipReader,
} from '../repositories/mobile_opencode_ownership_repository';
import { getMobilePairingService } from '../services/mobile_gateway_runtime';
import {
  readMirrorSessionChildren,
  readMirrorSessionList,
  readMirrorTranscript,
} from '../services/mobile_mirror_reads';
import { MOBILE_OPENCODE_OPERATION_MANIFEST } from '../services/mobile_opencode_operations.generated';
import {
  MOBILE_OPENCODE_RESPONSE_BODY_LIMIT_BYTES,
  MOBILE_SESSION_MESSAGE_PAGE_SIZE,
} from '../services/mobile_opencode_proxy';
import {
  getMobileOpenCodeOwnershipRepository,
} from '../services/mobile_opencode_ownership_runtime';
import { shapeMobileOpenCodeResponse } from '../services/mobile_opencode_security';
import { MobileSseProxy } from '../services/mobile_sse_proxy';
import {
  MacOfflineError,
  RelayUplinkServer,
  relayUplinkServer,
} from '../services/relay_uplink_server';
import { logger } from '../utils/logger';

export interface RelayGatewayRouterDependencies {
  uplink?: RelayUplinkServer;
  ownershipRepository?: MobileOpenCodeOwnershipReader;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function relayProject(req: Request): { id: string; root: string } {
  const projectId = req.header('X-Rhythm-Project-ID')?.trim();
  if (!projectId) throw AppError.badRequest('X-Rhythm-Project-ID is required');
  // The relay has no local filesystem project root. Ownership remains keyed by
  // this opaque project id, while `/` prevents host-path shaping from inventing
  // a NAS-local path boundary.
  return { id: projectId, root: '/' };
}

function forwardedHeaders(req: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (
      value === undefined ||
      name.toLowerCase() === 'content-length' ||
      HOP_BY_HOP_HEADERS.has(name.toLowerCase())
    ) {
      continue;
    }
    result[name.toLowerCase()] = Array.isArray(value)
      ? value.join(', ')
      : value;
  }
  return result;
}

function requestBodyB64(req: Request): string {
  if (req.body === undefined || req.body === null) return '';
  if (Buffer.isBuffer(req.body)) return req.body.toString('base64');
  const body = typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body);
  return Buffer.from(body, 'utf8').toString('base64');
}

function tunneledPath(req: Request): string {
  const original = req.originalUrl;
  return original.startsWith('/relay/')
    ? original.slice('/relay'.length)
    : original;
}

function pageLimit(raw: string | null, fallback = 100, max = 100): number {
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

function pageCursor(raw: string | null): number {
  const parsed = Number(raw ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function sendMirrorResponse(
  res: Response,
  value: unknown,
  headers?: Record<string, string>,
): void {
  const body = Buffer.from(JSON.stringify(value));
  if (body.byteLength > MOBILE_OPENCODE_RESPONSE_BODY_LIMIT_BYTES) {
    throw new AppError(
      502,
      'UPSTREAM_RESPONSE_TOO_LARGE',
      'OpenCode response exceeded the mobile gateway limit',
    );
  }
  res.type('application/json');
  for (const [name, headerValue] of Object.entries(headers ?? {})) {
    res.set(name, headerValue);
  }
  res.status(200).send(body);
}

async function readRelayMirror<T>(
  reader: () => T | Promise<T>,
): Promise<T | null> {
  try {
    return await reader();
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn(
      `[RelayGateway] mirror read unavailable (${
        error instanceof Error ? error.name : 'UnknownError'
      })`,
    );
    return null;
  }
}

async function tunnelRequest(
  uplink: RelayUplinkServer,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!uplink.isMacOnline()) {
    res.status(503).json({ error: 'mac_offline' });
    return;
  }
  try {
    const response = await uplink.sendRpc({
      method: req.method,
      path: tunneledPath(req),
      headers: forwardedHeaders(req),
      bodyB64: requestBodyB64(req),
    });
    for (const [name, value] of Object.entries(response.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    }
    res.status(response.status).end(Buffer.from(response.bodyB64, 'base64'));
  } catch (error) {
    if (error instanceof MacOfflineError) {
      res.status(503).json({ error: 'mac_offline' });
      return;
    }
    next(error);
  }
}

/**
 * Phone-facing surface of the Synology relay container (RHYTHM_ROLE=relay),
 * mounted at `/relay` (docs/ai/plan-synology-relay.md). Phase 0 is the
 * deploy-verification skeleton: just enough to prove the Cloudflare path rule
 * and the LAN port route here and nowhere else.
 *
 * Phase 1 adds the uplink server, device auth against replicated verifiers,
 * the event hub SSE, and the RPC tunnel catch-all.
 */
export function createRelayGatewayRouter(
  dependencies: RelayGatewayRouterDependencies = {},
): Router {
  const router = Router();
  const uplink = dependencies.uplink ?? relayUplinkServer;
  const ownership = dependencies.ownershipRepository ??
    getMobileOpenCodeOwnershipRepository();
  const sseProxy = new MobileSseProxy({
    hub: uplink.hub,
    ownershipRepository: ownership,
    fetchFn: async () => {
      throw new Error('Relay SSE engine fallback is disabled');
    },
  });
  const requireDevice = requireMobileDevice(getMobilePairingService);
  const liveSseResponses = new Set<Response>();
  uplink.onResynced(() => {
    for (const response of liveSseResponses) response.end();
    liveSseResponses.clear();
  });

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      role: 'relay',
      macOnline: uplink.isMacOnline(),
    });
  });

  router.get('/mobile-gateway/health', (_req, res) => {
    const health = uplink.getHealth();
    if (health === null) {
      res.status(503).json({ error: 'no_uplink' });
      return;
    }
    const body =
      typeof health === 'object' &&
        health !== null &&
        !Array.isArray(health)
      ? {
          ...(health as Record<string, unknown>),
          macOnline: uplink.isMacOnline(),
        }
      : { health, macOnline: uplink.isMacOnline() };
    res.json(body);
  });

  const streamEvents = (sessionId?: string) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!uplink.hub.isLive()) {
        res.status(503).json({ error: 'mac_offline' });
        return;
      }
      const authorization = req.header('Authorization') ?? '';
      const token = authorization.match(/^Device\s+(\S+)$/i)?.[1] ?? '';
      const deviceId = req.mobileDevice!.id;
      liveSseResponses.add(res);
      const removeLiveResponse = () => liveSseResponses.delete(res);
      res.once('close', removeLiveResponse);
      res.once('finish', removeLiveResponse);
      try {
        await sseProxy.stream({
          request: req,
          response: res,
          project: relayProject(req),
          userId: req.mobileDevice!.userId,
          ...(sessionId ? { sessionId } : {}),
          isDeviceActive: () => {
            const active = getMobilePairingService().authenticateDevice(token);
            return active !== null && active.id === deviceId;
          },
        });
      } catch (error) {
        if (res.headersSent) {
          res.end();
          return;
        }
        next(error instanceof AppError ? error : AppError.internal());
      } finally {
        removeLiveResponse();
      }
    };

  router.get(
    '/mobile-gateway/events',
    requireDevice,
    (req, res, next) => void streamEvents()(req, res, next),
  );
  router.get(
    '/mobile-gateway/sessions/:id/events',
    requireDevice,
    (req, res, next) => void streamEvents(req.params.id)(req, res, next),
  );

  router.all('/mobile-gateway/pty/*', requireDevice, (_req, res) => {
    res.status(501).json({ error: 'pty_requires_direct_connection' });
  });

  // Relay-served mirror reads (Track 5). Keep this region separate from the
  // realtime handlers above so SSE lifecycle changes can merge independently.
  const tunnelMirrorMiss = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!uplink.isMacOnline()) {
      res.status(503).json({
        error: 'mac_offline_and_mirror_incomplete',
      });
      return;
    }
    await tunnelRequest(uplink, req, res, next);
  };

  router.get(
    '/mobile-gateway/opencode/experimental/session',
    requireDevice,
    async (req, res, next) => {
      try {
        const project = relayProject(req);
        const query = new URL(req.originalUrl, 'http://relay.local')
          .searchParams;
        const page = await readRelayMirror(() =>
          readMirrorSessionList({
            archived: query.get('archived') === 'true',
            cursor: pageCursor(query.get('cursor')),
            limit: pageLimit(query.get('limit')),
            project,
            userId: req.mobileDevice!.userId,
            ...(query.get('search')?.trim()
              ? { sessionId: query.get('search')!.trim() }
              : {}),
          })
        );
        if (page === null) {
          await tunnelMirrorMiss(req, res, next);
          return;
        }
        sendMirrorResponse(
          res,
          page.items,
          page.nextCursor === null
            ? undefined
            : { 'x-next-cursor': String(page.nextCursor) },
        );
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );

  router.get(
    '/mobile-gateway/opencode/session/:id/message',
    requireDevice,
    async (req, res, next) => {
      try {
        const project = relayProject(req);
        const query = new URL(req.originalUrl, 'http://relay.local')
          .searchParams;
        const safeValue = await readRelayMirror(async () => {
          const messages = readMirrorTranscript({
            project,
            sdkSessionId: req.params.id,
            userId: req.mobileDevice!.userId,
            limit: MOBILE_SESSION_MESSAGE_PAGE_SIZE,
            ...(query.get('before')?.trim()
              ? { before: query.get('before')!.trim() }
              : {}),
          });
          if (messages === null) return null;
          const authoritativeDirectory =
            ownership.resolveSessionDirectoryForOwner?.(
              req.params.id,
              req.mobileDevice!.userId,
              project.id,
            );
          const requestProject = authoritativeDirectory
            ? { ...project, root: authoritativeDirectory }
            : project;
          const operation = MOBILE_OPENCODE_OPERATION_MANIFEST.find(
            (candidate) => candidate.operationId === 'session.messages',
          )!;
          return shapeMobileOpenCodeResponse(
            operation,
            messages,
            requestProject,
            () => {
              throw AppError.internal(
                'Mirror reads must not contact OpenCode',
              );
            },
            `/session/${encodeURIComponent(req.params.id)}/message`,
            {
              ownerUserId: req.mobileDevice!.userId,
              ownership,
            },
            false,
            {},
          );
        });
        if (safeValue === null) {
          await tunnelMirrorMiss(req, res, next);
          return;
        }
        sendMirrorResponse(res, safeValue);
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );

  router.get(
    '/mobile-gateway/opencode/session/:id/children',
    requireDevice,
    async (req, res, next) => {
      try {
        const children = await readRelayMirror(() =>
          readMirrorSessionChildren({
            project: relayProject(req),
            sdkSessionId: req.params.id,
            userId: req.mobileDevice!.userId,
          })
        );
        if (children === null) {
          await tunnelMirrorMiss(req, res, next);
          return;
        }
        sendMirrorResponse(res, children);
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );

  router.all(
    '/mobile-gateway/*',
    (req, res, next) => {
      if (req.method === 'POST' && req.path === '/mobile-gateway/pair') {
        next();
        return;
      }
      requireDevice(req, res, next);
    },
    (req, res, next) => void tunnelRequest(uplink, req, res, next),
  );

  return router;
}
