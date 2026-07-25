import express from 'express';
import { describe, expect, it } from 'vitest';

import { startTestServer } from '../../__tests__/helpers/real_server';
import { createMobileGatewaySurface } from '../../mobile_gateway_surface';

describe('issue-1171: dedicated mobile gateway listener', () => {
  it('publishes only /mobile-gateway and rejects legacy local API routes', async () => {
    const router = express.Router();
    router.get('/health', (_req, res) => {
      res.json({ status: 'ready' });
    });

    const { baseUrl, close } = await startTestServer(
      createMobileGatewaySurface(router),
    );
    try {
      const gateway = await fetch(`${baseUrl}/mobile-gateway/health`);
      expect(gateway.status).toBe(200);
      await expect(gateway.json()).resolves.toEqual({ status: 'ready' });

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
