import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  env,
  resolveLiveArtifactStorageDir,
  resolveRelayArtifactStorageDir,
} from '../config/env';
import { AppError } from '../errors/app_error';
import { requireLocalOrCloudAuth } from '../middleware/auth_middleware';
import { requireMobileDevice } from '../middleware/mobile_device_auth';
import type {
  MobileOpenCodeOwnershipReader,
} from '../repositories/mobile_opencode_ownership_repository';
import { getMobilePairingService } from '../services/mobile_gateway_runtime';
import { MobileDevicesRepository } from '../repositories/mobile_devices_repository';
import { getDb } from '../database/db';
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
  relayPublicUrl?: string | null;
  allowInsecureLoopbackForTests?: boolean;
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
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_DEVICE_NAME_LENGTH = 128;

function validatedRelayPublicUrl(
  value: string | null | undefined,
  allowInsecureLoopbackForTests = false,
): string {
  if (!value) throw AppError.internal('Relay public URL is not configured');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw AppError.internal('Relay public URL is invalid');
  }
  const testLoopback =
    allowInsecureLoopbackForTests &&
    url.protocol === 'http:' &&
    ['127.0.0.1', '::1', 'localhost'].includes(url.hostname.toLowerCase());
  if (
    (url.protocol !== 'https:' && !testLoopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && !testLoopback)
  ) {
    throw AppError.internal('Relay public URL is invalid');
  }
  return url.toString().replace(/\/$/, '');
}

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
  if (req.method === 'GET' || req.method === 'HEAD') return '';
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
  const configuredRelayPublicUrl = dependencies.relayPublicUrl ?? env.relayPublicUrl;
  const liveSseResponses = new Set<Response>();
  uplink.onResynced(() => {
    for (const response of liveSseResponses) response.end();
    liveSseResponses.clear();
  });

  router.get('/mobile-environments', requireLocalOrCloudAuth, (req, res) => {
    const enrollment = new MobileDevicesRepository(getDb()).findSoleEnrollment();
    const userId = req.auth!.user.id;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      environments: enrollment?.userId === userId
        ? [{
            id: enrollment.hostId,
            name: 'Rhythm Mac',
            status: uplink.isHostOnline(enrollment.hostId, userId)
              ? 'online'
              : 'offline',
            historyAvailable: true,
          }]
        : [],
    });
  });

  router.post(
    '/mobile-environments/:id/connect',
    requireLocalOrCloudAuth,
    async (req, res, next) => {
      try {
        const enrollment = new MobileDevicesRepository(getDb())
          .findSoleEnrollment();
        const userId = req.auth!.user.id;
        if (
          !enrollment ||
          enrollment.userId !== userId ||
          enrollment.hostId !== req.params.id
        ) {
          throw AppError.notFound('Mobile environment');
        }
        const deviceName = typeof req.body?.deviceName === 'string'
          ? req.body.deviceName.trim()
          : '';
        if (!deviceName || deviceName.length > MAX_DEVICE_NAME_LENGTH) {
          throw AppError.badRequest(
            'deviceName must be between 1 and 128 characters',
          );
        }
        if (!uplink.isHostOnline(enrollment.hostId, userId)) {
          res.status(503).json({ error: 'mac_offline' });
          return;
        }
        const gatewayBaseUrl = validatedRelayPublicUrl(
          configuredRelayPublicUrl,
          dependencies.allowInsecureLoopbackForTests ??
            env.relayAllowInsecureLoopbackForTests,
        );
        const response = await uplink.sendRpc({
          method: 'POST',
          path: '/mobile-gateway/bootstrap/connect',
          headers: {
            authorization: `Bearer ${req.auth!.sessionToken}`,
            'content-type': 'application/json',
          },
          bodyB64: Buffer.from(JSON.stringify({
            environmentId: enrollment.hostId,
            deviceName,
          })).toString('base64'),
        });
        if (response.status !== 201) {
          res.status(response.status).end(
            Buffer.from(response.bodyB64, 'base64'),
          );
          return;
        }
        const grant = JSON.parse(
          Buffer.from(response.bodyB64, 'base64').toString('utf8'),
        ) as Record<string, unknown>;
        if (
          grant.hostId !== enrollment.hostId ||
          grant.userId !== userId ||
          typeof grant.deviceId !== 'string' ||
          typeof grant.deviceToken !== 'string'
        ) {
          throw AppError.internal('Invalid bootstrap grant');
        }
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({
          environmentId: enrollment.hostId,
          hostId: enrollment.hostId,
          deviceId: grant.deviceId,
          deviceToken: grant.deviceToken,
          gatewayBaseUrl,
        });
      } catch (error) {
        next(error instanceof AppError ? error : AppError.internal());
      }
    },
  );

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      role: 'relay',
      macOnline: uplink.isMacOnline(),
      lastUplinkAt: uplink.getLastUplinkAt(),
    });
  });

  router.get('/mobile-gateway/health', (_req, res) => {
    const health = uplink.getHealth();
    if (health === null) {
      res.status(503).json({
        error: 'no_uplink',
        lastUplinkAt: uplink.getLastUplinkAt(),
      });
      return;
    }
    const body =
      typeof health === 'object' &&
        health !== null &&
        !Array.isArray(health)
      ? {
          ...(health as Record<string, unknown>),
          macOnline: uplink.isMacOnline(),
          lastUplinkAt: uplink.getLastUplinkAt(),
        }
      : {
          health,
          macOnline: uplink.isMacOnline(),
          lastUplinkAt: uplink.getLastUplinkAt(),
        };
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
        if (
          req.header('x-rhythm-session-discovery') === 'owner-unscoped' &&
          uplink.isMacOnline()
        ) {
          await tunnelRequest(uplink, req, res, next);
          return;
        }
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

  router.get(
    '/mobile-gateway/artifacts/:id',
    requireDevice,
    async (req, res, next) => {
      const artifactId = req.params.id;
      if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
        res.status(400).json({ error: 'invalid_artifact_id' });
        return;
      }

      const storageDir = resolveRelayArtifactStorageDir();
      for (const candidateDir of [storageDir, resolveLiveArtifactStorageDir()]) {
        const artifactPath = join(candidateDir, artifactId);
        const metadataPath = join(candidateDir, `${artifactId}.meta.json`);
        try {
          const bytes = await readFile(artifactPath);
          let metadata: {
            contentType?: unknown;
            ownerUserId?: unknown;
            projectId?: unknown;
            sessionId?: unknown;
          };
          try {
            metadata = JSON.parse(
              await readFile(metadataPath, 'utf8'),
            ) as typeof metadata;
          } catch {
            res.status(404).json({ error: 'artifact_not_found' });
            return;
          }
          if (
            metadata.ownerUserId !== req.mobileDevice!.userId ||
            metadata.projectId !== relayProject(req).id ||
            typeof metadata.sessionId !== 'string' ||
            metadata.sessionId.trim() === ''
          ) {
            res.status(404).json({ error: 'artifact_not_found' });
            return;
          }
          const contentType = typeof metadata.contentType === 'string'
            ? metadata.contentType
            : 'application/octet-stream';
          res.setHeader('content-type', contentType);
          res.status(200).send(bytes);
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && code !== 'EISDIR' && code !== 'ENOTDIR') {
            next(error);
            return;
          }
        }
      }

      if (!uplink.isMacOnline()) {
        res.status(404).json({ error: 'mac_offline' });
        return;
      }

      try {
        const response = await uplink.sendRpc({
          method: req.method,
          path: tunneledPath(req),
          headers: forwardedHeaders(req),
          bodyB64: requestBodyB64(req),
        });
        const bytes = Buffer.from(response.bodyB64, 'base64');
        const contentType = Object.entries(response.headers).find(
          ([name]) => name.toLowerCase() === 'content-type',
        )?.[1] ?? 'application/octet-stream';
        const responseHeader = (name: string) => Object.entries(response.headers)
          .find(([candidate]) => candidate.toLowerCase() === name)?.[1];
        const artifactOwnerId = Number(responseHeader('x-rhythm-artifact-owner-id'));
        const artifactProjectId = responseHeader('x-rhythm-artifact-project-id');
        const artifactSessionId = responseHeader('x-rhythm-artifact-session-id');
        if (
          response.status === 200 &&
          artifactOwnerId === req.mobileDevice!.userId &&
          artifactProjectId === relayProject(req).id &&
          typeof artifactSessionId === 'string' &&
          artifactSessionId.trim() !== ''
        ) {
          try {
            await mkdir(storageDir, { recursive: true });
            await Promise.all([
              writeFile(join(storageDir, artifactId), bytes),
              writeFile(
                join(storageDir, `${artifactId}.meta.json`),
                JSON.stringify({
                  contentType,
                  ownerUserId: artifactOwnerId,
                  projectId: artifactProjectId,
                  sessionId: artifactSessionId,
                }),
              ),
            ]);
          } catch (error) {
            logger.warn(
              `[RelayGateway] failed to cache artifact ${artifactId}: ${String(error)}`,
            );
          }
        }
        for (const [name, value] of Object.entries(response.headers)) {
          if (
            !HOP_BY_HOP_HEADERS.has(name.toLowerCase()) &&
            !name.toLowerCase().startsWith('x-rhythm-artifact-')
          ) {
            res.setHeader(name, value);
          }
        }
        res.status(response.status).end(bytes);
      } catch (error) {
        if (error instanceof MacOfflineError) {
          res.status(404).json({ error: 'mac_offline' });
          return;
        }
        next(error);
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
