import type { Request, Response } from 'express';

import { AppError } from '../errors/app_error';
import type {
  MobileOpenCodeOwnershipReader,
} from '../repositories/mobile_opencode_ownership_repository';
import { logger } from '../utils/logger';
import {
  getMobileOpenCodeOwnershipRepository,
} from './mobile_opencode_ownership_runtime';
import { OPENCODE_ENGINE_PORT } from './opencode_client_service';
import {
  opencodeEventHub,
  type HubSubscription,
  type OpencodeEventHub,
} from './opencode_event_hub';
import type { MobileProjectScope } from './mobile_project_scope';
import {
  mobileSseEventBelongsToOwner,
  mobileSessionBelongsToProject,
  shapeMobileSseEvent,
  type MobileOpenCodeOwnerScope,
  type MobileOpenCodeJsonFetcher,
} from './mobile_opencode_security';
import {
  mobileScopeCheckStatusFailure,
  mobileScopeCheckThrownFailure,
} from './mobile_upstream_failure';

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
  /** Budget for the one-shot scope-validation pre-check (#1378). */
  scopeCheckTimeoutMs?: number;
  ownershipRepository?: MobileOpenCodeOwnershipReader;
  /**
   * #1379 Phase 2 — max envelopes this device may have queued in the fan-out
   * hub before it is treated as too slow (`STREAM_BACKPRESSURE`).
   */
  maxHubQueue?: number;
  /**
   * Relay support (docs/ai/plan-synology-relay.md): the hub to serve from.
   * Defaults to the module singleton the Mac bridge feeds; the Synology relay
   * passes its own uplink-fed instance.
   */
  hub?: OpencodeEventHub;
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
  userId: number;
  sessionId?: string;
  isDeviceActive: () => boolean;
}

const DEFAULT_MAX_FRAME_BYTES = 256 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 512 * 1024;
const DEFAULT_MAX_DEDUPE_ENTRIES = 2_048;
const DEFAULT_SCOPE_CHECK_TIMEOUT_MS = 30_000;

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

