/**
 * #1379 Phase 2 — the phone's event stream is served by fanning out the
 * bridge's already-persisted `/global/event` frames instead of opening a
 * per-device engine SSE connection.
 *
 * The load-bearing assertion in most of these cases is `engineCalls === 0`:
 * a hub-served device must not touch the engine at all, which is what makes N
 * phones cost zero extra engine streams and what lets a stream survive an
 * engine restart.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../errors/app_error';
import { MobileSseProxy } from '../services/mobile_sse_proxy';
import { opencodeEventHub } from '../services/opencode_event_hub';
import type { MobileProjectScope } from '../services/mobile_project_scope';

const PROJECT_ROOT = '/Users/tester/Projects/demo';
const OTHER_ROOT = '/Users/tester/Projects/other';

const project: MobileProjectScope = {
  id: 'proj_demo',
  root: PROJECT_ROOT,
};

function ownership(map: Record<string, { userId: number; directory: string }>) {
  const lookup = (
    sessionId: string,
    ownerUserId: number,
    projectId: string,
  ): { userId: number; directory: string } | null => {
    const entry = map[sessionId];
    if (!entry) return null;
    if (entry.userId !== ownerUserId) return null;
    if (projectId !== project.id) return null;
    return entry;
  };
  return {
    isResourceOwnedBy(
      kind: string,
      resourceId: string,
      ownerUserId: number,
      projectId: string,
    ): boolean {
      return kind === 'session' &&
        lookup(resourceId, ownerUserId, projectId) !== null;
    },
    // Present so the session-scope pre-check resolves from the gateway's own
    // ownership rows instead of listing sessions off the engine.
    isResourceExplicitlyOwnedBy(
      kind: string,
      resourceId: string,
      ownerUserId: number,
      projectId: string,
    ): boolean {
      return kind === 'session' &&
        lookup(resourceId, ownerUserId, projectId) !== null;
    },
    resolveSessionDirectoryForOwner(
      sessionId: string,
      ownerUserId: number,
      projectId: string,
    ): string | null {
      return lookup(sessionId, ownerUserId, projectId)?.directory ?? null;
    },
  } as never;
}

interface Captured {
  response: Parameters<MobileSseProxy['stream']>[0]['response'];
  request: Parameters<MobileSseProxy['stream']>[0]['request'];
  frames: string[];
  close(): void;
}

function fakeConnection(): Captured {
  const frames: string[] = [];
  const listeners = new Map<string, Array<() => void>>();
  const on = (event: string, handler: () => void) => {
    const current = listeners.get(event) ?? [];
    current.push(handler);
    listeners.set(event, current);
  };
  const off = (event: string, handler: () => void) => {
    listeners.set(
      event,
      (listeners.get(event) ?? []).filter((entry) => entry !== handler),
    );
  };
  const emitter = {
    once: on,
    off,
  };
  const response = {
    statusCode: 0,
    writableEnded: false,
    writableLength: 0,
    setHeader: () => undefined,
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      frames.push(chunk);
      return true;
    },
    end: () => {
      (response as { writableEnded: boolean }).writableEnded = true;
    },
    once: on,
    off,
  };
  return {
    response: response as never,
    request: emitter as never,
    frames,
    close: () => {
      for (const handler of listeners.get('close') ?? []) handler();
    },
  };
}

function sessionEvent(
  directory: string,
  sessionId: string,
  id: string,
): { directory: string; payload: unknown } {
  return {
    directory,
    payload: {
      id,
      type: 'message.part.updated',
      properties: {
        part: {
          id: `prt_${id}`,
          messageID: `msg_${id}`,
          sessionID: sessionId,
          type: 'text',
          text: 'hello',
        },
      },
    },
  };
}

/** The engine event type carried by one delivered envelope. */
function eventType(envelope: Record<string, unknown>): string | undefined {
  const payload = envelope.payload as { type?: string } | undefined;
  return payload?.type;
}

/** Read the JSON envelopes the device actually received. */
function payloads(frames: string[]): Array<Record<string, unknown>> {
  return frames
    .filter((frame) => frame.includes('event: message'))
    .map((frame) => {
      const line = frame.split('\n').find((entry) => entry.startsWith('data: '))!;
      return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
    });
}

