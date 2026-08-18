import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import express from 'express';
import { describe, expect, it } from 'vitest';

import { startTestServer } from '../../__tests__/helpers/real_server';
import {
  createMobileGatewaySurface,
  mobileJsonBodyLimitBytes,
  MOBILE_PROMPT_JSON_LIMIT_BYTES,
} from '../../mobile_gateway_surface';
import {
  mobileOpenCodeRequestBodyLimitBytes,
  MOBILE_OPENCODE_PROMPT_BODY_LIMIT_BYTES,
  MOBILE_OPENCODE_REQUEST_BODY_LIMIT_BYTES,
} from '../mobile_opencode_proxy';

const mobileLimitsSource = readFileSync(
  resolve(process.cwd(), '../mobile/lib/attachments/limits.ts'),
  'utf8',
);
const mobileAttachmentLimitMb = Number(
  mobileLimitsSource.match(
    /MOBILE_ATTACHMENT_LIMIT_BYTES = (\d+) \* 1024 \* 1024/,
  )?.[1],
);
const MOBILE_ATTACHMENT_LIMIT_BYTES = mobileAttachmentLimitMb * 1024 * 1024;
const MAX_BASE64_JSON_INFLATION = 1.37;

describe('issue-1171: dedicated mobile gateway listener', () => {
  it('publishes only phone-required gateway routes and rejects loopback admin routes', async () => {
    const router = express.Router();
    router.get('/health', (_req, res) => {
      res.json({ status: 'ready' });
    });
    router.post('/pair', (_req, res) => res.status(201).json({ paired: true }));
    router.delete('/devices/:id', (req, res) => {
      res.json({ revoked: req.params.id });
    });
    router.post('/project', (_req, res) => res.json({ selected: true }));
    router.get('/projects', (_req, res) => {
      res.json({ projects: [{ id: 'project-1', name: 'Project' }] });
    });
    router.get('/agent-activity', (_req, res) => {
      res.json({ items: [], nextCursor: null });
    });
    router.get('/chat-catalog', (_req, res) => {
      res.json([{ id: 'session-1' }]);
    });
    router.get('/events', (_req, res) => res.json({ stream: 'global' }));
    router.get('/sessions/:id/events', (req, res) => {
      res.json({ stream: req.params.id });
    });
    router.all('/tools/*', (req, res) => {
      res.json({ tool: req.path });
    });
    router.all('/opencode/*', (req, res) => {
      res.json({ forwarded: req.path });
    });
    router.post('/pairing-codes', (_req, res) => {
      res.status(201).json({ pairingCode: 'loopback-only' });
    });
    router.get('/devices', (_req, res) => res.json([{ id: 'private-device' }]));
    router.get('/access', (_req, res) => res.json({ state: 'healthy' }));
    router.post('/access/enable', (_req, res) => {
      res.json({ state: 'healthy' });
    });

    const { baseUrl, close } = await startTestServer(
      createMobileGatewaySurface(router),
    );
    try {
      const gateway = await fetch(`${baseUrl}/mobile-gateway/health`);
      expect(gateway.status).toBe(200);
      await expect(gateway.json()).resolves.toEqual({ status: 'ready' });

      for (const [method, path, expectedStatus] of [
        ['POST', '/mobile-gateway/pair', 201],
        ['DELETE', '/mobile-gateway/devices/device-1', 200],
        ['POST', '/mobile-gateway/project', 200],
        ['GET', '/mobile-gateway/projects', 200],
        ['GET', '/mobile-gateway/agent-activity?source=research', 200],
        ['GET', '/mobile-gateway/chat-catalog?limit=10', 200],
        ['GET', '/mobile-gateway/events', 200],
        ['GET', '/mobile-gateway/sessions/session-1/events', 200],
        ['GET', '/mobile-gateway/opencode/session', 200],
        ['GET', '/mobile-gateway/tools/agent-memory', 200],
      ] as const) {
        const response = await fetch(`${baseUrl}${path}`, { method });
        expect(response.status, `${method} ${path}`).toBe(expectedStatus);
      }

      for (const [method, path] of [
        ['POST', '/mobile-gateway/pairing-codes'],
        ['GET', '/mobile-gateway/devices'],
        ['GET', '/mobile-gateway/access'],
        ['POST', '/mobile-gateway/access/enable'],
      ] as const) {
        const response = await fetch(`${baseUrl}${path}`, { method });
        expect(response.status, `${method} ${path}`).toBe(404);
      }

      for (const path of [
        '/health',
        '/auth/me',
        '/agent-configs',
        '/agent-sessions',
        '/opencode/auth/status',
        '/pty',
        '/system/refresh',
      ]) {
        const response = await fetch(`${baseUrl}${path}`);
        expect(response.status, path).toBe(404);
      }
    } finally {
      await close();
    }
  });

  it('issues #1308/#1311: only attachment-carrying prompt routes accept the 15 MB JSON budget', async () => {
    expect(
      MOBILE_ATTACHMENT_LIMIT_BYTES * MAX_BASE64_JSON_INFLATION,
    ).toBeLessThanOrEqual(MOBILE_PROMPT_JSON_LIMIT_BYTES);

    expect(MOBILE_OPENCODE_PROMPT_BODY_LIMIT_BYTES).toBe(
      MOBILE_PROMPT_JSON_LIMIT_BYTES,
    );
    expect(mobileOpenCodeRequestBodyLimitBytes('session.prompt_async')).toBe(
      MOBILE_PROMPT_JSON_LIMIT_BYTES,
    );
    expect(mobileOpenCodeRequestBodyLimitBytes('session.create')).toBe(
      MOBILE_OPENCODE_REQUEST_BODY_LIMIT_BYTES,
    );
    expect(mobileJsonBodyLimitBytes(
      'POST',
      '/mobile-gateway/opencode/session/session-1308/prompt_async',
    )).toBe(MOBILE_PROMPT_JSON_LIMIT_BYTES);
    expect(mobileJsonBodyLimitBytes(
      'POST',
      '/mobile-gateway/opencode/session/session-1308/prompt',
    )).toBe(MOBILE_PROMPT_JSON_LIMIT_BYTES);
    expect(mobileJsonBodyLimitBytes(
      'POST',
      '/mobile-gateway/opencode/session',
    )).toBe(1024 * 1024);
  });
});
