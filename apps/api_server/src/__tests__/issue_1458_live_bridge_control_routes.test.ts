import { afterEach, describe, expect, it, vi } from 'vitest';

import { startTestServer } from './helpers/real_server';

const { resume, suspend } = vi.hoisted(() => ({
  resume: vi.fn().mockResolvedValue(undefined),
  suspend: vi.fn(),
}));

vi.mock('../config/env', () => ({
  env: {
    agentLocal: true,
    agentExecutionEnabled: true,
    agentOriginGuardEnabled: false,
    corsAllowedOrigins: [],
  },
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    statusMessage: 'ready',
    websearchConfigured: false,
  },
  opencodeSessionMap: new Map(),
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    isLive: true,
    resumeGlobalStreamForLiveTest: resume,
    suspendGlobalStreamForLiveTest: suspend,
  },
}));

import { createApp, isLoopbackAddress } from '../app';

const savedLive = process.env.RHYTHM_LIVE_E2E;
const savedIsolated = process.env.RHYTHM_LIVE_E2E_ISOLATED;

afterEach(() => {
  if (savedLive === undefined) delete process.env.RHYTHM_LIVE_E2E;
  else process.env.RHYTHM_LIVE_E2E = savedLive;
  if (savedIsolated === undefined) delete process.env.RHYTHM_LIVE_E2E_ISOLATED;
  else process.env.RHYTHM_LIVE_E2E_ISOLATED = savedIsolated;
  vi.clearAllMocks();
});

describe('issue #1458 isolated live bridge control route', () => {
  it('accepts only loopback socket addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.0.2.1')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it.each([
    [undefined, undefined],
    ['1', undefined],
    [undefined, '1'],
  ])('is absent unless both live isolation flags are set (%s, %s)', async (live, isolated) => {
    if (live === undefined) delete process.env.RHYTHM_LIVE_E2E;
    else process.env.RHYTHM_LIVE_E2E = live;
    if (isolated === undefined) delete process.env.RHYTHM_LIVE_E2E_ISOLATED;
    else process.env.RHYTHM_LIVE_E2E_ISOLATED = isolated;

    const server = await startTestServer(createApp());
    try {
      expect((await fetch(`${server.baseUrl}/__test/opencode/global-stream/suspend`, {
        method: 'POST',
      })).status).toBe(404);
    } finally {
      await server.close();
    }
    expect(suspend).not.toHaveBeenCalled();
  });

  it('binds suspend and resume controls only in isolated live E2E startup', async () => {
    process.env.RHYTHM_LIVE_E2E = '1';
    process.env.RHYTHM_LIVE_E2E_ISOLATED = '1';

    const server = await startTestServer(createApp());
    try {
      const suspended = await fetch(`${server.baseUrl}/__test/opencode/global-stream/suspend`, {
        method: 'POST',
      });
      expect(suspended.status).toBe(200);
      expect(await suspended.json()).toEqual({ status: 'suspended' });
      expect(suspend).toHaveBeenCalledOnce();

      const resumed = await fetch(`${server.baseUrl}/__test/opencode/global-stream/resume`, {
        method: 'POST',
      });
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toEqual({ status: 'resumed' });
      expect(resume).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });
});
