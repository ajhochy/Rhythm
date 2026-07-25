import express from 'express';
import { describe, expect, it } from 'vitest';

import { startTestServer } from '../../__tests__/helpers/real_server';
import { createMobileGatewaySurface } from '../../mobile_gateway_surface';

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
        ['GET', '/mobile-gateway/opencode/session', 200],
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
});
