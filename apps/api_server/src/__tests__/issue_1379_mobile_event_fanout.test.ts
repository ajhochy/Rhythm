import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  globalEventProducerLive,
  publishGlobalEvent,
  resetGlobalEventBus,
  setGlobalEventProducerLive,
  subscribeGlobalEvents,
} from '../services/mobile_event_bus';
import { MobileSseProxy } from '../services/mobile_sse_proxy';
import { OpencodeClientService } from '../services/opencode_client_service';

/**
 * #1379 Phase 2 — mobile rides the bridge's single consolidated
 * `/global/event` subscription instead of opening one engine stream per phone.
 *
 * The load-bearing claim is "the engine is contacted zero times", so these
 * tests assert against a `fetchFn` spy rather than against timing.
 */

const permissiveOwnershipRepository = {
  isResourceOwnedBy: () => true,
  claimResource: () => true,
  releaseResource: () => true,
};

function responseSink(): PassThrough & {
  statusCode: number;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  flushHeaders(): void;
} {
  const stream = new PassThrough() as ReturnType<typeof responseSink>;
  stream.statusCode = 200;
  stream.headers = {};
  stream.setHeader = (name: string, value: string) => {
    stream.headers[name.toLowerCase()] = value;
  };
  stream.flushHeaders = vi.fn();
  return stream;
}

function envelope(
  directory: string,
  id: string,
  type = 'session.updated',
  sessionId = 'ses-one',
): Record<string, unknown> {
  return {
    directory,
    payload: {
      id,
      type,
      properties: { info: { id: sessionId } },
    },
  };
}

/** Start a proxy stream and collect everything written downstream. */
function startStream(options: Record<string, unknown> = {}) {
  const fetchFn = vi.fn(async () => {
    throw new Error('engine must not be contacted');
  });
  const proxy = new MobileSseProxy({
    fetchFn: options.fetchFn ?? fetchFn,
    ownershipRepository: permissiveOwnershipRepository,
    reconnectBaseMs: 1,
    reconnectMaxMs: 2,
    ...options,
  } as unknown as ConstructorParameters<typeof MobileSseProxy>[0]);
  const request = new EventEmitter();
  const response = responseSink();
  let output = '';
  response.on('data', (chunk) => {
    output += chunk.toString();
  });
  const streaming = proxy.stream({
    request,
    response,
    project: { id: 'project-fanout', root: '/sandbox/project' },
    userId: 1,
    isDeviceActive: () => true,
  } as unknown as Parameters<MobileSseProxy['stream']>[0]);
  return {
    fetchFn,
    request,
    response,
    streaming,
    output: () => output,
  };
}

