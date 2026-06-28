import { describe, it, expect } from 'vitest';
import express from 'express';
import { startTestServer } from './real_server';

describe('startTestServer', () => {
  it('serves the app on an ephemeral 127.0.0.1 port reachable via fetch', async () => {
    const app = express();
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const { baseUrl, close } = await startTestServer(app);
    try {
      expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const res = await fetch(`${baseUrl}/ping`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await close();
    }
  });

  it('disables keep-alive so every response carries Connection: close (anti-flake)', async () => {
    const app = express();
    app.get('/x', (_req, res) => res.send('x'));

    const { baseUrl, close, server } = await startTestServer(app);
    try {
      // maxRequestsPerSocket = 1 is what makes the server emit `Connection: close`
      // so undici never pools a keep-alive socket against the ephemeral port.
      expect(server.maxRequestsPerSocket).toBe(1);
      const res = await fetch(`${baseUrl}/x`);
      expect(res.headers.get('connection')).toBe('close');
      await res.text();
    } finally {
      await close();
    }
  });

  it('close() resolves and leaves the port free to recycle without UND_ERR_SOCKET', async () => {
    // Reuse-then-recycle: start, hit, close, then start again and hit again.
    // With the old (close-only) teardown this is the scenario that
    // intermittently failed with UND_ERR_SOCKET; the helper must make it
    // deterministic across many iterations.
    for (let i = 0; i < 10; i++) {
      const app = express();
      app.get('/n', (_req, res) => res.json({ i }));
      const { baseUrl, close } = await startTestServer(app);
      const res = await fetch(`${baseUrl}/n`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ i });
      await close();
    }
  });
});
