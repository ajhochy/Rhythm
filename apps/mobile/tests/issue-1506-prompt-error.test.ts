import { ApiError, summarizeError } from '@/lib/transport/api-error';
import { clearSessionlessPromptError } from '@/providers/opencode-provider-selectors';

const CLOUDFLARE_502 = [
  '<!DOCTYPE html>',
  '<html class="no-js" lang="en-US"><head><title>api.vcrcapps.com | 502: Bad gateway</title>',
  `<style>${'a'.repeat(3000)}</style>`,
  '</head><body>Error 502 Ray ID: 9c0f</body></html>',
].join('\n');

describe('summarizeError (#1506)', () => {
  test('refuses an HTML error body and falls back', () => {
    expect(summarizeError(CLOUDFLARE_502, 'Could not load this project.'))
      .toBe('Could not load this project.');
  });

  test('refuses any body longer than the card can show', () => {
    expect(summarizeError('x'.repeat(201), 'fallback')).toBe('fallback');
    expect(summarizeError('x'.repeat(200), 'fallback')).toBe('x'.repeat(200));
  });

  test('prefers the status carried by an ApiError', () => {
    const error = new ApiError({
      source: 'paired-mac',
      status: 502,
      code: 'HTTP_502',
      message: 'Request failed with status 502',
      retryable: true,
    });
    expect(summarizeError(error, 'fallback')).toBe('Request failed with status 502');
  });

  test('derives a status from a thrown SDK payload', () => {
    expect(summarizeError({ status: 502, message: CLOUDFLARE_502 }, 'fallback'))
      .toBe('Request failed with status 502');
    expect(summarizeError(new Error('Session not found', { cause: { status: 404 } }), 'fallback'))
      .toBe('Request failed with status 404');
  });

  test('keeps a short, useful message from a plain Error', () => {
    expect(summarizeError(new Error('Choose a Rhythm profile before creating a chat.'), 'fallback'))
      .toBe('Choose a Rhythm profile before creating a chat.');
  });

  test('reads the nested message the session.error event carries', () => {
    expect(summarizeError({ data: { message: 'The model refused the request.' } }, 'fallback'))
      .toBe('The model refused the request.');
  });

  test('falls back for an empty or unusable throw', () => {
    expect(summarizeError(undefined, 'fallback')).toBe('fallback');
    expect(summarizeError('   ', 'fallback')).toBe('fallback');
    expect(summarizeError({}, 'fallback')).toBe('fallback');
  });
});

describe('clearSessionlessPromptError (#1506)', () => {
  test('retracts a session-less error once the bootstrap succeeds', () => {
    const global: { message: string; occurredAt: number; sessionId?: string } =
      { message: 'boom', occurredAt: 1 };
    expect(clearSessionlessPromptError(global)).toBeUndefined();
  });

  test('leaves an error scoped to one session alone', () => {
    const scoped = { message: 'boom', occurredAt: 1, sessionId: 'ses_1' };
    expect(clearSessionlessPromptError(scoped)).toBe(scoped);
  });

  test('is a no-op when nothing is showing', () => {
    expect(clearSessionlessPromptError(undefined)).toBeUndefined();
  });
});
