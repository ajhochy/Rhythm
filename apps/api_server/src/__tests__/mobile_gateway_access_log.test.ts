/**
 * Regression: `/mobile-gateway` appeared ZERO times across every api_server log
 * file back to Sep 7, so the 2026-09-30 outage left no trace to reconstruct.
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  mobileGatewayAccessLog,
  redactGatewayPath,
} from '../services/mobile_gateway_access_log';
import { logger } from '../utils/logger';

describe('redactGatewayPath', () => {
  it('collapses identifier segments so the log groups by route', () => {
    expect(
      redactGatewayPath('/opencode/session/ses_8f3b21aa99d0/message'),
    ).toBe('/opencode/session/:id/message');
    expect(
      redactGatewayPath('/artifacts/4f1c2d3e-5a6b-7c8d-9e0f-1a2b3c4d5e6f'),
    ).toBe('/artifacts/:id');
    expect(redactGatewayPath('/pty/12345/connect')).toBe('/pty/:id/connect');
  });

  it('keeps ordinary route words intact', () => {
    expect(redactGatewayPath('/opencode/health')).toBe('/opencode/health');
    expect(redactGatewayPath('/mobile-environments')).toBe('/mobile-environments');
  });
});

describe('mobileGatewayAccessLog', () => {
  it('logs method, redacted route, status and duration', async () => {
    const lines: string[] = [];
    vi.spyOn(logger, 'info').mockImplementation((message: string) => {
      lines.push(message);
    });
    const app = express();
    app.use('/mobile-gateway', mobileGatewayAccessLog('MobileGateway'));
    app.get('/mobile-gateway/opencode/session/:id/message', (_req, res) => {
      res.status(503).json({ error: 'mac_offline' });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/mobile-gateway/opencode/session/ses_abc123def456/message?limit=20`,
      { headers: { Authorization: 'Device super-secret-token' } },
    );
    await response.text();
    expect(response.status).toBe(503);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const line = lines.find((entry) => entry.includes('[MobileGateway]'));
    expect(line).toBeDefined();
    expect(line).toContain('GET /opencode/session/:id/message -> 503');
    expect(line).toMatch(/in \d+ms$/);
    // Never log credentials, tokens, or the query string.
    expect(line).not.toContain('super-secret-token');
    expect(line).not.toContain('ses_abc123def456');
    expect(line).not.toContain('limit=20');
    vi.restoreAllMocks();
  });
});
