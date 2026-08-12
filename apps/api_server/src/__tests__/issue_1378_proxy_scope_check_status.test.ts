import { describe, expect, it } from 'vitest';

import { AppError } from '../errors/app_error';
import type {
  MobileOpenCodeOwnershipStore,
} from '../repositories/mobile_opencode_ownership_repository';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

/**
 * #1378 — end-to-end through the real proxy: a transient answer from the
 * engine during the scope-validation pre-check must surface as 504, and a
 * definite one must still surface as 502 SCOPE_CHECK_FAILED.
 */

const project = { id: 'project-1378', root: '/tmp/rhythm-1378' };

/** Denies everything, so the pre-check is the only upstream call made. */
const ownership: MobileOpenCodeOwnershipStore = {
  isResourceOwnedBy: () => false,
  isResourceExplicitlyOwnedBy: () => false,
  claimResource: () => true,
  releaseResource: () => false,
};

async function forwardWithUpstreamStatus(status: number): Promise<AppError> {
  const proxy = new MobileOpenCodeProxy({
    baseUrl: 'http://127.0.0.1:65535',
    ownershipRepository: ownership,
    fetchFn: async () =>
      new Response(JSON.stringify({ error: 'nope' }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  });
  try {
    await proxy.forward({
      method: 'GET',
      path: '/session/ses_1378/message',
      query: new URLSearchParams(),
      project,
      userId: 7,
    });
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error(`expected a failure for upstream status ${status}`);
}

describe('#1378 MobileOpenCodeProxy scope-check classification', () => {
  it('surfaces a warming engine (503) as a retryable 504', async () => {
    const error = await forwardWithUpstreamStatus(503);
    expect(error.statusCode).toBe(504);
    expect(error.code).toBe('OPENCODE_TIMEOUT');
  });

  it('surfaces an upstream gateway timeout (504) as 504', async () => {
    const error = await forwardWithUpstreamStatus(504);
    expect(error.statusCode).toBe(504);
    expect(error.code).toBe('OPENCODE_TIMEOUT');
  });

  it('still hard-fails a definite non-OK answer (500)', async () => {
    const error = await forwardWithUpstreamStatus(500);
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('OPENCODE_SCOPE_CHECK_FAILED');
  });

  it('classifies an aborted pre-check as 504, not 502', async () => {
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:65535',
      ownershipRepository: ownership,
      timeoutMs: 20,
      fetchFn: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(
              Object.assign(new Error('aborted'), { name: 'AbortError' }),
            );
          });
        }),
    });
    await expect(
      proxy.forward({
        method: 'GET',
        path: '/session/ses_1378/message',
        query: new URLSearchParams(),
        project,
        userId: 7,
      }),
    ).rejects.toMatchObject({ statusCode: 504, code: 'OPENCODE_TIMEOUT' });
  });

  it('classifies a refused connection as 502 OPENCODE_UNAVAILABLE', async () => {
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:65535',
      ownershipRepository: ownership,
      fetchFn: async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        });
      },
    });
    await expect(
      proxy.forward({
        method: 'GET',
        path: '/session/ses_1378/message',
        query: new URLSearchParams(),
        project,
        userId: 7,
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'OPENCODE_UNAVAILABLE',
    });
  });
});
