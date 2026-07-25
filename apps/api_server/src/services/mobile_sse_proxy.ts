import type { Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import { OPENCODE_ENGINE_PORT } from './opencode_client_service';
import type { MobileProjectScope } from './mobile_project_scope';

type FetchFn = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<globalThis.Response>;

export interface MobileSseProxyOptions {
  baseUrl?: string;
  fetchFn?: FetchFn;
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  maxDedupeEntries?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  activeCheckIntervalMs?: number;
}

export interface MobileSseStreamInput {
  request: Pick<Request, 'once' | 'off'>;
  response: Pick<
    Response,
    | 'statusCode'
    | 'setHeader'
    | 'flushHeaders'
    | 'write'
    | 'end'
    | 'once'
    | 'off'
    | 'writableEnded'
    | 'writableLength'
  >;
  project: MobileProjectScope;
  sessionId?: string;
  isDeviceActive: () => boolean;
}

const DEFAULT_MAX_FRAME_BYTES = 256 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 512 * 1024;
const DEFAULT_MAX_DEDUPE_ENTRIES = 2_048;

function unauthorized(): AppError {
  return AppError.unauthorized('Invalid or revoked device token');
}

function deviceIsActive(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function abortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) || (
    error instanceof Error &&
    error.name === 'AbortError'
  );
}

function streamEventType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const payload = typeof record.payload === 'object' && record.payload !== null
    ? record.payload as Record<string, unknown>
    : record;
  return typeof payload.type === 'string' ? payload.type : null;
}

function streamEventId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const payload = typeof record.payload === 'object' && record.payload !== null
    ? record.payload as Record<string, unknown>
    : record;
  return typeof payload.id === 'string' && payload.id.length <= 256
    ? payload.id
    : null;
}

function collectSessionIds(
  value: unknown,
  ids: Set<string>,
  depth = 0,
): void {
  if (depth > 5 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const child of value) collectSessionIds(child, ids, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      (key === 'sessionID' || key === 'sessionId') &&
      typeof child === 'string'
    ) {
      ids.add(child);
      continue;
    }
    collectSessionIds(child, ids, depth + 1);
  }
}

function isCommonServerEvent(value: unknown): boolean {
  const type = streamEventType(value);
  return type === 'server.connected' || type === 'server.heartbeat';
}

function matchesProject(
  value: unknown,
  project: MobileProjectScope,
): boolean {
  if (isCommonServerEvent(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  return (value as Record<string, unknown>).directory === project.root;
}

function matchesSession(value: unknown, sessionId: string): boolean {
  if (isCommonServerEvent(value)) return true;
  const ids = new Set<string>();
  collectSessionIds(value, ids);
  return ids.has(sessionId);
}

function parseSseFrame(frame: string): {
  id: string | null;
  data: string | null;
} {
  let id: string | null = null;
  const data: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (rawLine.startsWith('id:')) id = rawLine.slice(3).trimStart();
    if (rawLine.startsWith('data:')) data.push(rawLine.slice(5).trimStart());
  }
  return { id, data: data.length > 0 ? data.join('\n') : null };
}

function frameBoundary(buffer: string): {
  index: number;
  length: number;
} | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match?.index === undefined
    ? null
    : { index: match.index, length: match[0].length };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => done();
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForDrain(
  response: MobileSseStreamInput['response'],
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), 5_000);
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    const onAbort = () => finish(false);
    function finish(value: boolean): void {
      clearTimeout(timer);
      response.off('drain', onDrain);
      response.off('close', onClose);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }
    response.once('drain', onDrain);
    response.once('close', onClose);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Authenticated, project-scoped bridge from OpenCode SSE to a mobile client.
 * The bridge reconnects its upstream stream in-place so the caller keeps one
 * downstream connection, and it retains only a bounded LRU of event IDs.
 */
export class MobileSseProxy {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly maxFrameBytes: number;
  private readonly maxBufferedBytes: number;
  private readonly maxDedupeEntries: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly activeCheckIntervalMs: number;

  constructor(options: MobileSseProxyOptions = {}) {
    this.baseUrl = (
      options.baseUrl ?? `http://127.0.0.1:${OPENCODE_ENGINE_PORT}`
    ).replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxFrameBytes =
      options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.maxBufferedBytes =
      options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.maxDedupeEntries =
      options.maxDedupeEntries ?? DEFAULT_MAX_DEDUPE_ENTRIES;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 250;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 15_000;
    this.activeCheckIntervalMs = options.activeCheckIntervalMs ?? 1_000;
  }

