/**
 * PublicGatewayClient
 *
 * Deliberately unauthenticated transport for the two public mobile-gateway
 * bootstrap endpoints: health and one-time-code pairing. It has no token
 * provider and therefore cannot attach either a Rhythm Cloud Bearer or a
 * paired-device credential to a QR-selected origin.
 */

import type { FetchFn } from './types';
import { ApiError } from './api-error';
import { executePublicRequest } from './request-helper';

const AUTH_LIKE_HEADER =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;

export class PublicGatewayClient {
  private readonly baseUrl: string;

  constructor({ baseUrl }: { baseUrl: string }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  requestPublic<T = unknown>(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
    fetchFn: FetchFn = fetch,
  ): Promise<T> {
    const method = (init.method ?? 'GET').toUpperCase();
    const allowed =
      (method === 'GET' && path === '/mobile-gateway/health') ||
      (method === 'POST' && path === '/mobile-gateway/pair');
    if (
      !allowed ||
      Object.keys(init.headers ?? {}).some((header) =>
        AUTH_LIKE_HEADER.test(header))
    ) {
      throw new ApiError({
        source: 'paired-mac',
        status: 0,
        code: 'PUBLIC_GATEWAY_REQUEST_BLOCKED',
        message: 'The public pairing request was blocked.',
        retryable: false,
      });
    }

    const safeHeaders = Object.fromEntries(
      Object.entries(init.headers ?? {}).filter(([header]) =>
        /^(?:accept|content-type)$/i.test(header),
      ),
    );
    return executePublicRequest<T>({
      source: 'paired-mac',
      baseUrl: this.baseUrl,
      path,
      init: {
        method,
        ...(init.body === undefined ? {} : { body: init.body }),
        ...(init.signal === undefined ? {} : { signal: init.signal }),
        headers: safeHeaders,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      },
      fetchFn,
    });
  }
}
