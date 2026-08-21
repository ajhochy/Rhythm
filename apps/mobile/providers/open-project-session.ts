export const OPEN_PROJECT_SESSION_TIMEOUT_MS = 40_000;

export type OpenProjectSessionTerminalKind =
  | 'missing-session'
  | 'unauthorized-project'
  | 'offline'
  | 'timeout'
  | 'transient-error';

export type OpenProjectSessionState =
  | { kind: 'idle' }
  | {
      kind: 'opening';
      generation: number;
      projectId: string;
      sessionId: string;
    }
  | {
      kind: 'ready';
      generation: number;
      projectId: string;
      sessionId: string;
    }
  | {
      kind: OpenProjectSessionTerminalKind;
      generation: number;
      message: string;
      projectId: string;
      sessionId: string;
    };

export type OpenProjectSessionResult =
  | OpenProjectSessionState
  | {
      kind: 'cancelled';
      generation: number;
      projectId: string;
      sessionId: string;
    };

export type OpenProjectSessionPresentation = {
  backLabel: 'Back to chats';
  message: string;
  retryLabel: 'Retry';
  screenState:
    | 'empty'
    | 'offline-cache'
    | 'forbidden'
    | 'error';
  title: string;
};

const TERMINAL_PRESENTATIONS: Record<
  OpenProjectSessionTerminalKind,
  OpenProjectSessionPresentation
> = {
  'missing-session': {
    backLabel: 'Back to chats',
    message:
      'This chat is no longer available in the selected project. It may have been archived or deleted.',
    retryLabel: 'Retry',
    screenState: 'empty',
    title: 'Chat not found',
  },
  'unauthorized-project': {
    backLabel: 'Back to chats',
    message:
      'This project is unavailable or your paired device no longer has access to it.',
    retryLabel: 'Retry',
    screenState: 'forbidden',
    title: 'Project unavailable',
  },
  offline: {
    backLabel: 'Back to chats',
    message:
      'Rhythm could not reach your paired Mac. Reconnect it, then try again.',
    retryLabel: 'Retry',
    screenState: 'offline-cache',
    title: 'Opening chat',
  },
  timeout: {
    backLabel: 'Back to chats',
    message:
      'The chat did not finish loading within 40 seconds. The request was cancelled.',
    retryLabel: 'Retry',
    screenState: 'error',
    title: 'Chat open timed out',
  },
  'transient-error': {
    backLabel: 'Back to chats',
    message:
      'The chat could not be opened because of a temporary error.',
    retryLabel: 'Retry',
    screenState: 'error',
    title: 'Could not open chat',
  },
};

export function getOpenProjectSessionPresentation(
  kind: OpenProjectSessionTerminalKind,
): OpenProjectSessionPresentation {
  return TERMINAL_PRESENTATIONS[kind];
}

export type ProjectSessionCatalog<TSession> =
  | TSession[]
  | ({ sessions: TSession[] } & Record<string, unknown>);

export interface OpenProjectSessionTransport<
  TSession extends { id: string },
  TPayload extends Record<string, unknown>,
> {
  confirmProject(projectId: string): Promise<boolean>;
  listSessions(projectId: string): Promise<ProjectSessionCatalog<TSession>>;
  resolveSession?(
    projectId: string,
    sessionId: string,
  ): Promise<TSession | undefined>;
  discoverSessions?(
    projectId: string,
    pinnedSessionId: string,
  ): Promise<void>;
  loadSessionState(
    projectId: string,
    sessionId: string,
    session: TSession,
    catalog: ProjectSessionCatalog<TSession>,
  ): Promise<TPayload>;
  /**
   * Synchronous cache-first fast path. When the target session's state is
   * already hydrated (recently opened chat), return a payload built from the
   * cache so the chat renders instantly; the transport is expected to
   * schedule its own background revalidation. Return undefined to take the
   * normal network path.
   */
  openFromCache?(projectId: string, sessionId: string): TPayload | undefined;
}

type OpenProjectSessionClock = {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
};

