/**
 * PairedMacClient
 *
 * HTTP client for the paired Mac through the active Cloud Gateway relay.
 *
 * Authorization scheme: `Device <token>` in the `Authorization` header.
 * This intentionally differs from the `Bearer` scheme used by
 * `RhythmCloudClient` so that the two authorization stores and transports
 * remain isolated — a cloud bearer token cannot be accidentally used as a
 * device token and vice versa.
 *
 * URL helpers (`sseUrl`, `subscribe`, `ptyUrl`) construct the target URL
 * string only; they do NOT open any connection.  The actual SSE/PTY
 * connection logic lives in later tasks.
 *
 * All transport failures are normalized to `ApiError` before being thrown.
 */

import type { FetchFn, PairedMacClientOptions } from './types';
import { normalizeProviderError } from './api-error';
import { fetchWithColdStartBackoff } from '@/lib/opencode/cold-start-retry';
import {
  executeAuthenticatedFetch,
  executeRequest,
} from './request-helper';

export class PairedMacClient {
  private readonly baseUrl: string;
  private readonly directBaseUrl?: string;
  private readonly getDeviceToken: () => Promise<string>;

  constructor({
    baseUrl,
    directBaseUrl,
    getDeviceToken,
  }: PairedMacClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.directBaseUrl = directBaseUrl?.replace(/\/$/, '');
    this.getDeviceToken = getDeviceToken;
  }

  /** Safe origin for generated clients; never contains device credentials. */
  origin(): string {
    return this.baseUrl;
  }

  /**
   * Authenticated fetch that preserves the raw Response for generated SDK and
   * SSE consumers. The device token is resolved for every request and is never
   * returned to the caller or cached by this client.
   */
  fetchResponse(
    path: string,
    init: Omit<RequestInit, 'headers'> & {
      headers?: Record<string, string>;
    },
    fetchFn: FetchFn = fetch,
  ): Promise<Response> {
    return executeAuthenticatedFetch({
      source: 'paired-mac',
      baseUrl: this.baseUrl,
      getAuthHeader: async (token) => `Device ${token}`,
      getToken: this.getDeviceToken,
      path,
      init,
      fetchFn,
    });
  }

  /**
   * Make an authenticated request to the paired Mac's mobile gateway.
   *
   * @param path    - Path relative to `baseUrl`, e.g. `/health`.
   * @param init    - Standard `RequestInit` options.
   * @param fetchFn - Optional fetch override; defaults to global `fetch`.
   * @returns       Parsed JSON response body as `T`.
   * @throws        `ApiError` for any transport failure.
   */
  async request<T = unknown>(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
    fetchFn: FetchFn = fetch,
  ): Promise<T> {
    return executeRequest<T>({
      source: 'paired-mac',
      baseUrl: this.baseUrl,
      getAuthHeader: async (token) => `Device ${token}`,
      getToken: this.getDeviceToken,
      path,
      init,
      fetchFn,
    });
  }

  /** Warm the relay transport without surfacing offline as an action error. */
  async prewarm(fetchFn: FetchFn = fetch): Promise<boolean> {
    try {
      const response = await fetchWithColdStartBackoff(
        () =>
          this.fetchResponse(
            '/mobile-gateway/health',
            { method: 'GET' },
            fetchFn,
          ),
        {
          retryable: true,
          // 503 is the gateway's definitive calm-offline answer. Warmup
          // failures use 504, so only those spend the cold-start budget.
          isDefinitive: (candidate) => candidate.status === 503,
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a short-lived authenticated HTTP source for native media views.
   * Resource reads always use the active paired base URL (the Cloud Gateway
   * relay when configured); the direct PTY fallback is intentionally ignored.
   */
  async resourceConnection(
    path: string,
    init: { headers?: Record<string, string> } = {},
  ): Promise<{ url: string; headers: Record<string, string> }> {
    let token: string;
    try {
      token = await this.getDeviceToken();
    } catch {
      throw normalizeProviderError('paired-mac');
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return {
      url: `${this.baseUrl}${normalizedPath}`,
      headers: {
        ...init.headers,
        Authorization: `Device ${token}`,
      },
    };
  }

  /**
   * Constructs the URL for an SSE event stream on the paired Mac.
   *
   * Does NOT open a connection.  The caller is responsible for creating the
   * `EventSource` or `fetch` stream using the returned URL together with
   * the device token (obtained separately via `getDeviceToken()`).
   *
   * @param path   - Path relative to `baseUrl`, e.g. `/events` or `/sessions/:id/events`.
   * @param params - Optional query parameters to append.
   * @returns      Full HTTPS URL string.
   */
  sseUrl(path: string, params: Record<string, string> = {}): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /**
   * Alias for `sseUrl()` — provided for plan-specified interface compatibility.
   *
   * Returns the HTTPS URL string for an SSE stream at `path`.  Like `sseUrl`,
   * this does NOT open a connection; callers open their own `EventSource` or
   * fetch stream using the returned URL with a separately-obtained device token.
   *
   * @param path   - Path relative to `baseUrl`.
   * @param params - Optional query parameters.
   * @returns      Full HTTPS URL string (identical to `sseUrl(path, params)`).
   */
  subscribe(path: string, params: Record<string, string> = {}): string {
    return this.sseUrl(path, params);
  }

  /**
   * Constructs the WebSocket URL for a PTY session on the paired Mac.
   *
   * Converts `https:` → `wss:` and `http:` → `ws:` so that the caller
   * can hand the URL directly to the WebSocket constructor.
   *
   * Does NOT open a connection.
   *
   * @param ptyId   - PTY session identifier.
   * @param options - Optional `ticket` and `cursor` query parameters.
   * @returns       Full `wss://` or `ws://` URL string.
   */
  ptyUrl(
    ptyId: string,
    options: { ticket?: string; cursor?: string } = {},
  ): string {
    const ptyBaseUrl = this.directBaseUrl ?? this.baseUrl;
    const url = new URL(
      `${ptyBaseUrl}/mobile-gateway/pty/${encodeURIComponent(ptyId)}/connect`,
    );

    // Protocol conversion: the Tailscale endpoint is always HTTPS, but
    // WebSocket connections require the ws/wss scheme.
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    if (options.ticket) url.searchParams.set('ticket', options.ticket);
    if (options.cursor) url.searchParams.set('cursor', options.cursor);

    return url.toString();
  }

  /**
   * Resolve the short-lived in-memory headers required by React Native's
   * WebSocket constructor. Device credentials are never placed in the URL or
   * persisted; callers discard this object after opening the socket.
   */
  async ptyConnection(
    ptyId: string,
    projectId: string,
    options: { ticket?: string; cursor?: string } = {},
  ): Promise<{
    url: string;
    headers: Record<string, string>;
  }> {
    let token: string;
    try {
      token = await this.getDeviceToken();
    } catch {
      throw normalizeProviderError('paired-mac');
    }
    return {
      url: this.ptyUrl(ptyId, options),
      headers: {
        Authorization: `Device ${token}`,
        'X-Rhythm-Project-ID': projectId,
      },
    };
  }
}