describe('issue #1379 Phase 2 — mobile SSE fan-out from the consolidated stream', () => {
  afterEach(() => {
    resetGlobalEventBus();
    vi.restoreAllMocks();
  });

  it('serves a phone entirely from the bus, contacting the engine zero times', async () => {
    setGlobalEventProducerLive(true);
    const stream = startStream();

    await expect.poll(() => globalEventProducerLive()).toBe(true);
    // Publish until the subscriber has attached; publishing before the
    // subscription exists is a legitimate drop, not a delivery failure.
    const pump = setInterval(() => {
      publishGlobalEvent(envelope('/sandbox/project', 'evt-bus-1'));
    }, 5);

    await expect.poll(() => stream.output(), { timeout: 2_000 })
      .toContain('evt-bus-1');
    clearInterval(pump);
    stream.request.emit('close');
    await stream.streaming;

    expect(stream.fetchFn).not.toHaveBeenCalled();
    // Redaction still applies on the new source: the host path never ships.
    expect(stream.output()).toContain('"directory":"project-fanout"');
    expect(stream.output()).not.toContain('/sandbox/project');
  });

  it('re-applies project isolation to fan-out frames', async () => {
    setGlobalEventProducerLive(true);
    const stream = startStream();

    const pump = setInterval(() => {
      publishGlobalEvent(envelope('/outside/project', 'evt-foreign', 'session.updated', 'ses-other'));
      publishGlobalEvent(envelope('/sandbox/project', 'evt-mine'));
    }, 5);

    await expect.poll(() => stream.output(), { timeout: 2_000 })
      .toContain('evt-mine');
    clearInterval(pump);
    stream.request.emit('close');
    await stream.streaming;

    expect(stream.output()).not.toContain('evt-foreign');
    expect(stream.output()).not.toContain('/outside/project');
  });

  it('forwards heartbeats, which the bridge swallows but the phone needs', async () => {
    setGlobalEventProducerLive(true);
    const stream = startStream();

    const pump = setInterval(() => {
      publishGlobalEvent({
        payload: { id: 'hb-1', type: 'server.heartbeat', properties: {} },
      });
    }, 5);

    await expect.poll(() => stream.output(), { timeout: 2_000 })
      .toContain('server.heartbeat');
    clearInterval(pump);
    stream.request.emit('close');
    await stream.streaming;
    expect(stream.fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to a direct engine stream when no producer is attached', async () => {
    // Producer deliberately NOT marked live: consolidated mode off, an engine
    // without /global/event, or api_server before its first session.
    expect(globalEventProducerLive()).toBe(false);
    const encoder = new TextEncoder();
    const fetchFn = vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify(envelope('/sandbox/project', 'evt-wire'))}\n\n`,
            ));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ));
    const stream = startStream({ fetchFn });

    await expect.poll(() => stream.output(), { timeout: 2_000 })
      .toContain('evt-wire');
    stream.request.emit('close');
    await stream.streaming;
    expect(fetchFn).toHaveBeenCalled();
  });

  it('falls back to the engine after the producer detaches mid-stream', async () => {
    setGlobalEventProducerLive(true);
    const encoder = new TextEncoder();
    const fetchFn = vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify(envelope('/sandbox/project', 'evt-after-detach'))}\n\n`,
            ));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ));
    const stream = startStream({ fetchFn });

    const pump = setInterval(() => {
      publishGlobalEvent(envelope('/sandbox/project', 'evt-before-detach'));
    }, 5);
    await expect.poll(() => stream.output(), { timeout: 2_000 })
      .toContain('evt-before-detach');
    clearInterval(pump);
    expect(fetchFn).not.toHaveBeenCalled();

    // Engine died / watchdog is resubscribing — the phone's own connection
    // must survive and pick the stream back up from the engine directly.
    setGlobalEventProducerLive(false);
    await expect.poll(() => stream.output(), { timeout: 2_000 })
      .toContain('evt-after-detach');
    stream.request.emit('close');
    await stream.streaming;
    expect(fetchFn).toHaveBeenCalled();
  });

  it('bounds a slow subscriber instead of growing the queue, without blocking the producer', async () => {
    const subscription = subscribeGlobalEvents({ maxQueued: 4 });
    setGlobalEventProducerLive(true);
    // A subscriber that never reads. Publishing must stay synchronous and
    // cheap — the producer also drives SQLite persistence for every session,
    // so one slow phone must never exert backpressure on it.
    const started = Date.now();
    for (let i = 0; i < 10_000; i += 1) {
      publishGlobalEvent(envelope('/sandbox/project', `evt-${i}`));
    }
    expect(Date.now() - started).toBeLessThan(1_000);

    await expect(
      (async () => {
        for await (const _ of subscription.events) {
          // The overflow surfaces as a throw, not as silent truncation.
        }
      })(),
    ).rejects.toMatchObject({ code: 'STREAM_BACKPRESSURE' });
  });

  it('ends every subscriber when the producer detaches', async () => {
    const subscription = subscribeGlobalEvents();
    setGlobalEventProducerLive(true);
    const drained = (async () => {
      const seen: unknown[] = [];
      for await (const event of subscription.events) seen.push(event);
      return seen;
    })();
    publishGlobalEvent(envelope('/sandbox/project', 'evt-1'));
    setGlobalEventProducerLive(false);
    await expect(drained).resolves.toHaveLength(1);
    expect(globalEventProducerLive()).toBe(false);
  });

  it('the engine subscription feeds the bus and reports producer liveness', async () => {
    const encoder = new TextEncoder();
    let push: (chunk: string) => void = () => undefined;
    let stop: () => void = () => undefined;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            push = (chunk) => controller.enqueue(encoder.encode(chunk));
            stop = () => controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ) as Response,
    );

    const service = new OpencodeClientService();
    const subscription = await service.subscribeToGlobalEvents();
    expect(subscription).not.toBeNull();
    if (!subscription) return;

    // Marked live as soon as the stream is established, so MobileSseProxy
    // stops dialing the engine without waiting for the first frame.
    expect(globalEventProducerLive()).toBe(true);

    const received: Record<string, unknown>[] = [];
    const busSubscription = subscribeGlobalEvents();
    const collecting = (async () => {
      for await (const event of busSubscription.events) received.push(event);
    })();

    const drain = (async () => {
      for await (const _ of subscription.stream) {
        // Draining the bridge side is what pumps the underlying reader.
      }
    })();

    push(`data: ${JSON.stringify(envelope('/sandbox/project', 'evt-real'))}\n\n`);
    push('data: {"payload":{"id":"hb","type":"server.heartbeat","properties":{}}}\n\n');

    await expect.poll(() => received.length, { timeout: 2_000 })
      .toBeGreaterThanOrEqual(2);
    // The RAW envelope reaches the bus, directory wrapper intact — that is
    // what the fail-closed mobile project filter requires.
    expect(received[0]).toMatchObject({ directory: '/sandbox/project' });
    // The bridge swallows heartbeats; the bus must not.
    expect(JSON.stringify(received)).toContain('server.heartbeat');

    stop();
    await drain;
    await collecting;
    // Stream ended → producer no longer live → phones fall back.
    expect(globalEventProducerLive()).toBe(false);
  });
});