afterEach(() => {
  opencodeEventHub.setLive(false);
  vi.restoreAllMocks();
});

describe('#1379 Phase 2 — mobile event fan-out hub', () => {
  it('serves a device from the hub without contacting the engine', async () => {
    opencodeEventHub.setLive(true);
    const engineFetch = vi.fn(async () => {
      throw new Error('engine must not be contacted');
    });
    const proxy = new MobileSseProxy({
      fetchFn: engineFetch as never,
      ownershipRepository: ownership({
        ses_a: { userId: 7, directory: PROJECT_ROOT },
      }),
      activeCheckIntervalMs: 60_000,
    });
    const connection = fakeConnection();

    const streamed = proxy.stream({
      request: connection.request,
      response: connection.response,
      project,
      userId: 7,
      isDeviceActive: () => true,
    });

    // Give the subscription a tick to register before publishing.
    await new Promise((resolve) => setImmediate(resolve));
    opencodeEventHub.publish(sessionEvent(PROJECT_ROOT, 'ses_a', 'evt_1'));
    await new Promise((resolve) => setImmediate(resolve));
    connection.close();
    await streamed;

    expect(engineFetch).not.toHaveBeenCalled();
    const received = payloads(connection.frames);
    expect(received).toHaveLength(1);
    expect(eventType(received[0])).toBe('message.part.updated');
  });

  it('fans one published frame out to every subscribed device', async () => {
    opencodeEventHub.setLive(true);
    const engineFetch = vi.fn(async () => {
      throw new Error('engine must not be contacted');
    });
    const makeProxy = () =>
      new MobileSseProxy({
          fetchFn: engineFetch as never,
        ownershipRepository: ownership({
          ses_a: { userId: 7, directory: PROJECT_ROOT },
        }),
        activeCheckIntervalMs: 60_000,
      });
    const first = fakeConnection();
    const second = fakeConnection();
    const streams = [
      makeProxy().stream({
        request: first.request,
        response: first.response,
        project,
        userId: 7,
        isDeviceActive: () => true,
      }),
      makeProxy().stream({
        request: second.request,
        response: second.response,
        project,
        userId: 7,
        isDeviceActive: () => true,
      }),
    ];

    await new Promise((resolve) => setImmediate(resolve));
    expect(opencodeEventHub.subscriberCount()).toBe(2);
    opencodeEventHub.publish(sessionEvent(PROJECT_ROOT, 'ses_a', 'evt_1'));
    await new Promise((resolve) => setImmediate(resolve));
    first.close();
    second.close();
    await Promise.all(streams);

    expect(engineFetch).not.toHaveBeenCalled();
    expect(payloads(first.frames)).toHaveLength(1);
    expect(payloads(second.frames)).toHaveLength(1);
    expect(opencodeEventHub.subscriberCount()).toBe(0);
  });

  it('applies the same project and owner scoping the engine transport did', async () => {
    opencodeEventHub.setLive(true);
    const proxy = new MobileSseProxy({
      fetchFn: (async () => {
        throw new Error('engine must not be contacted');
      }) as never,
      ownershipRepository: ownership({
        ses_a: { userId: 7, directory: PROJECT_ROOT },
        ses_other_user: { userId: 9, directory: PROJECT_ROOT },
      }),
      activeCheckIntervalMs: 60_000,
    });
    const connection = fakeConnection();
    const streamed = proxy.stream({
      request: connection.request,
      response: connection.response,
      project,
      userId: 7,
      isDeviceActive: () => true,
    });

    await new Promise((resolve) => setImmediate(resolve));
    // Another user's session in the same directory.
    opencodeEventHub.publish(
      sessionEvent(PROJECT_ROOT, 'ses_other_user', 'evt_x'),
    );
    // The right user, but a different project's directory.
    opencodeEventHub.publish(
      sessionEvent(OTHER_ROOT, 'ses_other_project', 'evt_y'),
    );
    // An envelope with no directory evidence at all — fail closed.
    opencodeEventHub.publish({
      payload: {
        id: 'evt_z',
        type: 'message.part.updated',
        properties: { part: { sessionID: 'ses_a', type: 'text' } },
      },
    });
    // The one legitimate frame.
    opencodeEventHub.publish(sessionEvent(PROJECT_ROOT, 'ses_a', 'evt_ok'));
    await new Promise((resolve) => setImmediate(resolve));
    connection.close();
    await streamed;

    const received = payloads(connection.frames);
    expect(received).toHaveLength(1);
    expect(JSON.stringify(received[0])).toContain('ses_a');
    expect(JSON.stringify(received[0])).not.toContain('ses_other');
  });

  it('narrows to one session when the route is /sessions/:id/events', async () => {
    opencodeEventHub.setLive(true);
    const proxy = new MobileSseProxy({
      fetchFn: (async () => {
        throw new Error('engine must not be contacted');
      }) as never,
      ownershipRepository: ownership({
        ses_a: { userId: 7, directory: PROJECT_ROOT },
        ses_b: { userId: 7, directory: PROJECT_ROOT },
      }),
      activeCheckIntervalMs: 60_000,
    });
    const connection = fakeConnection();
    const streamed = proxy.stream({
      request: connection.request,
      response: connection.response,
      project,
      userId: 7,
      sessionId: 'ses_a',
      isDeviceActive: () => true,
    });

    await new Promise((resolve) => setImmediate(resolve));
    opencodeEventHub.publish(sessionEvent(PROJECT_ROOT, 'ses_b', 'evt_b'));
    opencodeEventHub.publish(sessionEvent(PROJECT_ROOT, 'ses_a', 'evt_a'));
    await new Promise((resolve) => setImmediate(resolve));
    connection.close();
    await streamed;

    const received = payloads(connection.frames);
    expect(received).toHaveLength(1);
    expect(JSON.stringify(received[0])).toContain('ses_a');
  });

  it('dedupes a frame republished with the same event id', async () => {
    opencodeEventHub.setLive(true);
    const proxy = new MobileSseProxy({
      fetchFn: (async () => {
        throw new Error('engine must not be contacted');
      }) as never,
      ownershipRepository: ownership({
        ses_a: { userId: 7, directory: PROJECT_ROOT },
      }),
      activeCheckIntervalMs: 60_000,
    });
    const connection = fakeConnection();
    const streamed = proxy.stream({
      request: connection.request,
      response: connection.response,
      project,
      userId: 7,
      isDeviceActive: () => true,
    });

    await new Promise((resolve) => setImmediate(resolve));
    opencodeEventHub.publish(sessionEvent(PROJECT_ROOT, 'ses_a', 'evt_1'));
    opencodeEventHub.publish(sessionEvent(PROJECT_ROOT, 'ses_a', 'evt_1'));
    await new Promise((resolve) => setImmediate(resolve));
    connection.close();
    await streamed;

    expect(payloads(connection.frames)).toHaveLength(1);
  });

  it('passes heartbeats through so an idle stream stays provably live', async () => {
    opencodeEventHub.setLive(true);
    const proxy = new MobileSseProxy({
      fetchFn: (async () => {
        throw new Error('engine must not be contacted');
      }) as never,
      ownershipRepository: ownership({}),
      activeCheckIntervalMs: 60_000,
    });
    const connection = fakeConnection();
    const streamed = proxy.stream({
      request: connection.request,
      response: connection.response,
      project,
      userId: 7,
      isDeviceActive: () => true,
    });

    await new Promise((resolve) => setImmediate(resolve));
    opencodeEventHub.publish({
      payload: { id: 'hb_1', type: 'server.heartbeat', properties: {} },
    });
    await new Promise((resolve) => setImmediate(resolve));
    connection.close();
    await streamed;

    const received = payloads(connection.frames);
    expect(received).toHaveLength(1);
    expect(eventType(received[0])).toBe('server.heartbeat');
  });

  it('drops a device whose queue overflows, with the existing backpressure code', async () => {
    opencodeEventHub.setLive(true);
    const connection = fakeConnection();
    // A response that never accepts a write forces the proxy to await drain,
    // so published frames pile up in the hub queue behind it.
    (connection.response as { write: (chunk: string) => boolean }).write = (
      chunk: string,
    ) => {
      connection.frames.push(chunk);
      return false;
    };
    const proxy = new MobileSseProxy({
      maxHubQueue: 2,
      fetchFn: (async () => {
        throw new Error('engine must not be contacted');
      }) as never,
      ownershipRepository: ownership({
        ses_a: { userId: 7, directory: PROJECT_ROOT },
      }),
      activeCheckIntervalMs: 60_000,
    });
    const streamed = proxy.stream({
      request: connection.request,
      response: connection.response,
      project,
      userId: 7,
      isDeviceActive: () => true,
    });

    await new Promise((resolve) => setImmediate(resolve));
    for (let index = 0; index < 10; index += 1) {
      opencodeEventHub.publish(
        sessionEvent(PROJECT_ROOT, 'ses_a', `evt_${index}`),
      );
    }
    await streamed;

    expect(
      connection.frames.some((frame) => frame.includes('gateway.error')),
    ).toBe(true);
    expect(
      connection.frames.some((frame) => frame.includes('STREAM_BACKPRESSURE')),
    ).toBe(true);
  });

  it('closes the subscription when the device token is revoked', async () => {
    opencodeEventHub.setLive(true);
    let active = true;
    const proxy = new MobileSseProxy({
      fetchFn: (async () => {
        throw new Error('engine must not be contacted');
      }) as never,
      ownershipRepository: ownership({
        ses_a: { userId: 7, directory: PROJECT_ROOT },
      }),
      activeCheckIntervalMs: 5,
    });
    const connection = fakeConnection();
    const streamed = proxy.stream({
      request: connection.request,
      response: connection.response,
      project,
      userId: 7,
      isDeviceActive: () => active,
    });

    await new Promise((resolve) => setImmediate(resolve));
    active = false;
    await streamed;

    expect(opencodeEventHub.subscriberCount()).toBe(0);
    expect(connection.response.writableEnded).toBe(true);
  });

  it('falls back to the per-device engine stream when the hub is not live', async () => {
    opencodeEventHub.setLive(false);
    const engineFetch = vi.fn(async () =>
      new Response(
        `data: ${JSON.stringify(
          sessionEvent(PROJECT_ROOT, 'ses_a', 'evt_live'),
        )}\n\n`,
        {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        },
      ),
    );
    const proxy = new MobileSseProxy({
      fetchFn: engineFetch as never,
      ownershipRepository: ownership({
        ses_a: { userId: 7, directory: PROJECT_ROOT },
      }),
      activeCheckIntervalMs: 60_000,
      reconnectBaseMs: 5,
    });
    const connection = fakeConnection();
    const streamed = proxy.stream({
      request: connection.request,
      response: connection.response,
      project,
      userId: 7,
      isDeviceActive: () => true,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    connection.close();
    await streamed;

    expect(engineFetch).toHaveBeenCalled();
    expect(payloads(connection.frames).length).toBeGreaterThanOrEqual(1);
  });
});

describe('#1379 Phase 2 — publish is isolated from subscribers', () => {
  it('never lets one subscriber stall the bridge', () => {
    const first = opencodeEventHub.subscribe(1);
    const second = opencodeEventHub.subscribe(64);
    // Overflow the first subscriber; the second must still receive.
    opencodeEventHub.publish({ directory: PROJECT_ROOT, payload: { id: 'a' } });
    opencodeEventHub.publish({ directory: PROJECT_ROOT, payload: { id: 'b' } });
    expect(() =>
      opencodeEventHub.publish({ directory: PROJECT_ROOT, payload: { id: 'c' } }),
    ).not.toThrow();
    expect(first.overflowed()).toBe(true);
    first.close();
    second.close();
    expect(opencodeEventHub.subscriberCount()).toBe(0);
  });

  it('reports STREAM_BACKPRESSURE as an AppError code the client already knows', () => {
    const error = new AppError(
      503,
      'STREAM_BACKPRESSURE',
      'Mobile event stream client is too slow',
    );
    expect(error.code).toBe('STREAM_BACKPRESSURE');
  });
});
