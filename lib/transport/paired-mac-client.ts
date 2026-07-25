/**
 * PairedMacClient
 *
 * HTTP client for the paired Mac's mobile gateway (Tailscale HTTPS endpoint).
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
import { executeRequest } from './request-helper';

export class PairedMacClient {
  private readonly baseUrl: string;
  private readonly getDeviceToken: () => Promise<string>;

  constructor({ baseUrl, getDeviceToken }: PairedMacClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getDeviceToken = getDeviceToken;
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
    const url = new URL(`${this.baseUrl}/mobile-gateway/pty/${encodeURIComponent(ptyId)}/connect`);

    // Protocol conversion: the Tailscale endpoint is always HTTPS, but
    // WebSocket connections require the ws/wss scheme.
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    if (options.ticket) url.searchParams.set('ticket', options.ticket);
    if (options.cursor) url.searchParams.set('cursor', options.cursor);

    return url.toString();
  }
}
