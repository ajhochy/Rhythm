import { describe, expect, it } from 'vitest';

import { AppError } from '../errors/app_error';
import {
  mobileScopeCheckStatusFailure,
  mobileScopeCheckThrownFailure,
} from '../services/mobile_upstream_failure';

/**
 * #1378 — the mobile scope-validation pre-check must classify a cold/busy
 * engine as transient (504) instead of collapsing every failure into a hard
 * 502 SCOPE_CHECK_FAILED.
 */
describe('#1378 mobile scope-check failure classification', () => {
  it('maps transient upstream statuses to a retryable 504', () => {
    for (const status of [408, 425, 429, 502, 503, 504]) {
      const error = mobileScopeCheckStatusFailure(status, 'Test');
      expect(error.statusCode, `status ${status}`).toBe(504);
      expect(error.code).toBe('OPENCODE_TIMEOUT');
    }
  });

  it('keeps a hard 502 for a definite non-OK answer', () => {
    for (const status of [400, 401, 403, 404, 409, 500]) {
      const error = mobileScopeCheckStatusFailure(status, 'Test');
      expect(error.statusCode, `status ${status}`).toBe(502);
      expect(error.code).toBe('OPENCODE_SCOPE_CHECK_FAILED');
    }
  });

  it('maps an aborted/timed-out pre-check to 504, not 502', () => {
    const aborted = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    const error = mobileScopeCheckThrownFailure(aborted, 'Test');
    expect(error.statusCode).toBe(504);
    expect(error.code).toBe('OPENCODE_TIMEOUT');
  });

  it('maps a connection failure to 502 OPENCODE_UNAVAILABLE', () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    const error = mobileScopeCheckThrownFailure(refused, 'Test');
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('OPENCODE_UNAVAILABLE');
  });

  it('never leaks the raw upstream message into the client-visible error', () => {
    const secretive = Object.assign(
      new TypeError('connect ECONNREFUSED /Users/someone/private/project'),
      { cause: { code: 'ECONNREFUSED' } },
    );
    const error = mobileScopeCheckThrownFailure(secretive, 'Test');
    expect(error.message).not.toContain('/Users/');
  });

  it('passes an existing AppError through unchanged', () => {
    const notFound = AppError.notFound('Mobile OpenCode resource');
    expect(mobileScopeCheckThrownFailure(notFound, 'Test')).toBe(notFound);
  });
});