  async stream(input: MobileSseStreamInput): Promise<void> {
    if (!deviceIsActive(input.isDeviceActive)) throw unauthorized();
    if (
      input.sessionId !== undefined &&
      !/^[A-Za-z0-9_-]{1,256}$/.test(input.sessionId)
    ) {
      throw AppError.badRequest('Invalid session id');
    }

    input.response.statusCode = 200;
    input.response.setHeader('Content-Type', 'text/event-stream');
    input.response.setHeader('Cache-Control', 'no-cache, no-transform');
    input.response.setHeader('Connection', 'keep-alive');
    input.response.setHeader('X-Accel-Buffering', 'no');
    input.response.setHeader('X-Content-Type-Options', 'nosniff');
    input.response.flushHeaders?.();

    const controller = new AbortController();
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      controller.abort();
    };
    input.request.once('close', close);
    input.response.once('close', close);
    const activeTimer = setInterval(() => {
      if (!deviceIsActive(input.isDeviceActive)) close();
    }, this.activeCheckIntervalMs);
    activeTimer.unref();

    const seen = new Set<string>();
    const seenOrder: string[] = [];
    let reconnectMs = this.reconnectBaseMs;
    try {
      while (!closed) {
        if (!deviceIsActive(input.isDeviceActive)) break;
        const query = new URLSearchParams();
        const path = input.sessionId ? '/event' : '/global/event';
        if (input.sessionId) query.set('directory', input.project.root);
        const url = `${this.baseUrl}${path}${
          query.size > 0 ? `?${query.toString()}` : ''
        }`;
        try {
          const upstream = await this.fetchFn(url, {
            headers: { Accept: 'text/event-stream' },
            redirect: 'error',
            signal: controller.signal,
          });
          if (
            !upstream.ok ||
            !upstream.body ||
            !upstream.headers.get('content-type')
              ?.toLowerCase()
              .includes('text/event-stream')
          ) {
            await upstream.body?.cancel();
            throw new Error('OpenCode event stream unavailable');
          }

          const delivered = await this.consume(
            upstream,
            input,
            controller.signal,
            seen,
            seenOrder,
          );
          if (delivered) reconnectMs = this.reconnectBaseMs;
        } catch (error) {
          if (closed || controller.signal.aborted) break;
          if (!abortError(error)) {
            // Deliberately omit error details: upstream errors and URLs can
            // include local paths or connection-ticket material.
          }
        }
        if (closed) break;
        await sleep(reconnectMs, controller.signal);
        reconnectMs = Math.min(reconnectMs * 2, this.reconnectMaxMs);
      }
    } finally {
      clearInterval(activeTimer);
      controller.abort();
      input.request.off('close', close);
      input.response.off('close', close);
      seen.clear();
      seenOrder.length = 0;
      if (!input.response.writableEnded) input.response.end();
    }
  }

  private async consume(
    upstream: globalThis.Response,
    input: MobileSseStreamInput,
    signal: AbortSignal,
    seen: Set<string>,
    seenOrder: string[],
  ): Promise<boolean> {
    const reader = upstream.body!.getReader();
    const cancelReader = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancelReader, { once: true });
    const decoder = new TextDecoder();
    let buffer = '';
    let delivered = false;
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (Buffer.byteLength(buffer, 'utf8') > this.maxBufferedBytes) {
          throw new AppError(
            502,
            'UPSTREAM_STREAM_TOO_LARGE',
            'OpenCode event stream exceeded the mobile gateway buffer',
          );
        }
        let boundary: ReturnType<typeof frameBoundary>;
        while ((boundary = frameBoundary(buffer)) !== null) {
          const rawFrame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          if (Buffer.byteLength(rawFrame, 'utf8') > this.maxFrameBytes) {
            throw new AppError(
              502,
              'UPSTREAM_EVENT_TOO_LARGE',
              'OpenCode event exceeded the mobile gateway limit',
            );
          }
          const frame = parseSseFrame(rawFrame);
          if (!frame.data) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame.data);
          } catch {
            continue;
          }
          const matches = input.sessionId
            ? matchesSession(parsed, input.sessionId)
            : matchesProject(parsed, input.project);
          if (!matches) continue;

          const id = frame.id || streamEventId(parsed);
          if (id && seen.has(id)) continue;
          if (id) {
            seen.add(id);
            seenOrder.push(id);
            while (seenOrder.length > this.maxDedupeEntries) {
              seen.delete(seenOrder.shift()!);
            }
          }
          const encoded = `${
            id ? `id: ${id}\n` : ''
          }event: message\ndata: ${JSON.stringify(parsed)}\n\n`;
          if (
            Buffer.byteLength(encoded, 'utf8') > this.maxFrameBytes ||
            input.response.writableLength > this.maxBufferedBytes
          ) {
            throw new AppError(
              503,
              'STREAM_BACKPRESSURE',
              'Mobile event stream client is too slow',
            );
          }
          delivered = true;
          if (!input.response.write(encoded)) {
            const drained = await waitForDrain(input.response, signal);
            if (!drained) return delivered;
          }
        }
      }
      return delivered;
    } finally {
      signal.removeEventListener('abort', cancelReader);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
