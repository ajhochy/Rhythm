/**
 * issue-1287: native SSE consumer regression.
 *
 * React Native's XHR-backed fetch never delivers streaming SSE bytes, which
 * froze live updates on physical devices (desktop→mobile and streamed
 * assistant turns). These tests drive the client-side stream consumer with a
 * real ReadableStream, proving gateway-shaped frames — including projectless
 * desktop chat events whose directory is the pseudonymous project id — cross
 * the client parse boundary.
 */
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

import {
  readSseEnvelopes,
  streamDirectGlobalEvents,
} from '@/lib/opencode/global-event-stream';

function sseResponse(frames: string[], status = 200) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index]));
        index += 1;
      } else {
        controller.close();
      }
    },
  });
  return { ok: status < 400, status, body };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe('readSseEnvelopes', () => {
  it('parses gateway-shaped frames, including chunks split across reads', async () => {
    const projectId = 'project-uuid-1';
    const desktopTurn = JSON.stringify({
      directory: projectId,
      payload: {
        type: 'message.updated',
        properties: { sessionID: 'ses_desktop', info: { id: 'msg_1' } },
      },
    });
    const frames = [
      'id: evt_1\nevent: message\ndata: {"payload":{"type":"server.connected","properties":{}}}\n\n',
      `id: evt_2\nevent: message\ndata: ${desktopTurn.slice(0, 40)}`,
      `${desktopTurn.slice(40)}\n\n: keep-alive comment\n\n`,
    ];
    const controller = new AbortController();
    const envelopes = await collect(
      readSseEnvelopes(sseResponse(frames), controller.signal),
    );

    expect(envelopes).toHaveLength(2);
    expect((envelopes[0].payload as { type: string }).type).toBe('server.connected');
    expect(envelopes[1].directory).toBe(projectId);
    expect((envelopes[1].payload as { type: string }).type).toBe('message.updated');
  });

  it('throws when the stream has no readable body (XHR-fetch regression)', async () => {
    const controller = new AbortController();
    await expect(
      collect(readSseEnvelopes({ ok: true, status: 200, body: null }, controller.signal)),
    ).rejects.toThrow('no body');
  });

  it('throws on a non-2xx response', async () => {
    const controller = new AbortController();
    await expect(
      collect(readSseEnvelopes(sseResponse([], 502), controller.signal)),
    ).rejects.toThrow('502');
  });

  it('stops yielding after abort', async () => {
    const encoder = new TextEncoder();
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      pull(streamController) {
        streamController.enqueue(
          encoder.encode('data: {"payload":{"type":"server.heartbeat"}}\n\n'),
        );
      },
    });
    const stream = readSseEnvelopes({ ok: true, status: 200, body }, controller.signal);
    const first = await stream.next();
    expect(first.done).toBe(false);
    controller.abort();
    const rest = await collect(stream as AsyncIterable<unknown>);
    expect(rest.length).toBeLessThanOrEqual(1);
  });
});

describe('streamDirectGlobalEvents', () => {
  it('requests the event URL with SSE headers and yields envelopes', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return sseResponse([
        'data: {"directory":"/tmp/projectless","payload":{"type":"session.status","properties":{"sessionID":"ses_1","status":{"type":"working"}}}}\n\n',
      ]) as unknown as Response;
    };
    const controller = new AbortController();
    const envelopes = await collect(
      streamDirectGlobalEvents(
        'http://127.0.0.1:4096/global/event',
        { Authorization: 'Basic abc' },
        controller.signal,
        fetchFn,
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:4096/global/event');
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe('text/event-stream');
    expect(envelopes).toHaveLength(1);
    expect((envelopes[0].payload as { type: string }).type).toBe('session.status');
  });
});
