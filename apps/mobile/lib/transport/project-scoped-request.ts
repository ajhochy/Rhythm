export const RHYTHM_PROJECT_HEADER = 'X-Rhythm-Project-ID';

export class MissingProjectScopeError extends Error {
  readonly kind = 'missing-scope';
  readonly status = 400;
  readonly retryable = false;

  constructor() {
    super('Select an active Rhythm project to use this tool.');
    this.name = 'MissingProjectScopeError';
  }
}

/**
 * Authoritative project-scope merge shared by generated OpenCode requests and
 * the handwritten Tools service. Caller-provided scope headers never win.
 */
export function withProjectScope<
  T extends Omit<RequestInit, 'headers'> & {
    headers?: Record<string, string>;
  },
>(
  projectId: string | null | undefined,
  init: T,
  scopeSignal?: AbortSignal,
): T {
  const normalizedProjectId = projectId?.trim();
  if (!normalizedProjectId) throw new MissingProjectScopeError();
  return {
    ...init,
    headers: {
      ...init.headers,
      [RHYTHM_PROJECT_HEADER]: normalizedProjectId,
    },
    signal: scopeSignal ?? init.signal,
  };
}
