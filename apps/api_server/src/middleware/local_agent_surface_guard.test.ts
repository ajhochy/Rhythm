import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { startTestServer } from '../__tests__/helpers/real_server';
import { isAllowedLocalAgentSurfaceRequest } from './local_agent_surface_guard';

const original = {
  agentLocal: env.agentLocal,
  agentOriginGuardEnabled: env.agentOriginGuardEnabled,
  localRendererOrigins: env.localRendererOrigins,
};

describe('shared local renderer origin contract', () => {
  beforeEach(() => {
    env.agentLocal = true;
    env.agentOriginGuardEnabled = true;
    env.localRendererOrigins = ['rhythm://app'];
  });

  afterEach(() => {
    env.agentLocal = original.agentLocal;
    env.agentOriginGuardEnabled = original.agentOriginGuardEnabled;
    env.localRendererOrigins = original.localRendererOrigins;
  });

  it('allows only configured renderer origins on loopback hosts', () => {
    // Regression caught: a Flutter-spawned service rejects Electron despite receiving the shared
    // allowlist, or accepts an unlisted web origin; these exact paired assertions fail.
    expect(isAllowedLocalAgentSurfaceRequest({
      origin: 'rhythm://app',
      host: '127.0.0.1:4001',
    })).toBe(true);
    expect(isAllowedLocalAgentSurfaceRequest({
      origin: 'https://evil.example',
      host: '127.0.0.1:4001',
    })).toBe(false);
  });

  it('emits ACAO for Electron and rejects an untrusted AGENT_LOCAL preflight', async () => {
    // Regression caught: app.ts omits Electron ACAO or weakens AGENT_LOCAL to permit arbitrary
    // origins; the exact allowed header or hostile 403 assertion fails.
    const server = await startTestServer(createApp());
    try {
      const allowed = await fetch(`${server.baseUrl}/agent-sessions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'rhythm://app',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('access-control-allow-origin')).toBe('rhythm://app');

      const rejected = await fetch(`${server.baseUrl}/agent-sessions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(rejected.status).toBe(403);
      await expect(rejected.json()).resolves.toEqual({
        error: { code: 'FORBIDDEN_ORIGIN' },
      });
      expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await server.close();
    }
  });
});
