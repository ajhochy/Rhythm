import { AppError } from '../errors/app_error';
import { logger } from '../utils/logger';

/**
 * Shared classification for OpenCode failures observed during a mobile
 * scope-validation pre-check (#1378).
 *
 * The main proxied request path already distinguishes the three cases per
 * #1311 — abort/timeout → 504, connection failure → 502 UNAVAILABLE, real
 * answer → pass through. The pre-check that fronts every session open did
 * not: it collapsed *any* non-OK or thrown result into a hard
 * `502 OPENCODE_SCOPE_CHECK_FAILED`, which the phone's failure classifier
 * reads as "bad gateway, stop" rather than "engine is warming, retry".
 *
 * A cold Tailscale connection or a Mac busy with a heavy local turn is the
 * common case on first open, so it must read as transient.
 */

/** Upstream statuses that mean "reachable but not ready" rather than "broken". */
const TRANSIENT_UPSTREAM_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

function abortLike(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

/**
 * Classify a non-OK *answer* from a reachable engine during a pre-check.
 *
 * Transient statuses become a retryable `504 OPENCODE_TIMEOUT` so the phone
 * backs off and retries. Everything else keeps the pre-existing hard
 * `502 OPENCODE_SCOPE_CHECK_FAILED` — the engine answered, and its answer
 * says the resource could not be validated.
 */
export function mobileScopeCheckStatusFailure(
  status: number,
  tag: string,
): AppError {
  if (TRANSIENT_UPSTREAM_STATUSES.has(status)) {
    logger.warn(
      `[${tag}] transient upstream status ${status} during scope validation`,
    );
    return new AppError(
      504,
      'OPENCODE_TIMEOUT',
      'OpenCode is busy validating the selected resource',
    );
  }
  logger.warn(
    `[${tag}] synthesized 502 for upstream status ${status} during scope validation`,
  );
  return new AppError(
    502,
    'OPENCODE_SCOPE_CHECK_FAILED',
    'OpenCode could not validate the selected mobile resource',
  );
}

/**
 * Classify a *thrown* failure from a pre-check fetch: an abort/timeout is a
 * retryable 504, any other transport failure is 502 UNAVAILABLE. Mirrors the
 * main request path's catch block so both surfaces agree.
 *
 * Intentionally omits the URL, headers, and raw message: each can carry a
 * project path, prompt, or credential.
 */
export function mobileScopeCheckThrownFailure(
  error: unknown,
  tag: string,
): AppError {
  if (error instanceof AppError) return error;
  if (abortLike(error)) {
    logger.warn(`[${tag}] scope validation timed out`);
    return new AppError(
      504,
      'OPENCODE_TIMEOUT',
      'OpenCode scope validation timed out',
    );
  }
  const causeCode =
    error instanceof Error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause
      ? String(error.cause.code)
      : 'UNKNOWN';
  logger.warn(
    `[${tag}] scope validation fetch failed (${
      error instanceof Error ? error.name : 'UnknownError'
    }/${causeCode})`,
  );
  return new AppError(502, 'OPENCODE_UNAVAILABLE', 'OpenCode is unavailable');
}
