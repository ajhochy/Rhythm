/**
 * executeRequest — shared HTTP request implementation used by both
 * `RhythmCloudClient` and `PairedMacClient`.
 *
 * Centralising the request logic here means every transport failure path —
 * token-provider rejection, network failure, non-2xx status, body-read
 * failure — is handled once and tested once.  The two clients differ only
 * in their auth scheme (`Bearer` vs `Device`), which they provide through
 * the `getAuthHeader` callback.
 *
 * Security properties enforced here:
 *  - Token is obtained before any string construction that could appear in
 *    errors or logs.
 *  - Token-provider rejection is caught and normalized to `ApiError`
 *    (retryable) — the raw store error is discarded.
 *  - Token is actively scrubbed from server-supplied `code` and `message`
 *    fields via `normalizeApiError`.
 *  - `Content-Type: application/json` is only set when a body is present
 *    and the caller has not supplied a content type; bodyless GETs do not
 *    trigger an unnecessary CORS preflight.
 *  - Response body read failures on 2xx responses are caught and normalized
 *    to a retryable `ApiError` — the raw stream error is discarded.
 */

import {
  ApiError,
  normalizeApiError,
  normalizeBodyReadError,
  normalizeNetworkError,
  normalizeProviderError,
} from './api-error';
import type { ApiErrorSource, FetchFn } from './types';

export interface ExecuteRequestOptions {
  source: ApiErrorSource;
  baseUrl: string;
  /** Returns the formatted Authorization header value, e.g. `Bearer <token>`. */
  getAuthHeader: (token: string) => Promise<string>;
  /** Returns the raw token string; used for server-echo scrubbing. */
  getToken: () => Promise<string>;
  path: string;
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };
  fetchFn: FetchFn;
}

export type ExecutePublicRequestOptions = Omit<
  ExecuteRequestOptions,
  'getAuthHeader' | 'getToken'
>;

export async function executePublicRequest<T = unknown>({
  source,
  baseUrl,
  path,
  init,
  fetchFn,
}: ExecutePublicRequestOptions): Promise<T> {
  const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const callerHeaders = init.headers ?? {};
  const hasContentType = Object.keys(callerHeaders).some(
    (key) => key.toLowerCase() === 'content-type',
  );
  const headers = {
    ...(init.body != null && !hasContentType
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...callerHeaders,
  };

  let response: Response;
  try {
    response = await fetchFn(url, { ...init, headers });
  } catch {
    throw normalizeNetworkError(source);
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw normalizeApiError(source, response.status, rawBody, undefined);
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw normalizeBodyReadError(source);
  }
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError({
      source,
      status: response.status,
      code: 'INVALID_JSON',
      message: 'The server returned a non-JSON response.',
      retryable: false,
    });
  }
}

export async function executeRequest<T = unknown>({
  source,
  baseUrl,
  getAuthHeader,
  getToken,
  path,
  init,
  fetchFn,
}: ExecuteRequestOptions): Promise<T> {
  // ------------------------------------------------------------------
  // 1. Obtain token — normalize provider failures to ApiError.
  // ------------------------------------------------------------------
  let token: string;
  let authHeader: string;
  try {
    token = await getToken();
    authHeader = await getAuthHeader(token);
  } catch {
    throw normalizeProviderError(source);
  }

  // ------------------------------------------------------------------
  // 2. Build URL and headers.
  //    Content-Type is set only when a body is present and the caller
  //    has not already provided one — bodyless GETs must not trigger
  //    an unnecessary CORS preflight.
  // ------------------------------------------------------------------
  const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

  const callerHeaders: Record<string, string> = init.headers ?? {};
  const hasBody = init.body !== undefined && init.body !== null;
  const callerHasContentType = Object.keys(callerHeaders).some(
    (k) => k.toLowerCase() === 'content-type',
  );

  const headers: Record<string, string> = {
    ...(hasBody && !callerHasContentType ? { 'Content-Type': 'application/json' } : {}),
    ...callerHeaders,
    // Authorization is set LAST — the injected provider is authoritative.
    Authorization: authHeader,
  };

  // ------------------------------------------------------------------
  // 3. Perform the request — normalize network failures to ApiError.
  // ------------------------------------------------------------------
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, headers });
  } catch {
    throw normalizeNetworkError(source);
  }

  // ------------------------------------------------------------------
  // 4. Non-2xx — read body, scrub token, normalize to ApiError.
  // ------------------------------------------------------------------
  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    // normalizeApiError actively scrubs `token` from server-supplied fields.
    throw normalizeApiError(source, response.status, rawBody, token);
  }

  // ------------------------------------------------------------------
  // 5. 2xx — read and parse body.
  //    Body-read failure is normalized to a retryable ApiError; the raw
  //    stream error is discarded (it may contain internal stack details).
  // ------------------------------------------------------------------
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw normalizeBodyReadError(source);
  }

  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError({
      source,
      status: response.status,
      code: 'INVALID_JSON',
      message: 'The server returned a non-JSON response.',
      retryable: false,
    });
  }
}
