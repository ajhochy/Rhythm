/**
 * RhythmCloudClient
 *
 * HTTP client for the production Rhythm Cloud API.
 *
 * Authorization scheme: `Bearer <token>` in the `Authorization` header.
 * Tokens are obtained via the injected `getToken` provider and are never
 * stored in error objects, logs, or response fields.
 *
 * All transport failures — token-provider rejection, network failure,
 * non-2xx status, or response-body read failure — are normalized to
 * `ApiError` before being thrown.
 */

import type { FetchFn, RhythmCloudClientOptions } from './types';
import { executePublicRequest, executeRequest } from './request-helper';

export class RhythmCloudClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string>;

  constructor({ baseUrl, getToken }: RhythmCloudClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
  }

  /**
   * Make an authenticated request to the Rhythm Cloud API.
   *
   * @param path     - Path relative to `baseUrl`, e.g. `/sessions`.
   * @param init     - Standard `RequestInit` options (method, body, headers).
   * @param fetchFn  - Optional fetch override; defaults to global `fetch`.
   *                   Inject a test double to avoid real network calls.
   * @returns        Parsed JSON response body as `T`.
   * @throws         `ApiError` for any transport failure.
   */
  async request<T = unknown>(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
    fetchFn: FetchFn = fetch,
  ): Promise<T> {
    return executeRequest<T>({
      source: 'cloud',
      baseUrl: this.baseUrl,
      getAuthHeader: async (token) => `Bearer ${token}`,
      getToken: this.getToken,
      path,
      init,
      fetchFn,
    });
  }

  /** Make a request to an explicitly unauthenticated Rhythm Cloud endpoint. */
  async requestPublic<T = unknown>(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
    fetchFn: FetchFn = fetch,
  ): Promise<T> {
    return executePublicRequest<T>({
      source: 'cloud',
      baseUrl: this.baseUrl,
      path,
      init,
      fetchFn,
    });
  }

  /** Use a caller-held token for local-first logout after SecureStore deletion. */
  async requestWithToken<T = unknown>(
    token: string,
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
    fetchFn: FetchFn = fetch,
  ): Promise<T> {
    return executeRequest<T>({
      source: 'cloud',
      baseUrl: this.baseUrl,
      getAuthHeader: async (value) => `Bearer ${value}`,
      getToken: async () => token,
      path,
      init,
      fetchFn,
    });
  }
}
