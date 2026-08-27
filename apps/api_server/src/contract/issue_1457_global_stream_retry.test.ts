import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { opencodeEventHub } from '../services/opencode_event_hub';
import { buildOpencodeHealthPayload } from '../services/opencode_health';

const { subscribeSpy, broadcastSpy } = vi.hoisted(() => ({
  subscribeSpy: vi.fn(),
  broadcastSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: broadcastSpy,
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToGlobalEvents: (...args: unknown[]) => subscribeSpy(...args),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    getSessionStatuses: vi.fn().mockResolvedValue({}),
    listQuestions: vi.fn().mockResolvedValue([]),
    listPermissions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

async function* stalledStream(): AsyncIterable<never> {
  await new Promise(() => {});
}

const subscription = () => ({ abort: vi.fn(), stream: stalledStream() });

describe('issue #1457 global stream retry contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribeSpy.mockReset();
    broadcastSpy.mockReset();
    opencodeEventHub.setLive(false);
  });

  afterEach(() => {
    opencodeEventHub.setLive(false);
    vi.useRealTimers();
  });

  it('issue-1457-c1: a failed subscribe retries with bounded backoff without streamSession', async () => {
    subscribeSpy.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue(subscription());
    const bridge = new OpencodeStreamBridge();

    await bridge.ensureGlobalStream();
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(subscribeSpy).toHaveBeenCalledTimes(2);
    expect(bridge.isLive).toBe(true);
    bridge.dispose();
  });

  it('issue-1457-c2: three consecutive failures cannot disarm retry', async () => {
    subscribeSpy
      .mockRejectedValueOnce(new Error('one'))
      .mockRejectedValueOnce(new Error('two'))
      .mockRejectedValueOnce(new Error('three'))
      .mockResolvedValue(subscription());
    const bridge = new OpencodeStreamBridge();

    await bridge.ensureGlobalStream();
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);

    expect(subscribeSpy).toHaveBeenCalledTimes(4);
    expect(bridge.isLive).toBe(true);
    bridge.dispose();
  });

  it('issue-1457-c3: failed and recovered subscriptions update mobile hub liveness', async () => {
    subscribeSpy.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue(subscription());
    const bridge = new OpencodeStreamBridge();

    await bridge.ensureGlobalStream();
    expect(opencodeEventHub.isLive()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(opencodeEventHub.isLive()).toBe(true);
    bridge.dispose();
  });

  it('issue-1457-c4: recovery reruns reconcile and orphaned-ask recovery', async () => {
    subscribeSpy.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue(subscription());
    const bridge = new OpencodeStreamBridge();
    const reconcile = vi.spyOn(bridge, 'reconcileSessionStatuses');
    const questions = vi.spyOn(bridge, 'recoverPendingQuestions');
    const permissions = vi.spyOn(bridge, 'recoverPendingPermissions');
    vi.spyOn(
      bridge as unknown as { activeDirectories(): string[] },
      'activeDirectories',
    ).mockReturnValue(['/repo']);

    await bridge.ensureGlobalStream();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(reconcile).toHaveBeenCalled();
    expect(questions).toHaveBeenCalledWith('/repo');
    expect(permissions).toHaveBeenCalledWith('/repo');
    bridge.dispose();
  });

  it('issue-1457-c5: failed subscription is health-visible as unavailable', async () => {
    subscribeSpy.mockRejectedValue(new Error('ECONNRESET'));
    const bridge = new OpencodeStreamBridge();

    await bridge.ensureGlobalStream();

    expect(buildOpencodeHealthPayload(
      { isReady: true, statusMessage: 'ready', websearchConfigured: false },
      bridge,
    )).toMatchObject({
      status: 'unavailable',
      bridgeLive: false,
      message: expect.stringContaining('bridge unavailable'),
    });
    bridge.dispose();
  });

  it('issue-1457-c5: outage and recovery publish one user-visible bridge status transition each', async () => {
    subscribeSpy.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue(subscription());
    const bridge = new OpencodeStreamBridge();

    await bridge.ensureGlobalStream();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(broadcastSpy.mock.calls.map(([frame]) => frame)).toEqual([
      {
        v: 1,
        type: 'bridge.status',
        status: 'reconnecting',
        message: 'Agent updates interrupted — reconnecting…',
        retryDelayMs: 1_000,
        attempt: 1,
      },
      {
        v: 1,
        type: 'bridge.status',
        status: 'ready',
        message: 'Agent updates reconnected.',
      },
    ]);
    bridge.dispose();
  });

  it('issue-1457-c6: one transient failure self-heals without attaching a session', async () => {
    subscribeSpy.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue(subscription());
    const bridge = new OpencodeStreamBridge();

    await bridge.ensureGlobalStream();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(bridge.isLive).toBe(true);
    bridge.dispose();
  });

  it('serializes concurrent subscription attempts so only one stream is created', async () => {
    let resolveSubscribe!: (value: ReturnType<typeof subscription>) => void;
    subscribeSpy.mockReturnValue(new Promise((resolve) => { resolveSubscribe = resolve; }));
    const bridge = new OpencodeStreamBridge();

    const first = bridge.ensureGlobalStream();
    const second = bridge.ensureGlobalStream();
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    resolveSubscribe(subscription());
    await Promise.all([first, second]);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });
});
