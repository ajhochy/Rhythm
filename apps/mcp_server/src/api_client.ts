import { fetch as undiciFetch, Agent as UndiciAgent } from 'undici';

export class RhythmApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Rhythm API error ${status}: ${message}`);
    this.name = 'RhythmApiError';
  }
}

/**
 * Render an API error body as text an AGENT can act on.
 *
 * Rhythm's error envelope is `{ error: { code, message } }` — an object. The
 * previous `String(body.error)` therefore produced the literal
 * "[object Object]" for every structured error, which is what an agent saw and
 * relayed to the user. Observed live 2026-08-04: Memory Consolidation reported
 * only "approval requests were rejected by the server" for 8x
 * `409: [object Object]`, and separately swallowed a `400: [object Object]` on a
 * memory write — in both cases the actual reason existed server-side and was
 * discarded here.
 */
function describeErrorBody(body: Record<string, unknown>, fallback: string): string {
  const err = body.error ?? body.message ?? null;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    const message = typeof rec.message === 'string' ? rec.message : null;
    const code = typeof rec.code === 'string' ? rec.code : null;
    if (message && code) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through to the status text */
    }
  }
  return fallback;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new RhythmApiError(res.status, describeErrorBody(body, res.statusText));
  }
  return res.json() as Promise<T>;
}

export function apiGet<T>(
  apiUrl: string,
  apiToken: string,
  path: string,
): Promise<T> {
  return fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  }).then((res) => handleResponse<T>(res));
}

export interface ApiPostOptions {
  /**
   * #1115 — undici's global fetch dispatcher aborts with
   * "TypeError: fetch failed" (UND_ERR_HEADERS_TIMEOUT) if response HEADERS
   * don't arrive within its hard-coded 300s default. org-optimizer's
   * `/agent-org-optimizer/run` holds the request open for a whole
   * synchronous pass (200-600s observed). Set timeoutMs on that call only —
   * apiPost backs ~13 other tool calls that should keep failing fast on a
   * genuine hang, so this is opt-in per-call, not a global override.
   */
  timeoutMs?: number;
}

export function apiPost<T>(
  apiUrl: string,
  apiToken: string,
  path: string,
  body: unknown,
  opts?: ApiPostOptions,
): Promise<T> {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };
  const requestBody = JSON.stringify(body);

  if (opts?.timeoutMs) {
    // Node's global `fetch` is backed by its OWN internal, separately
    // vendored copy of undici (node:internal/deps/undici) — not the
    // userland `undici` npm package. They are different module instances:
    // passing an Agent built by the npm package as the global fetch's
    // `dispatcher` throws at runtime ("invalid onRequestStart method" ->
    // generic "TypeError: fetch failed"), and the npm package's
    // setGlobalDispatcher has zero effect on the global fetch either
    // (verified live against a running server, #1115). The only way to
    // actually apply a custom-timeout Agent is to route the whole call
    // through the npm package's OWN fetch, matching implementations
    // end-to-end.
    return undiciFetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers,
      body: requestBody,
      dispatcher: new UndiciAgent({ headersTimeout: opts.timeoutMs, bodyTimeout: opts.timeoutMs }),
    }).then((res) => handleResponse<T>(res as unknown as Response));
  }

  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers,
    body: requestBody,
  }).then((res) => handleResponse<T>(res));
}

export function apiPatch<T>(
  apiUrl: string,
  apiToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  return fetch(`${apiUrl}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).then((res) => handleResponse<T>(res));
}

export async function apiDelete(
  apiUrl: string,
  apiToken: string,
  path: string,
): Promise<void> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new RhythmApiError(res.status, String(body.error ?? res.statusText));
  }
}

/** Decode HTML entities that the model may inject into tool call arguments (e.g. & → &amp;). */
export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Convenience: wraps a tool handler so errors always return isError content. */
export function toolResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const };
}