function fatalStreamError(error: unknown): error is AppError {
  return error instanceof AppError && (
    error.code === 'UPSTREAM_STREAM_TOO_LARGE' ||
    error.code === 'UPSTREAM_EVENT_TOO_LARGE' ||
    error.code === 'STREAM_BACKPRESSURE'
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

function matchesSession(value: unknown, sessionId: string): boolean {
  if (isCommonServerEvent(value)) return true;
  const ids = new Set<string>();
  collectSessionIds(value, ids);
  if (
    typeof value === 'object' &&
    value !== null &&
    streamEventType(value)?.startsWith('session.')
  ) {
    const record = value as Record<string, unknown>;
    const payload =
      typeof record.payload === 'object' && record.payload !== null
        ? record.payload as Record<string, unknown>
        : record;
    const properties =
      typeof payload.properties === 'object' && payload.properties !== null
        ? payload.properties as Record<string, unknown>
        : null;
    const info =
      typeof properties?.info === 'object' && properties.info !== null
        ? properties.info as Record<string, unknown>
        : null;
    if (typeof info?.id === 'string') ids.add(info.id);
  }
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

async function boundedJson(
  response: globalThis.Response,
  maxBytes: number,
): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new AppError(
      502,
      'UPSTREAM_RESPONSE_TOO_LARGE',
      'OpenCode scope response exceeded the mobile gateway limit',
    );
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError(
          502,
          'UPSTREAM_RESPONSE_TOO_LARGE',
          'OpenCode scope response exceeded the mobile gateway limit',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(
      502,
      'OPENCODE_SCOPE_CHECK_FAILED',
      'OpenCode returned an invalid mobile resource response',
    );
  }
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
  private readonly maxHubQueue: number;
  private readonly scopeCheckTimeoutMs: number;
  private readonly hub: OpencodeEventHub;
  private readonly configuredOwnershipRepository?:
    MobileOpenCodeOwnershipReader;

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
    this.hub = options.hub ?? opencodeEventHub;
    this.maxHubQueue = options.maxHubQueue ?? 512;
    this.scopeCheckTimeoutMs =
      options.scopeCheckTimeoutMs ?? DEFAULT_SCOPE_CHECK_TIMEOUT_MS;
    this.configuredOwnershipRepository = options.ownershipRepository;
  }

  async stream(input: MobileSseStreamInput): Promise<void> {
    if (!deviceIsActive(input.isDeviceActive)) throw unauthorized();
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
      throw unauthorized();
    }
    const owner = {
      ownerUserId: input.userId,
      ownership: this.configuredOwnershipRepository ??
        getMobileOpenCodeOwnershipRepository(),
    };
    if (
      input.sessionId !== undefined &&
      !/^[A-Za-z0-9_-]{1,256}$/.test(input.sessionId)
    ) {
      throw AppError.badRequest('Invalid session id');
    }
    if (input.sessionId) {
      // #1378: a cold/busy engine must read as transient (504), never as a
      // hard 502. Bound the pre-check so a hung engine surfaces a timeout
      // instead of holding the SSE request open indefinitely.
      const controller = new AbortController();
      const scopeTimeout = setTimeout(
        () => controller.abort(),
        this.scopeCheckTimeoutMs,
      );
      const fetchJson: MobileOpenCodeJsonFetcher = async (path) => {
        const query = new URLSearchParams({
          directory: input.project.root,
        });
        let response: globalThis.Response;
        try {
          response = await this.fetchFn(
            `${this.baseUrl}${path}?${query.toString()}`,
            {
              headers: { Accept: 'application/json' },
              method: 'GET',
              redirect: 'error',
              signal: controller.signal,
            },
          );
        } catch (error) {
          throw mobileScopeCheckThrownFailure(
            controller.signal.aborted
              ? Object.assign(new Error('aborted'), { name: 'AbortError' })
              : error,
            'MobileSseProxy',
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw mobileScopeCheckStatusFailure(
            response.status,
            'MobileSseProxy',
          );
        }
        return boundedJson(response, this.maxBufferedBytes);
      };
      try {
        if (
          !await mobileSessionBelongsToProject(
            input.sessionId,
            input.project,
            fetchJson,
            owner,
          )
        ) {
          throw AppError.notFound('Mobile OpenCode resource');
        }
      } catch (error) {
        throw mobileScopeCheckThrownFailure(error, 'MobileSseProxy');
      } finally {
        clearTimeout(scopeTimeout);
      }
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

    // #1379 Phase 2 — prefer the api_server's own fan-out of the consolidated
    // `/global/event` stream over dialing the engine per device. The frames are
    // identical (the bridge republishes the same envelopes, after persisting
    // them), but N phones now cost zero extra engine connections and a phone no
    // longer blocks on engine liveness to open its stream.
    let hub: HubSubscription | null = null;
    if (this.hub.isLive() && !closed) {
      hub = this.hub.subscribe(this.maxHubQueue);
    }
    if (hub) {
      const subscription = hub;
      controller.signal.addEventListener(
        'abort',
        () => subscription.close(),
        { once: true },
      );
      try {
        await this.consumeHub(
          subscription,
          input,
          owner,
          controller.signal,
          seen,
          seenOrder,
        );
      } catch (error) {
        if (fatalStreamError(error)) this.writeGatewayError(input, error);
      } finally {
        subscription.close();
        clearInterval(activeTimer);
        controller.abort();
        input.request.off('close', close);
        input.response.off('close', close);
        seen.clear();
        seenOrder.length = 0;
        if (!input.response.writableEnded) input.response.end();
      }
      return;
    }

    try {
      while (!closed) {
        if (!deviceIsActive(input.isDeviceActive)) break;
        // `/event` emits unwrapped payloads, so it lacks the authoritative
        // directory evidence required by the fail-closed mobile project
        // filter. `/global/event` wraps every non-server event with its source
        // directory; the filters below then narrow it to the selected project,
        // owner, and optional session.
        const query = new URLSearchParams();
        const path = '/global/event';
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
            if (!upstream.ok) {
              logger.warn(
                `[MobileSseProxy] event stream rejected with upstream status ${upstream.status}`,
              );
            }
            await upstream.body?.cancel();
            throw new Error('OpenCode event stream unavailable');
          }

          const delivered = await this.consume(
            upstream,
            input,
            owner,
            controller.signal,
            seen,
            seenOrder,
          );
          if (delivered) reconnectMs = this.reconnectBaseMs;
        } catch (error) {
          if (closed || controller.signal.aborted) break;
          if (fatalStreamError(error)) {
            this.writeGatewayError(input, error);
            close();
            break;
          }
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

  /**
   * Emit the terminal `gateway.error` frame for a fatal stream condition.
   * Shared by both transports so a hub-served device sees exactly the same
   * failure envelope a per-device engine stream would have produced.
   */
  private writeGatewayError(
    input: MobileSseStreamInput,
    error: AppError,
  ): void {
    const encoded =
      'event: gateway.error\n' +
      `data: ${JSON.stringify({
        type: 'gateway.error',
        properties: { code: error.code },
      })}\n\n`;
    if (
      input.response.writableEnded ||
      input.response.writableLength + Buffer.byteLength(encoded, 'utf8') >
        this.maxBufferedBytes
    ) {
      return;
    }
    try {
      input.response.write(encoded);
    } catch {
      // The downstream socket is already unusable; the caller's cleanup still
      // aborts the upstream and releases retained state.
    }
  }

  /**
   * #1379 Phase 2 — drain the fan-out hub for one device. Every filter the
   * per-device engine transport applied is applied here unchanged: owner +
   * project scoping, optional session narrowing, event-id dedupe, host-path
   * shaping, frame/buffer size limits, and backpressure.
   */
  private async consumeHub(
    subscription: HubSubscription,
    input: MobileSseStreamInput,
    owner: MobileOpenCodeOwnerScope,
    signal: AbortSignal,
    seen: Set<string>,
    seenOrder: string[],
  ): Promise<void> {
    for await (const envelope of subscription.stream) {
      if (signal.aborted) break;
      if (!deviceIsActive(input.isDeviceActive)) break;
      await this.deliver(
        envelope as unknown,
        null,
        input,
        owner,
        signal,
        seen,
        seenOrder,
      );
    }
    if (subscription.overflowed()) {
      throw new AppError(
        503,
        'STREAM_BACKPRESSURE',
        'Mobile event stream client is too slow',
      );
    }
  }

  /**
   * Filter, shape and write one event. Returns whether it reached the client.
   * Both transports funnel through here so neither can drift from the other's
   * security posture.
   */
  private async deliver(
    parsed: unknown,
    frameId: string | null,
    input: MobileSseStreamInput,
    owner: MobileOpenCodeOwnerScope,
    signal: AbortSignal,
    seen: Set<string>,
    seenOrder: string[],
  ): Promise<boolean> {
    const matches = mobileSseEventBelongsToOwner(
        parsed,
        input.project,
        owner,
        input.sessionId,
      ) &&
      (input.sessionId ? matchesSession(parsed, input.sessionId) : true);
    if (!matches) return false;

    const id = frameId || streamEventId(parsed);
    if (id && seen.has(id)) return false;
    if (id) {
      seen.add(id);
      seenOrder.push(id);
      while (seenOrder.length > this.maxDedupeEntries) {
        seen.delete(seenOrder.shift()!);
      }
    }
    const mobilePayload = shapeMobileSseEvent(parsed, input.project);
    const encoded = `${
      id ? `id: ${id}\n` : ''
    }event: message\ndata: ${JSON.stringify(mobilePayload)}\n\n`;
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
    if (!input.response.write(encoded)) {
      const drained = await waitForDrain(input.response, signal);
      if (!drained) {
        if (signal.aborted || input.response.writableEnded) return true;
        throw new AppError(
          503,
          'STREAM_BACKPRESSURE',
          'Mobile event stream drain timed out',
        );
      }
    }
    return true;
  }

  private async consume(
    upstream: globalThis.Response,
    input: MobileSseStreamInput,
    owner: MobileOpenCodeOwnerScope,
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
          if (
            await this.deliver(
              parsed,
              frame.id,
              input,
              owner,
              signal,
              seen,
              seenOrder,
            )
          ) {
            delivered = true;
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
