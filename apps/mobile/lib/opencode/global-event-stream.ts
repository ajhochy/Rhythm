/**
 * Native SSE consumer for the OpenCode global event stream.
 *
 * React Native's built-in `fetch` is XHR-backed: it resolves only after the
 * whole response completes, so an infinite `text/event-stream` body never
 * yields a single byte to the generated SDK's stream reader. On device the
 * SDK subscription therefore hangs forever without erroring (issue #1287).
 *
 * `expo/fetch` implements WinterCG streaming, so this module owns the SSE
 * request + frame parsing for native platforms. Web keeps the generated SDK
 * path, which streams correctly in browsers.
 */
import { fetch as expoStreamingFetch } from 'expo/fetch';

import type { PairedMacClient } from '@/lib/transport/paired-mac-client';
import { withProjectScope } from '@/lib/transport/project-scoped-request';
import type { FetchFn } from '@/lib/transport/types';

export interface GlobalEventEnvelope {
  directory?: string;
  payload?: unknown;
}

interface SseResponseLike {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}

export async function* readSseEnvelopes(
  response: SseResponseLike,
  signal: AbortSignal,
): AsyncGenerator<GlobalEventEnvelope> {
  if (!response.ok) {
    throw new Error(`OpenCode event stream failed (${response.status}).`);
  }
  if (!response.body) {
    throw new Error('OpenCode event stream returned no body.');
  }
  const reader = response.body.getReader();
  const cancelReader = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancelReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
        const dataLines = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          yield parsed as GlobalEventEnvelope;
        }
      }
    }
  } finally {
    signal.removeEventListener('abort', cancelReader);
    cancelReader();
    reader.releaseLock();
  }
}

/**
 * Stream authenticated gateway events for the paired-Mac transport. The
 * device token is applied by `PairedMacClient`; only the streaming fetch
 * implementation is swapped in.
 */
export async function* streamPairedGlobalEvents(
  client: PairedMacClient,
  projectId: string,
  signal: AbortSignal,
  fetchFn: FetchFn = expoStreamingFetch as unknown as FetchFn,
): AsyncGenerator<GlobalEventEnvelope> {
  const response = await client.fetchResponse(
    '/mobile-gateway/events',
    withProjectScope(projectId, {
      headers: { Accept: 'text/event-stream' },
      method: 'GET',
      signal,
    }),
    fetchFn,
  );
  yield* readSseEnvelopes(response as SseResponseLike, signal);
}

/**
 * Stream `/global/event` from a directly-connected OpenCode server.
 */
export async function* streamDirectGlobalEvents(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetchFn: FetchFn = expoStreamingFetch as unknown as FetchFn,
): AsyncGenerator<GlobalEventEnvelope> {
  const response = await fetchFn(url, {
    headers: { ...headers, Accept: 'text/event-stream' },
    method: 'GET',
    signal,
  });
  yield* readSseEnvelopes(response as SseResponseLike, signal);
}
