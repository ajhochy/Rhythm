import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import { requireMobileDevice } from '../middleware/mobile_device_auth';
import type {
  MobileOpenCodeOwnershipReader,
} from '../repositories/mobile_opencode_ownership_repository';
import { getMobilePairingService } from '../services/mobile_gateway_runtime';
import {
  getMobileOpenCodeOwnershipRepository,
} from '../services/mobile_opencode_ownership_runtime';
import { MobileSseProxy } from '../services/mobile_sse_proxy';
import {
  MacOfflineError,
  RelayUplinkServer,
  relayUplinkServer,
} from '../services/relay_uplink_server';

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

  router.all(
    '/mobile-gateway/*',
    (req, res, next) => {
      if (req.method === 'POST' && req.path === '/mobile-gateway/pair') {
        next();
        return;
      }
      requireDevice(req, res, next);
    },
    async (req, res, next) => {
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
    },
  );

  return router;
}
