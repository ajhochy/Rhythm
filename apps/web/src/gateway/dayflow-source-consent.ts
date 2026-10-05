/**
 * The authenticated Dayflow source-consent surface is intentionally separate
 * from loopback-only Dayflow settings. It accepts only an existing server
 * root/project pair; the server resolves actor and all source authority.
 */
export const DAYFLOW_SOURCE_CONSENT_PATH = '/dayflow-agent/source-consent';
export const DAYFLOW_SOURCE_CONSENT_TIMEOUT_MS = 10_000;

export type DayflowSourceConsentAction = 'grant' | 'revoke';

export type DayflowSourceConsentResult =
  | { status: 'accepted' }
  | { status: 'unavailable' };

export type DayflowSourceConsentGateway = {
  setSourceConsent(input: {
    action: DayflowSourceConsentAction;
    sessionId: string;
    projectId: string;
  }, signal?: AbortSignal): Promise<DayflowSourceConsentResult>;
};

function accepted(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && record.schemaVersion === 1 && record.status === 'accepted';
}

function unavailable(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && record.schemaVersion === 1 && record.status === 'unavailable';
}

function abortError(): DOMException {
  return new DOMException('The Dayflow consent request was cancelled.', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Uses the normal signed-in bearer only for this protected route. The token is
 * never sent in the JSON payload, written to a journal, or exposed in a UI
 * result. Any malformed/non-accepted result remains closed/unavailable.
 */
export function createLiveDayflowSourceConsentGateway(
  apiBase: string,
  fetcher: typeof fetch,
  taskToken?: string,
  timeoutMs = DAYFLOW_SOURCE_CONSENT_TIMEOUT_MS,
): DayflowSourceConsentGateway {
  const authorization = taskToken?.trim();
  return {
    async setSourceConsent(input, signal) {
      if (!authorization) return { status: 'unavailable' };
      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', abortFromCaller, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetcher(apiBase.replace(/\/$/, '') + DAYFLOW_SOURCE_CONSENT_PATH, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${authorization}`,
          },
          body: JSON.stringify({
            schemaVersion: 1,
            action: input.action,
            sessionId: input.sessionId,
            projectId: input.projectId,
          }),
          signal: controller.signal,
        });
        let body: unknown;
        try { body = await response.json(); } catch { body = undefined; }
        if (response.status === 202 && accepted(body)) return { status: 'accepted' };
        // The closed server path uses a non-disclosing 403 unavailable shape.
        // Any other status/envelope is also unavailable, never a local grant.
        if (response.status === 403 && unavailable(body)) return { status: 'unavailable' };
        return { status: 'unavailable' };
      } catch (error) {
        if (signal?.aborted || isAbort(error)) throw abortError();
        // A timeout/network failure gives no receipt, so leave it closed. The
        // caller may offer an explicit user retry without assuming a grant.
        if (timedOut) return { status: 'unavailable' };
        return { status: 'unavailable' };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
      }
    },
  };
}
