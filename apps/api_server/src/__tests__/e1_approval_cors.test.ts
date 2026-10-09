import { expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { startTestServer } from './helpers/real_server';

it('permits the signed human capability header on an allowed local renderer preflight', async () => {
  const previousLocal = env.agentLocal;
  const previousGuard = env.agentOriginGuardEnabled;
  const previousOrigins = env.localRendererOrigins;
  env.agentLocal = true;
  env.agentOriginGuardEnabled = true;
  env.localRendererOrigins = ['http://127.0.0.1:4175'];
  let close: (() => Promise<void>) | undefined;
  try {
    const server = await startTestServer(createApp());
    close = server.close;
    const response = await fetch(`${server.baseUrl}/agent-approvals?status=pending`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:4175',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,x-rhythm-human-approval',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4175');
    const allowed = response.headers.get('access-control-allow-headers')?.toLowerCase().split(',').map((item) => item.trim());
    expect(allowed).toContain('authorization');
    expect(allowed).toContain('x-rhythm-human-approval');
  } finally {
    await close?.();
    env.agentLocal = previousLocal;
    env.agentOriginGuardEnabled = previousGuard;
    env.localRendererOrigins = previousOrigins;
  }
});
