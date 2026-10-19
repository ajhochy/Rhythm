/**
 * Regression: a failed engine initialization was cached forever.
 * `/opencode/health` kept answering "Timeout waiting for server to start after
 * 5000ms" with a healthy engine listening on :4096, nothing ever retried
 * (Electron's agent-server.mjs: "No automatic restart"), and the payload gave
 * the user no indication anything was being done about it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENGINE_RECOVERY_THROTTLE_MS,
  buildOpencodeHealthPayload,
  resetEngineRecoveryThrottle,
  tryRecoverEngine,
} from '../services/opencode_health';

beforeEach(() => resetEngineRecoveryThrottle());

describe('engine health recovery', () => {
  it('kicks a re-initialization when the engine is not ready', async () => {
    const ensureReady = vi.fn(async () => true);
    expect(tryRecoverEngine({ isReady: false, ensureReady }, 1_000)).toBe(true);
    await vi.waitFor(() => expect(ensureReady).toHaveBeenCalledTimes(1));
  });

  it('never re-initializes a healthy engine', () => {
    const ensureReady = vi.fn(async () => true);
    expect(tryRecoverEngine({ isReady: true, ensureReady }, 1_000)).toBe(false);
    expect(ensureReady).not.toHaveBeenCalled();
  });

  it('throttles retries so polling cannot become a spawn storm', async () => {
    const ensureReady = vi.fn(async () => false);
    const client = { isReady: false, ensureReady };
    expect(tryRecoverEngine(client, 1_000)).toBe(true);
    expect(tryRecoverEngine(client, 1_000 + ENGINE_RECOVERY_THROTTLE_MS - 1)).toBe(false);
    expect(tryRecoverEngine(client, 1_000 + ENGINE_RECOVERY_THROTTLE_MS)).toBe(true);
    await vi.waitFor(() => expect(ensureReady).toHaveBeenCalledTimes(2));
  });

  it('survives an ensureReady that rejects', async () => {
    const ensureReady = vi.fn(async () => { throw new Error('spawn failed'); });
    expect(tryRecoverEngine({ isReady: false, ensureReady }, 1_000)).toBe(true);
    await vi.waitFor(() => expect(ensureReady).toHaveBeenCalled());
  });

  it('tells the user recovery is under way instead of only what broke', () => {
    const payload = buildOpencodeHealthPayload(
      {
        isReady: false,
        statusMessage:
          'Opencode SDK error: Timeout waiting for server to start after 5000ms',
        websearchConfigured: false,
        ensureReady: async () => true,
      },
      { isLive: true },
    );
    expect(payload.status).toBe('unavailable');
    expect(payload.recovering).toBe(true);
    expect(payload.message).toContain('Timeout waiting for server to start');
    expect(payload.message).toContain('being restarted automatically');
  });

  it('keeps the explanation while throttled, not only on the retry tick', () => {
    const client = {
      isReady: false,
      statusMessage: 'Opencode SDK error: Timeout waiting for server to start after 5000ms',
      websearchConfigured: false,
      ensureReady: async () => true,
    };
    const first = buildOpencodeHealthPayload(client, { isLive: true });
    const throttled = buildOpencodeHealthPayload(client, { isLive: true });

    expect(first.recovering).toBe(true);
    expect(throttled.recovering).toBe(false);
    // The advice must not blink out with the throttle window.
    expect(throttled.message).toBe(first.message);
    expect(throttled.message).toContain('being restarted automatically');
  });

  it('leaves a ready payload untouched', () => {
    const payload = buildOpencodeHealthPayload(
      {
        isReady: true,
        statusMessage: 'Opencode SDK ready',
        websearchConfigured: true,
        ensureReady: async () => true,
      },
      { isLive: true },
    );
    expect(payload).toMatchObject({
      status: 'ready',
      message: 'Opencode SDK ready',
      recovering: false,
    });
  });
});
