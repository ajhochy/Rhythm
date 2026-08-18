import { mergeSessionMessages } from '@/lib/opencode/messages';
import { createOpenProjectSessionController } from '@/providers/open-project-session';
import { resolveExactSession } from '@/providers/services/session-service';
import {
  canCommitBootstrappedSession,
  cancelSessionRefreshTimers,
  pairedReachabilityAction,
  preserveReadySessionDuringRefresh,
  shouldKeepSessionSafetyPoll,
} from '@/providers/opencode-provider-selectors';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('issues #1364/#1366 mobile lifecycle tier', () => {
  test('registered project session reaches ready without waiting for catalog discovery', async () => {
    const get = jest.fn().mockResolvedValue({
      data: { id: 'session-created', title: 'New session' },
    });
    const ownerList = jest.fn().mockResolvedValue({ data: [] });
    const client = {
      experimental: { session: { list: ownerList } },
      session: { get },
    } as never;
    const controller = createOpenProjectSessionController({
      commit() {},
      transport: {
        async confirmProject() {
          return true;
        },
        async resolveSession(_projectId, sessionId) {
          return resolveExactSession(client, sessionId);
        },
        async listSessions() {
          return new Promise<never>(() => undefined);
        },
        async loadSessionState(_projectId, sessionId) {
          return { sessionId };
        },
      },
    });

    await expect(controller.openProjectSession(
      'project-a',
      'session-created',
    )).resolves.toMatchObject({ kind: 'ready' });
    expect(get).toHaveBeenCalledWith({ sessionID: 'session-created' });
    expect(ownerList).not.toHaveBeenCalled();
  });

  test('exact transcript open completes while owner discovery remains in the background', async () => {
    const discovery = deferred<void>();
    const calls: string[] = [];
    const commits: { sessionId: string }[] = [];
    const controller = createOpenProjectSessionController({
      commit(payload: { sessionId: string }) {
        commits.push(payload);
      },
      transport: {
        async confirmProject() {
          calls.push('confirm');
          return true;
        },
        async resolveSession() {
          calls.push('resolve-exact');
          return { id: 'session-explicit' };
        },
        async listSessions() {
          calls.push('blocking-discovery');
          return [{ id: 'session-explicit' }];
        },
        async loadSessionState() {
          calls.push('load-transcript');
          return { sessionId: 'session-explicit' };
        },
        async discoverSessions() {
          calls.push('background-discovery');
          await discovery.promise;
        },
      },
    });

    const result = await controller.openProjectSession(
      'project-a',
      'session-explicit',
    );

    expect(result.kind).toBe('ready');
    expect(commits).toEqual([{ sessionId: 'session-explicit' }]);
    expect(calls).toEqual([
      'confirm',
      'resolve-exact',
      'load-transcript',
      'background-discovery',
    ]);
    discovery.resolve();
  });

  test('an authoritative exact miss does not spend the owner-open deadline on catalog discovery', async () => {
    const controller = createOpenProjectSessionController({
      commit() {},
      timeoutMs: 10,
      transport: {
        async confirmProject() {
          return true;
        },
        async resolveSession() {
          return undefined;
        },
        async listSessions() {
          return new Promise<never>(() => undefined);
        },
        async loadSessionState() {
          return {};
        },
      },
    });

    const result = await controller.openProjectSession(
      'project-a',
      'session-missing',
    );
    expect(result.kind).toBe('missing-session');
  });

  test('scope flip rejects stale bootstrap/catalog data and cancels old-scope timers', () => {
    const explicit = { id: 'session-explicit', title: 'Pinned chat' };
    const stale = { id: 'session-stale', title: 'Old scope chat' };
    const bootstrapToken = {};

    expect(canCommitBootstrappedSession({
      activeBootstrapToken: bootstrapToken,
      bootstrapToken,
      currentSessionId: explicit.id,
    })).toBe(false);
    expect(preserveReadySessionDuringRefresh({
      activeProjectId: 'project-b',
      currentSessionId: explicit.id,
      currentSessions: [explicit],
      openState: {
        generation: 2,
        kind: 'ready',
        projectId: 'project-b',
        sessionId: explicit.id,
      },
      refreshedSessions: [stale, stale],
    })).toEqual([explicit, stale]);

    const cleared: unknown[] = [];
    cancelSessionRefreshTimers(
      { oldMessage: 11, oldCatalog: 12 },
      (handle) => cleared.push(handle),
    );
    expect(cleared).toEqual([11, 12]);
  });

  test('reachability and stream transitions restore polling without duplicate records', () => {
    expect(pairedReachabilityAction(true, false)).toBe('mark-offline');
    expect(pairedReachabilityAction(false, true)).toBe('refresh');
    expect(pairedReachabilityAction(true, true)).toBe('none');

    expect(shouldKeepSessionSafetyPoll({
      eventStreamStatus: 'error',
      hasBusySession: false,
      hasConversationActivity: false,
      sending: false,
    })).toBe(true);
    expect(shouldKeepSessionSafetyPoll({
      eventStreamStatus: 'connected',
      hasBusySession: false,
      hasConversationActivity: false,
      sending: false,
    })).toBe(false);

    const record = {
      info: { id: 'message-1', role: 'assistant' as const },
      parts: [{ id: 'part-1', type: 'text' as const, text: 'Recovered' }],
    } as never;
    expect(mergeSessionMessages([record], [record])).toEqual([record]);
  });
});
