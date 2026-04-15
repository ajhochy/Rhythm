export class RhythmApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Rhythm API error ${status}: ${message}`);
    this.name = 'RhythmApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new RhythmApiError(res.status, String(body.error ?? res.statusText));
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

export function apiPost<T>(
  apiUrl: string,
  apiToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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

/** Convenience: wraps a tool handler so errors always return isError content. */
export function toolResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const };
}
