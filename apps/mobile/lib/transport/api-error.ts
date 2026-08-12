/**
 * ApiError — the single error type thrown by both transport clients.
 *
 * Design constraints enforced here:
 *  - Extends `Error` so standard `instanceof` / `catch (e)` patterns work.
 *  - Carries structured fields (`source`, `status`, `code`, `retryable`) for
 *    programmatic handling without string-parsing.
 *  - `message` and `code` are safe to display: auth tokens are actively
 *    scrubbed before any field is set, so a misconfigured server that echoes
 *    the token in its response body cannot leak it through error objects.
 *  - `normalizeApiError` receives the token so it can scrub it; the token is
 *    never stored and never appears in the constructed error.
 */

import type { ApiErrorOptions, ApiErrorSource } from './types';

export { type ApiErrorSource };

export class ApiError extends Error {
  readonly source: ApiErrorSource;
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor({ source, status, code, message, retryable }: ApiErrorOptions) {
    super(message);
    this.name = 'ApiError';
    this.source = source;
    this.status = status;
    this.code = code;
    this.retryable = retryable;

    // Maintain proper prototype chain in transpiled ES5/ES2015.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type MacOfflineCode =
  | 'mac_offline'
  | 'mac_offline_and_mirror_incomplete';

export class MacOfflineError extends ApiError {
  constructor(
    code: MacOfflineCode = 'mac_offline',
    message = 'The paired Mac is offline. You can still read synced sessions.',
  ) {
    super({
      source: 'paired-mac',
      status: 503,
      code,
      message,
      retryable: true,
    });
    this.name = 'MacOfflineError';
  }
}

/**
 * Returns true for status codes where an automatic retry is reasonable:
 *   - Network-level failure (status 0)
 *   - 429 Too Many Requests
 *   - 5xx Server Errors
 *
 * 4xx errors (except 429) indicate client-side problems that retrying won't
 * fix, so they return false.
 */
function isRetryable(status: number): boolean {
  if (status === 0) return true; // network failure
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/** Replacement string used wherever a token was found in a server-supplied field. */
const REDACTED = '[redacted]';

/**
 * Remove every occurrence of `token` from `text`, case-insensitively.
 * Returns the original string unchanged when `token` is absent or empty.
 *
 * This guards against misconfigured proxies or servers that echo the
 * `Authorization` header value back in their JSON error body.
 */
function scrubToken(text: string, token: string | undefined): string {
  if (!token) return text;
  // Escape regex special chars in the token so a token like "a+b" matches literally.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'gi'), REDACTED);
}

/**
 * Attempt to parse a JSON error body from the server.  On success, uses
 * `code` and `message` fields from the JSON.  Falls back to a generic
 * message that does not expose the raw body (which could contain tokens
 * echoed from request headers by a misconfigured proxy).
 *
 * `token` is the auth credential that was sent with this request.  It is
 * actively scrubbed from the server-supplied `code` and `message` before
 * those values are stored in the error.  The token is not stored anywhere
 * in the returned `ApiError`.
 */
export function normalizeApiError(
  source: ApiErrorSource,
  status: number,
  rawBody: string,
  token: string | undefined,
): ApiError {
  const retryable = isRetryable(status);

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;

    const offlineCode = parsed.error;
    if (
      source === 'paired-mac' &&
      status === 503 &&
      (offlineCode === 'mac_offline' ||
        offlineCode === 'mac_offline_and_mirror_incomplete')
    ) {
      const message =
        typeof parsed.message === 'string'
          ? scrubToken(parsed.message, token)
          : undefined;
      return new MacOfflineError(offlineCode, message);
    }

    const rawCode    = typeof parsed.code === 'string'    ? parsed.code    : `HTTP_${status}`;
    const rawMessage = typeof parsed.message === 'string' ? parsed.message : `Request failed with status ${status}`;

    // Actively scrub the token from server-supplied fields.
    const code    = scrubToken(rawCode, token);
    const message = scrubToken(rawMessage, token);

    return new ApiError({ source, status, code, message, retryable });
  } catch {
    return new ApiError({
      source,
      status,
      code: `HTTP_${status}`,
      message: `Request failed with status ${status}`,
      retryable,
    });
  }
}

/**
 * Wraps a caught network-level error (TypeError, etc.) as a retryable
 * `ApiError`.  Uses a generic message — the original error is not included
 * because it may contain auth material from the request context.
 */
export function normalizeNetworkError(source: ApiErrorSource): ApiError {
  return new ApiError({
    source,
    status: 0,
    code: 'NETWORK_ERROR',
    message: 'A network error occurred. Check your connection and try again.',
    retryable: true,
  });
}

/**
 * Wraps a token-provider or body-read failure as a retryable `ApiError`.
 * The raw error is discarded to prevent leaking auth-store internals.
 */
export function normalizeProviderError(source: ApiErrorSource): ApiError {
  return new ApiError({
    source,
    status: 0,
    code: 'TOKEN_UNAVAILABLE',
    message: 'Authentication credentials are temporarily unavailable. Please try again.',
    retryable: true,
  });
}

/**
 * Wraps a response-body read failure (stream interrupted, etc.) on an
 * otherwise-successful HTTP response as a retryable `ApiError`.
 */
export function normalizeBodyReadError(source: ApiErrorSource): ApiError {
  return new ApiError({
    source,
    status: 0,
    code: 'BODY_READ_ERROR',
    message: 'The server response could not be read. Please try again.',
    retryable: true,
  });
}
