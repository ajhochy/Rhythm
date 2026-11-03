export interface OpencodeHealthClient {
  isReady: boolean;
  statusMessage: string;
  websearchConfigured: boolean;
  /**
   * Re-initializes a failed/disposed engine client. Optional so existing
   * callers that construct a literal ready-client stub keep compiling; when
   * absent, no recovery is attempted.
   */
  ensureReady?(): Promise<boolean>;
}

export interface OpencodeHealthBridge {
  isLive: boolean;
}

/**
 * A failed initialization used to be cached forever: `/opencode/health` kept
 * answering "Timeout waiting for server to start after 5000ms" long after a
 * healthy engine was listening, and nothing ever retried (Electron deliberately
 * does not auto-restart the engine). The health probe is the one thing that is
 * polled, so it is also the cheapest place to drive recovery — fire-and-forget
 * so the probe itself stays fast, throttled so a polling client cannot turn a
 * 5-second spawn timeout into a spawn storm.
 */
export const ENGINE_RECOVERY_THROTTLE_MS = 15_000;

// -Infinity, not 0: "never attempted" must not read as "attempted at epoch".
let lastRecoveryAttemptAt = Number.NEGATIVE_INFINITY;

/** Test seam: forget the throttle window. */
export function resetEngineRecoveryThrottle(): void {
  lastRecoveryAttemptAt = Number.NEGATIVE_INFINITY;
}

/**
 * Kick a background re-initialization when the engine is not ready. Returns
 * true when an attempt was started on this call (i.e. the payload may report
 * `recovering`), false when ready or still inside the throttle window.
 */
export function tryRecoverEngine(
  client: Pick<OpencodeHealthClient, 'isReady' | 'ensureReady'>,
  now: number = Date.now(),
): boolean {
  if (client.isReady || typeof client.ensureReady !== 'function') return false;
  if (now - lastRecoveryAttemptAt < ENGINE_RECOVERY_THROTTLE_MS) return false;
  lastRecoveryAttemptAt = now;
  void Promise.resolve()
    .then(() => client.ensureReady!())
    .catch(() => false);
  return true;
}

export function buildOpencodeHealthPayload(
  client: OpencodeHealthClient,
  bridge: OpencodeHealthBridge,
): {
  status: 'ready' | 'unavailable';
  message: string;
  bridgeLive: boolean;
  websearchConfigured: boolean;
  recovering: boolean;
} {
  const bridgeLive = bridge.isLive !== false;
  // `recovering` reports whether THIS call started an attempt (so a poller can
  // see the cadence); the explanation is attached whenever the engine is down
  // and recovery is wired, because a user polling health should not see the
  // advice blink in and out with the throttle window.
  const recovering = tryRecoverEngine(client);
  const selfHealing = !client.isReady && typeof client.ensureReady === 'function';
  const message = client.isReady && !bridgeLive
    ? 'Opencode engine ready, event bridge unavailable'
    : client.statusMessage;
  return {
    status: client.isReady && bridgeLive ? 'ready' : 'unavailable',
    // Say what is being done about it, not just what broke.
    message: selfHealing
      ? `${message} — the engine is being restarted automatically; retry in a few seconds.`
      : message,
    bridgeLive,
    websearchConfigured: client.websearchConfigured,
    recovering,
  };
}
