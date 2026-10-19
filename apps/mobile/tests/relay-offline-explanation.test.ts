/**
 * Regression for the 2026-09-30 outage UX: the phone said "A network error
 * occurred. Check your connection and try again." — indistinguishable from the
 * user's own wifi being bad — while the real fault was a dead uplink from the
 * Mac to the relay.
 *
 * The relay now answers offline requests with
 * `{ error, message, lastUplinkAt }` (see api_server
 * routes/relay_gateway_routes.ts `offlineBody`). This asserts the phone turns
 * that body into a displayable explanation naming the cause, the remedy, and
 * the last successful contact — rather than the generic fallback.
 */
import { MacOfflineError, normalizeApiError, summarizeError } from '@/lib/transport/api-error';

const LAST_SEEN = '2026-09-30T04:06:33.000Z';

/** Exactly what offlineBody() emits on the relay. */
function relayOfflineBody(error: string): string {
  return JSON.stringify({
    error,
    message:
      `The Mac stopped answering the relay; last contact ${LAST_SEEN}. ` +
      'Check that the Rhythm desktop app is running — it may need to be restarted.',
    lastUplinkAt: LAST_SEEN,
  });
}

describe('relay offline responses explain themselves', () => {
  it.each(['mac_offline', 'mac_offline_and_mirror_incomplete'])(
    'surfaces the relay explanation for %s',
    (code) => {
      const error = normalizeApiError('paired-mac', 503, relayOfflineBody(code), undefined);

      expect(error).toBeInstanceOf(MacOfflineError);
      expect(error.code).toBe(code);
      expect(error.message).toContain('stopped answering');
      expect(error.message).toContain('restarted');
      expect(error.message).toContain(LAST_SEEN);
      expect(error.message).not.toContain('A network error occurred');
      expect(summarizeError(error, 'fallback')).toBe(error.message);
    },
  );

  it('still scrubs a device token echoed back in the explanation', () => {
    const token = 'device-token-must-not-leak';
    const body = JSON.stringify({
      error: 'mac_offline',
      message: `Last contact ${LAST_SEEN} (auth ${token})`,
      lastUplinkAt: LAST_SEEN,
    });

    const error = normalizeApiError('paired-mac', 503, body, token);
    expect(error.message).not.toContain(token);
    expect(error.message).toContain('[redacted]');
  });
});
