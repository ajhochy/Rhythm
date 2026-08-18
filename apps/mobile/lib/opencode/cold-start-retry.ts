/**
 * Cold-start retry budget for paired-gateway reads (#1378 / #1379).
 *
 * A cold Tailscale connection, or a Mac mid-turn, answers the first read with
 * a transient 504/502 while it warms. Surfacing that immediately produced the
 * observed "two 15s timeouts, works on the third try" wall on a real device.
 * Retrying inside one budget turns that into a single slower first open.
 *
 * Only idempotent reads are replayed. `session.prompt_async`, permission
 * replies, and aborts are not idempotent — a duplicate dispatch is worse than
 * an error — so writes get exactly one attempt.
 */

/** Statuses that mean "reachable but warming", per the gateway's #1378 classification. */
export const GATEWAY_RETRY_STATUSES: readonly number[] = [502, 503, 504];

/** Backoff schedule. Total added budget ≈ 4.6s across three extra attempts. */
export const GATEWAY_RETRY_DELAYS_MS: readonly number[] = [400, 1_200, 3_000];

export function isTransientGatewayStatus(status: number): boolean {
  return GATEWAY_RETRY_STATUSES.includes(status);
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `attempt`, replaying it with backoff while it answers with a transient
 * status. Returns the last response either way — callers keep their existing
 * error handling for the exhausted case.
 */
export async function fetchWithColdStartBackoff(
  attempt: () => Promise<Response>,
  options: {
    retryable: boolean;
    signal?: AbortSignal | null;
    delaysMs?: readonly number[];
    sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
    /**
     * #1422 — status alone cannot always separate "warming" from "answered".
     * A paired gateway returns 503 for BOTH "still coming up" and the
     * definitive "the Mac is asleep" (`mac_offline`). Replaying the latter
     * burns the entire 4.6s budget before surfacing an answer the very first
     * response already carried, stranding the UI in a loading state.
     *
     * Consulted only for an otherwise retry-eligible response, and it must
     * inspect a CLONE — the original is still handed back to the caller.
     */
    isDefinitive?: (response: Response) => boolean | Promise<boolean>;
  },
): Promise<Response> {
  let response = await attempt();
  if (!options.retryable) return response;

  const sleep = options.sleep ?? delay;
  for (const wait of options.delaysMs ?? GATEWAY_RETRY_DELAYS_MS) {
    if (!isTransientGatewayStatus(response.status)) return response;
    // Already an answer, not a warming signal — hand it back with its body
    // intact rather than replaying it.
    if (options.isDefinitive && (await options.isDefinitive(response))) {
      return response;
    }
    // The retry path never reads the body; release it so the connection can
    // be reused for the next attempt.
    await Promise.resolve(response.body?.cancel?.()).catch(() => undefined);
    await sleep(wait, options.signal);
    response = await attempt();
  }
  return response;
}
