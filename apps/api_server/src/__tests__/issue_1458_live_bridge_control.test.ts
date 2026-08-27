import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { opencodeEventHub } from '../services/opencode_event_hub';
import { buildOpencodeHealthPayload } from '../services/opencode_health';

const { broadcast, subscribe } = vi.hoisted(() => ({
  broadcast: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast,
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToGlobalEvents: (...args: unknown[]) => subscribe(...args),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    getSessionStatuses: vi.fn().mockResolvedValue({}),
    listQuestions: vi.fn().mockResolvedValue([]),
    listPermissions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

const savedLive = process.env.RHYTHM_LIVE_E2E;
const savedIsolated = process.env.RHYTHM_LIVE_E2E_ISOLATED;

async function* stalledStream(): AsyncIterable<never> {
  await new Promise(() => {});
}

describe('issue #1458 isolated live bridge fault control', () => {
  beforeEach(() => {
    process.env.RHYTHM_LIVE_E2E = '1';
    process.env.RHYTHM_LIVE_E2E_ISOLATED = '1';
    subscribe.mockReset();
    broadcast.mockReset();
    opencodeEventHub.setLive(false);
  });

  afterEach(() => {
    if (savedLive === undefined) delete process.env.RHYTHM_LIVE_E2E;
    else process.env.RHYTHM_LIVE_E2E = savedLive;
    if (savedIsolated === undefined) delete process.env.RHYTHM_LIVE_E2E_ISOLATED;
    else process.env.RHYTHM_LIVE_E2E_ISOLATED = savedIsolated;
    opencodeEventHub.setLive(false);
  });

  it('aborts the stream, suppresses reconnect, reports unavailable, then resumes normally', async () => {
    const firstAbort = vi.fn();
    subscribe
      .mockResolvedValueOnce({ abort: firstAbort, stream: stalledStream() })
      .mockResolvedValueOnce({ abort: vi.fn(), stream: stalledStream() });
    const bridge = new OpencodeStreamBridge();

    await bridge.ensureGlobalStream();
    expect(bridge.isLive).toBe(true);
    bridge.suspendGlobalStreamForLiveTest();

    expect(firstAbort).toHaveBeenCalledOnce();
    expect(bridge.isLive).toBe(false);
    expect(opencodeEventHub.isLive()).toBe(false);
    await bridge.ensureGlobalStream();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(buildOpencodeHealthPayload(
      { isReady: true, statusMessage: 'ready', websearchConfigured: false },
      bridge,
    )).toMatchObject({ status: 'unavailable', bridgeLive: false });

    await bridge.resumeGlobalStreamForLiveTest();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(bridge.isLive).toBe(true);
    expect(opencodeEventHub.isLive()).toBe(true);
    expect(broadcast.mock.calls.map(([frame]) => frame)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'bridge.status', status: 'reconnecting' }),
      expect.objectContaining({ type: 'bridge.status', status: 'ready' }),
    ]));
    bridge.dispose();
  });

  it('rejects direct use when either isolation flag is absent', async () => {
    const bridge = new OpencodeStreamBridge();
    delete process.env.RHYTHM_LIVE_E2E_ISOLATED;

    expect(() => bridge.suspendGlobalStreamForLiveTest()).toThrow(/disabled/);
    await expect(bridge.resumeGlobalStreamForLiveTest()).rejects.toThrow(/disabled/);
    bridge.dispose();
  });
});
