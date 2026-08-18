import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { MobileSseProxy } from '../services/mobile_sse_proxy';

/**
 * #1378 — the SSE proxy's scope-validation pre-check had no timeout at all and
 * collapsed every non-OK answer into a hard 502. Mirror the request proxy:
 * transient answer or abort → 504, connection failure → 502 UNAVAILABLE.
 */

function responseSink() {
  const stream = new PassThrough() as PassThrough & {
    statusCode: number;
    headers: Record<string, string>;
    setHeader(name: string, value: string): void;
    flushHeaders(): void;
  };
  stream.statusCode = 200;
  stream.headers = {};
  stream.setHeader = (name, value) => {
    stream.headers[name.toLowerCase()] = value;
  };
  stream.flushHeaders = vi.fn();
  return stream;
}

/** Denies the explicit-ownership fast path so the pre-check fetch is reached. */
const denyingOwnership = {
  isResourceOwnedBy: () => false,
  isResourceExplicitlyOwnedBy: () => false,
  claimResource: () => false,
  releaseResource: () => undefined,
};

function streamWith(options: Record<string, unknown>) {
  const proxy = new MobileSseProxy({
    ownershipRepository: denyingOwnership,
    ...options,
  });
  return proxy.stream({
    request: new EventEmitter() as never,
    response: responseSink() as never,
    project: { id: 'project-1378', root: '/sandbox/project' },
    userId: 11,
    sessionId: 'ses_1378',
    isDeviceActive: () => true,
  });
}

describe('#1378 MobileSseProxy scope-check classification', () => {
  it('surfaces a warming engine (503) as a retryable 504', async () => {
    await expect(
      streamWith({
        fetchFn: async () =>
          new Response('{}', {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toMatchObject({ statusCode: 504, code: 'OPENCODE_TIMEOUT' });
  });

  it('still hard-fails a definite non-OK answer (500)', async () => {
    await expect(
      streamWith({
        fetchFn: async () =>
          new Response('{}', {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'OPENCODE_SCOPE_CHECK_FAILED',
    });
  });

  it('bounds a hung pre-check and reports 504 instead of hanging', async () => {
    await expect(
      streamWith({
        scopeCheckTimeoutMs: 20,
        fetchFn: (_input: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), {
                name: 'AbortError',
              }));
            });
          }),
      }),
    ).rejects.toMatchObject({ statusCode: 504, code: 'OPENCODE_TIMEOUT' });
  });

  it('classifies a refused connection as 502 OPENCODE_UNAVAILABLE', async () => {
    await expect(
      streamWith({
        fetchFn: async () => {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ECONNREFUSED' },
          });
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'OPENCODE_UNAVAILABLE',
    });
  });

  it('still 404s a session the caller may not address', async () => {
    await expect(
      streamWith({
        fetchFn: async () =>
          new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