export interface OpenProjectSessionController {
  cancelOpenProjectSession(): void;
  getState(): OpenProjectSessionState;
  openProjectSession(
    projectId: string,
    sessionId: string,
  ): Promise<OpenProjectSessionResult>;
}

class OpenProjectSessionFailure extends Error {
  constructor(
    readonly kind: OpenProjectSessionTerminalKind,
    message: string,
  ) {
    super(message);
    this.name = 'OpenProjectSessionFailure';
  }
}

const CANCELLED = Symbol('open-project-session-cancelled');

function statusForError(reason: unknown): number | undefined {
  if (!reason || typeof reason !== 'object') return undefined;
  const status = Number((reason as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}

function codeForError(reason: unknown): string | undefined {
  if (!reason || typeof reason !== 'object') return undefined;
  const code = (reason as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function messageForError(reason: unknown, fallback: string): string {
  if (
    reason &&
    typeof reason === 'object' &&
    typeof (reason as { message?: unknown }).message === 'string'
  ) {
    return (reason as { message: string }).message;
  }
  return fallback;
}

function classifyFailure(reason: unknown): OpenProjectSessionFailure {
  if (reason instanceof OpenProjectSessionFailure) return reason;
  const status = statusForError(reason);
  const code = codeForError(reason);
  if (
    status === 0 ||
    code === 'NETWORK_ERROR' ||
    code === 'TOKEN_UNAVAILABLE' ||
    code === 'BODY_READ_ERROR'
  ) {
    return new OpenProjectSessionFailure(
      'offline',
      messageForError(reason, TERMINAL_PRESENTATIONS.offline.message),
    );
  }
  if (status === 401 || status === 403 || status === 404) {
    return new OpenProjectSessionFailure(
      'unauthorized-project',
      messageForError(
        reason,
        TERMINAL_PRESENTATIONS['unauthorized-project'].message,
      ),
    );
  }
  return new OpenProjectSessionFailure(
    'transient-error',
    messageForError(
      reason,
      TERMINAL_PRESENTATIONS['transient-error'].message,
    ),
  );
}

function sessionsFromCatalog<TSession>(
  catalog: ProjectSessionCatalog<TSession>,
): TSession[] {
  return Array.isArray(catalog) ? catalog : catalog.sessions;
}

export function createOpenProjectSessionController<
  TSession extends { id: string },
  TPayload extends Record<string, unknown>,
>({
  clock = {
    clearTimeout: (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  },
  commit,
  onStateChange,
  timeoutMs = OPEN_PROJECT_SESSION_TIMEOUT_MS,
  transport,
}: {
  clock?: OpenProjectSessionClock;
  commit(payload: TPayload): void;
  onStateChange?(state: OpenProjectSessionState): void;
  timeoutMs?: number;
  transport: OpenProjectSessionTransport<TSession, TPayload>;
}): OpenProjectSessionController {
  let generation = 0;
  let state: OpenProjectSessionState = { kind: 'idle' };
  let cancelActive: (() => void) | undefined;

  const publish = (next: OpenProjectSessionState) => {
    state = next;
    onStateChange?.(next);
  };

  const cancel = (publishIdle: boolean) => {
    generation += 1;
    cancelActive?.();
    cancelActive = undefined;
    if (publishIdle) publish({ kind: 'idle' });
  };

  return {
    cancelOpenProjectSession() {
      cancel(true);
    },
    getState() {
      return state;
    },
    async openProjectSession(
      rawProjectId: string,
      rawSessionId: string,
    ): Promise<OpenProjectSessionResult> {
      const projectId = rawProjectId.trim();
      const sessionId = rawSessionId.trim();
      if (
        state.kind === 'ready' &&
        state.projectId === projectId &&
        state.sessionId === sessionId
      ) {
        return state;
      }

      if (projectId && sessionId) {
        const cached = transport.openFromCache?.(projectId, sessionId);
        if (cached) {
          cancel(false);
          const operationGeneration = generation;
          commit(cached);
          const ready: OpenProjectSessionState = {
            kind: 'ready',
            generation: operationGeneration,
            projectId,
            sessionId,
          };
          publish(ready);
          return ready;
        }
      }

      cancel(false);
      const operationGeneration = generation;
      publish({
        kind: 'opening',
        generation: operationGeneration,
        projectId,
        sessionId,
      });

      let resolveCancellation: (() => void) | undefined;
      let timeoutHandle: unknown;
      const cancellation = new Promise<typeof CANCELLED>((resolve) => {
        resolveCancellation = () => resolve(CANCELLED);
      });
      cancelActive = resolveCancellation;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = clock.setTimeout(
          () =>
            reject(
              new OpenProjectSessionFailure(
                'timeout',
                TERMINAL_PRESENTATIONS.timeout.message,
              ),
            ),
          timeoutMs,
        );
      });
      const isCurrent = () => operationGeneration === generation;
      const ensureCurrent = () => {
        if (!isCurrent()) throw CANCELLED;
      };
      const load = async () => {
        if (!projectId) {
          throw new OpenProjectSessionFailure(
            'unauthorized-project',
            TERMINAL_PRESENTATIONS['unauthorized-project'].message,
          );
        }
        const confirmed = await transport.confirmProject(projectId);
        ensureCurrent();
        if (!confirmed) {
          throw new OpenProjectSessionFailure(
            'unauthorized-project',
            TERMINAL_PRESENTATIONS['unauthorized-project'].message,
          );
        }

        let target: TSession | undefined;
        let exactLookupCompleted = false;
        if (transport.resolveSession) {
          try {
            target = await transport.resolveSession(projectId, sessionId);
            exactLookupCompleted = true;
          } catch {
            // The exact owner lookup is an optimization. Preserve the scoped
            // catalog path for older gateways and temporary lookup failures.
          }
          ensureCurrent();
        }
        let catalog: ProjectSessionCatalog<TSession>;
        if (target) {
          catalog = [target];
        } else if (exactLookupCompleted) {
          throw new OpenProjectSessionFailure(
            'missing-session',
            TERMINAL_PRESENTATIONS['missing-session'].message,
          );
        } else {
          catalog = await transport.listSessions(projectId);
          ensureCurrent();
          target = sessionsFromCatalog(catalog).find(
            (session) => session.id === sessionId,
          );
        }
        if (!target) {
          throw new OpenProjectSessionFailure(
            'missing-session',
            TERMINAL_PRESENTATIONS['missing-session'].message,
          );
        }

        try {
          const payload = await transport.loadSessionState(
            projectId,
            sessionId,
            target,
            catalog,
          );
          ensureCurrent();
          return payload;
        } catch (reason) {
          if (reason === CANCELLED) throw reason;
          if (statusForError(reason) === 404) {
            throw new OpenProjectSessionFailure(
              'missing-session',
              messageForError(
                reason,
                TERMINAL_PRESENTATIONS['missing-session'].message,
              ),
            );
          }
          throw reason;
        }
      };

      try {
        const payload = await Promise.race([load(), timeout, cancellation]);
        if (payload === CANCELLED || !isCurrent()) {
          return {
            kind: 'cancelled',
            generation: operationGeneration,
            projectId,
            sessionId,
          };
        }
        commit(payload);
        const ready: OpenProjectSessionState = {
          kind: 'ready',
          generation: operationGeneration,
          projectId,
          sessionId,
        };
        publish(ready);
        void transport.discoverSessions?.(projectId, sessionId)
          .catch(() => undefined);
        return ready;
      } catch (reason) {
        if (reason === CANCELLED || !isCurrent()) {
          return {
            kind: 'cancelled',
            generation: operationGeneration,
            projectId,
            sessionId,
          };
        }
        const failure = classifyFailure(reason);
        const terminal: OpenProjectSessionState = {
          kind: failure.kind,
          generation: operationGeneration,
          message: failure.message,
          projectId,
          sessionId,
        };
        publish(terminal);
        return terminal;
      } finally {
        if (timeoutHandle !== undefined) {
          clock.clearTimeout(timeoutHandle);
        }
        if (isCurrent()) cancelActive = undefined;
      }
    },
  };
}
